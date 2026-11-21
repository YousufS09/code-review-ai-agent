import crypto from "node:crypto";
import type {
  GitHubIssueComment,
  GitHubPullRequestFile,
  GitHubPullRequestReviewComment,
  GitHubPullRequestReviewCommentInput
} from "../../types/github.types";
import type { ReviewAnalysis, ReviewFinding, SkippedFile } from "../../types/review.types";
import { HttpError } from "../../utils/http-error.util";
import { AI_CODE_REVIEW_MARKER, formatNullableLine } from "../../utils/github.util";
import { compactWhitespace } from "../../utils/text.util";
import { GitHubApiService } from "./github-api.service";

const AI_INLINE_REVIEW_MARKER = "<!-- ai-code-review-agent-inline -->";
const FINGERPRINT_PATTERN = /<!-- ai-code-review-fp:([a-f0-9]+) -->/;
const MAX_SKIPPED_FILES_LISTED = 20;

/** Line-comment prefixes across common languages (JS/TS/C/Java/Go, Python/Ruby/Shell/YAML, SQL/Lua, HTML, block comments). */
const COMMENT_PREFIXES = ["//", "#", "--", "/*", "*", "<!--", ";"];

/**
 * Model output is untrusted (it can be steered by the PR author), so before posting it:
 * - break HTML tags and comments, so it cannot hide text or forge this bot's markers;
 * - break @-mentions, so it cannot notify users or teams;
 * - turn markdown links and images into plain text that shows the real URL.
 * A zero-width space keeps the visible text unchanged.
 */
export function sanitizeModelText(value: string): string {
  return value
    .replace(/!?\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, "$1 ($2)")
    .replace(/<(?=[!/?a-zA-Z])/g, "<​")
    .replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@​");
}

function escapeMarkdownCell(value: string): string {
  return sanitizeModelText(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderFindingsTable(findings: ReviewFinding[]): string {
  if (findings.length === 0) {
    return "No major issues were detected.";
  }

  const rows = findings
    .map(
      (finding) =>
        `| ${escapeMarkdownCell(finding.severity)} | ${escapeMarkdownCell(finding.file)} | ${escapeMarkdownCell(formatNullableLine(finding.line))} | ${escapeMarkdownCell(finding.issue)} | ${escapeMarkdownCell(finding.suggestedFix)} |`
    )
    .join("\n");

  return ["| Severity | File | Line | Issue | Suggested Fix |", "| --- | --- | --- | --- | --- |", rows].join("\n");
}

function renderSkippedFiles(skippedFiles: SkippedFile[]): string[] {
  if (skippedFiles.length === 0) {
    return [];
  }

  const listed = skippedFiles
    .slice(0, MAX_SKIPPED_FILES_LISTED)
    .map((file) => `- \`${file.filename.replace(/`/g, "")}\`: ${file.reason}`);
  const remainder = skippedFiles.length - listed.length;

  return [
    "",
    "<details>",
    `<summary>${skippedFiles.length} file(s) not reviewed</summary>`,
    "",
    ...listed,
    ...(remainder > 0 ? [`- …and ${remainder} more`] : []),
    "",
    "</details>"
  ];
}

function getAddedLines(patch: string | undefined): Map<number, string> {
  const lines = new Map<number, string>();
  if (!patch) {
    return lines;
  }

  let currentNewLine: number | undefined;

  for (const patchLine of patch.split("\n")) {
    const hunk = patchLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      currentNewLine = Number(hunk[1]);
      continue;
    }

    if (currentNewLine === undefined || patchLine.startsWith("\\ No newline")) {
      continue;
    }

    if (patchLine.startsWith("+") && !patchLine.startsWith("+++")) {
      lines.set(currentNewLine, patchLine.slice(1));
      currentNewLine += 1;
      continue;
    }

    if (patchLine.startsWith("-") && !patchLine.startsWith("---")) {
      continue;
    }

    currentNewLine += 1;
  }

  return lines;
}

function buildChangedLinesByFile(files: GitHubPullRequestFile[]): Map<string, Map<number, string>> {
  return new Map(files.map((file) => [file.filename, getAddedLines(file.patch)]));
}

function isCommentLine(source: string): boolean {
  return COMMENT_PREFIXES.some((prefix) => source.startsWith(prefix));
}

/**
 * Sanity check that a finding describes the line it is anchored to, for finding types that can be
 * checked cheaply. Other findings are accepted once their lineContent matches exactly.
 */
