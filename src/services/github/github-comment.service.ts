import type { GitHubIssueComment } from "../../types/github.types";
import type { ReviewAnalysis, ReviewFinding } from "../../types/review.types";
import { AI_CODE_REVIEW_MARKER, formatNullableLine } from "../../utils/github.util";
import { compactWhitespace } from "../../utils/text.util";
import { GitHubApiService } from "./github-api.service";

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

export class GitHubCommentService {
  constructor(private readonly githubApi = new GitHubApiService()) {}

  buildCommentBody(analysis: ReviewAnalysis, owner: string, repository: string, pullNumber: number, commitSha: string): string {
    const summary = compactWhitespace(analysis.summary);
    const title = `## AI Code Review`;
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
}

