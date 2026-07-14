import type {
  GitHubIssueComment,
  GitHubPullRequestFile,
  GitHubPullRequestReviewComment,
  GitHubPullRequestReviewCommentInput
} from "../../types/github.types";
import type { ReviewAnalysis, ReviewFinding } from "../../types/review.types";
import { AI_CODE_REVIEW_MARKER, formatNullableLine } from "../../utils/github.util";
import { compactWhitespace } from "../../utils/text.util";
import { GitHubApiService } from "./github-api.service";

const AI_INLINE_REVIEW_MARKER = "<!-- ai-code-review-agent-inline -->";

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
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

  return [
    "| Severity | File | Line | Issue | Suggested Fix |",
    "| --- | --- | --- | --- | --- |",
    rows
  ].join("\n");
}

function getAddedLines(patch: string | undefined): Set<number> {
  const lines = new Set<number>();
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
      lines.add(currentNewLine);
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

function buildChangedLinesByFile(files: GitHubPullRequestFile[]): Map<string, Set<number>> {
  return new Map(files.map((file) => [file.filename, getAddedLines(file.patch)]));
}

function buildInlineCommentBody(finding: ReviewFinding): string {
  return [
    `**AI Code Review — ${finding.severity}**`,
    "",
    `**${finding.issue}**`,
    finding.explanation,
    "",
    `**Suggested fix:** ${finding.suggestedFix}`,
    "",
    AI_INLINE_REVIEW_MARKER
  ].join("\n");
}

export class GitHubCommentService {
  constructor(private readonly githubApi = new GitHubApiService()) {}

  buildCommentBody(analysis: ReviewAnalysis, owner: string, repository: string, pullNumber: number, commitSha: string): string {
    const summary = compactWhitespace(analysis.summary);
    const title = "## AI Code Review";
    const contextLine = `Repository: \`${owner}/${repository}\` | PR: #${pullNumber} | Commit: \`${commitSha.slice(0, 12)}\``;

    return [
      title,
      contextLine,
      "",
      summary ? summary : "No major issues were detected.",
      "",
      "### Findings",
      renderFindingsTable(analysis.findings),
      "",
      AI_CODE_REVIEW_MARKER
    ].join("\n");
  }

  private findPreviousBotComment(comments: GitHubIssueComment[]): GitHubIssueComment | undefined {
    return comments.find((comment) => comment.body.includes(AI_CODE_REVIEW_MARKER));
  }

  private isDuplicateInlineComment(
    comment: GitHubPullRequestReviewComment,
    finding: ReviewFinding,
    commitSha: string
  ): boolean {
    return (
      comment.commit_id === commitSha &&
      comment.path === finding.file &&
      comment.line === finding.line &&
      comment.side === "RIGHT" &&
      comment.body.includes(AI_INLINE_REVIEW_MARKER)
    );
  }

  async postOrUpdateReviewComment(
    owner: string,
    repository: string,
    pullNumber: number,
    installationId: number,
    analysis: ReviewAnalysis,
    commitSha: string
  ): Promise<GitHubIssueComment> {
    const commentBody = this.buildCommentBody(analysis, owner, repository, pullNumber, commitSha);
    const comments = await this.githubApi.listIssueComments(owner, repository, pullNumber, installationId);
    const previousComment = this.findPreviousBotComment(comments);

    if (previousComment) {
      return this.githubApi.updateIssueComment(owner, repository, previousComment.id, installationId, commentBody);
    }

    return this.githubApi.createIssueComment(owner, repository, pullNumber, installationId, commentBody);
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
    try {
      existingComments = await this.githubApi.listPullRequestReviewComments(owner, repository, pullNumber, installationId);
    } catch (error) {
      console.error(`Unable to list existing inline review comments for PR #${pullNumber}`, error);
      return;
    }

    for (const finding of analysis.findings) {
      const changedLines = changedLinesByFile.get(finding.file);
      if (finding.line === null || !changedLines?.has(finding.line)) {
        continue;
      }

      if (existingComments.some((comment) => this.isDuplicateInlineComment(comment, finding, commitSha))) {
        continue;
      }

      const comment: GitHubPullRequestReviewCommentInput = {
        body: buildInlineCommentBody(finding),
        path: finding.file,
        line: finding.line,
        side: "RIGHT"
      };

      try {
        await this.githubApi.createPullRequestReviewComment(
          owner,
          repository,
          pullNumber,
          installationId,
          commitSha,
          comment
        );
      } catch (error) {
        console.error(`Unable to create inline review comment for ${finding.file}:${finding.line}`, error);
      }
    }
  }
}