function findingMatchesSourceLine(finding: ReviewFinding, sourceLine: string): boolean {
  const details = `${finding.issue} ${finding.explanation} ${finding.suggestedFix}`.toLowerCase();
  const issue = finding.issue.toLowerCase();
  const source = sourceLine.trim();
  const isComment = isCommentLine(source);
  const hasConsoleCall = /\bconsole\.(log|info|warn|error|debug)\s*\(/.test(source);

  if (details.includes("console") || details.includes("debug statement")) {
    return hasConsoleCall;
  }

  if (details.includes("todo")) {
    return isComment && /\bTODO\b/i.test(source);
  }

  if (details.includes("fixme")) {
    return isComment && /\bFIXME\b/i.test(source);
  }

  // Only when the issue itself is about a comment (e.g. "Commented-out code"); a suggestion such as
  // "add a comment explaining X" must not require the line to already be a comment.
  if (/\bcomment(ed)?\b/.test(issue)) {
    return isComment;
  }

  return true;
}

function fingerprintFinding(finding: ReviewFinding): string {
  return crypto
    .createHash("sha256")
    .update(`${finding.file}\n${(finding.lineContent ?? "").trim()}\n${compactWhitespace(finding.issue).toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

function buildInlineCommentBody(finding: ReviewFinding): string {
  return [
    `**AI Code Review — ${finding.severity}**`,
    "",
    `**${sanitizeModelText(finding.issue)}**`,
    sanitizeModelText(finding.explanation),
    "",
    `**Suggested fix:** ${sanitizeModelText(finding.suggestedFix)}`,
    "",
    AI_INLINE_REVIEW_MARKER,
    `<!-- ai-code-review-fp:${fingerprintFinding(finding)} -->`
  ].join("\n");
}

export class GitHubCommentService {
  constructor(private readonly githubApi = new GitHubApiService()) {}

  buildCommentBody(
    analysis: ReviewAnalysis,
    owner: string,
    repository: string,
    pullNumber: number,
    commitSha: string,
    skippedFiles: SkippedFile[] = []
  ): string {
    const summary = sanitizeModelText(compactWhitespace(analysis.summary));

    return [
      "## AI Code Review",
      this.buildContextLine(owner, repository, pullNumber, commitSha),
      "",
      summary ? summary : "No major issues were detected.",
      "",
      "### Findings",
      renderFindingsTable(analysis.findings),
      ...renderSkippedFiles(skippedFiles),
      "",
      AI_CODE_REVIEW_MARKER
    ].join("\n");
  }

  buildFailureCommentBody(owner: string, repository: string, pullNumber: number, commitSha: string): string {
    return [
      "## AI Code Review",
      this.buildContextLine(owner, repository, pullNumber, commitSha),
      "",
      "⚠️ The automated review could not be completed for this commit. It will be retried automatically; pushing a new commit also starts a new review.",
      "",
      AI_CODE_REVIEW_MARKER
    ].join("\n");
  }

  private buildContextLine(owner: string, repository: string, pullNumber: number, commitSha: string): string {
    return `Repository: \`${owner}/${repository}\` | PR: #${pullNumber} | Commit: \`${commitSha.slice(0, 12)}\``;
  }

  async postOrUpdateReviewComment(
    owner: string,
    repository: string,
    pullNumber: number,
    installationId: number,
    analysis: ReviewAnalysis,
    commitSha: string,
    skippedFiles: SkippedFile[] = []
  ): Promise<GitHubIssueComment> {
    const body = this.buildCommentBody(analysis, owner, repository, pullNumber, commitSha, skippedFiles);
    return this.upsertSummaryComment(owner, repository, pullNumber, installationId, body);
  }

  async postFailureComment(
    owner: string,
    repository: string,
    pullNumber: number,
    installationId: number,
    commitSha: string
  ): Promise<GitHubIssueComment> {
    const body = this.buildFailureCommentBody(owner, repository, pullNumber, commitSha);
    return this.upsertSummaryComment(owner, repository, pullNumber, installationId, body);
  }

  private async upsertSummaryComment(
    owner: string,
    repository: string,
    pullNumber: number,
    installationId: number,
    body: string
  ): Promise<GitHubIssueComment> {
    const [comments, botLogin] = await Promise.all([
      this.githubApi.listIssueComments(owner, repository, pullNumber, installationId),
      this.githubApi.getBotLogin()
    ]);

    // Only this app's own comment counts: anyone can paste the marker into a comment of their own.
    const previousComment = comments.find(
      (comment) => comment.user.login === botLogin && comment.body.includes(AI_CODE_REVIEW_MARKER)
    );

    if (previousComment) {
      try {
        return await this.githubApi.updateIssueComment(owner, repository, previousComment.id, installationId, body);
      } catch (error) {
        // The comment may have been deleted after it was listed; fall back to a new one.
        if (!(error instanceof HttpError) || error.statusCode !== 404) {
          throw error;
        }
      }
    }

    return this.githubApi.createIssueComment(owner, repository, pullNumber, installationId, body);
  }

  private resolveInlineFindingLine(changedLines: Map<number, string> | undefined, finding: ReviewFinding): number | null {
    if (finding.line === null || !finding.lineContent || !changedLines) {
      return null;
    }

    const expectedContent = finding.lineContent.trim();
    const reportedLine = changedLines.get(finding.line);

    if (reportedLine?.trim() === expectedContent && findingMatchesSourceLine(finding, reportedLine)) {
      return finding.line;
    }

    const matchingLines = [...changedLines.entries()].filter(
      ([, sourceLine]) => sourceLine.trim() === expectedContent && findingMatchesSourceLine(finding, sourceLine)
    );

    return matchingLines.length === 1 ? matchingLines[0][0] : null;
  }

  private isDuplicateInlineComment(
    comment: GitHubPullRequestReviewComment,
    finding: ReviewFinding,
    commitSha: string,
    line: number
  ): boolean {
    if (!comment.body.includes(AI_INLINE_REVIEW_MARKER) || comment.path !== finding.file) {
      return false;
    }

    // Same finding already posted on an earlier push (line numbers may have shifted since).
    const fingerprint = comment.body.match(FINGERPRINT_PATTERN)?.[1];
    if (fingerprint && fingerprint === fingerprintFinding(finding)) {
      return true;
    }

    return comment.commit_id === commitSha && comment.line === line && comment.side === "RIGHT";
  }

  async postInlineReviewComments(
    owner: string,
    repository: string,
    pullNumber: number,
    installationId: number,
    analysis: ReviewAnalysis,
    commitSha: string,
    files: GitHubPullRequestFile[]
  ): Promise<void> {
    const changedLinesByFile = buildChangedLinesByFile(files);

    let existingComments: GitHubPullRequestReviewComment[];
    let botLogin: string;
    try {
      [existingComments, botLogin] = await Promise.all([
        this.githubApi.listPullRequestReviewComments(owner, repository, pullNumber, installationId),
        this.githubApi.getBotLogin()
      ]);
    } catch (error) {
      console.error(`Unable to list existing inline review comments for PR #${pullNumber}`, error);
      return;
    }

    const botComments = existingComments.filter((comment) => comment.user.login === botLogin);
    const comments: GitHubPullRequestReviewCommentInput[] = [];

    for (const finding of analysis.findings) {
      const line = this.resolveInlineFindingLine(changedLinesByFile.get(finding.file), finding);
      if (line === null) {
        continue;
      }

      if (botComments.some((comment) => this.isDuplicateInlineComment(comment, finding, commitSha, line))) {
        continue;
      }

      if (comments.some((comment) => comment.path === finding.file && comment.line === line)) {
        continue;
      }

      comments.push({ body: buildInlineCommentBody(finding), path: finding.file, line, side: "RIGHT" });
    }

    if (comments.length === 0) {
      return;
    }

    try {
      await this.githubApi.createPullRequestReview(
        owner,
        repository,
        pullNumber,
        installationId,
        commitSha,
        `AI Code Review: ${comments.length} inline comment(s) on \`${commitSha.slice(0, 12)}\`.`,
        comments
      );
      return;
    } catch (error) {
      // GitHub rejects the whole review if any single comment is invalid; fall back to one at a time.
      console.error(`Batched review failed for PR #${pullNumber}; posting inline comments individually`, error);
    }

    for (const comment of comments) {
      try {
        await this.githubApi.createPullRequestReviewComment(owner, repository, pullNumber, installationId, commitSha, comment);
      } catch (error) {
        console.error(`Unable to create inline review comment for ${comment.path}:${comment.line}`, error);
      }
    }
  }
}
