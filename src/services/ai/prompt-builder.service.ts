import type { GitHubPullRequestFile } from "../../types/github.types";
import type { ReviewSeverity } from "../../types/review.types";
import { buildRepositoryFullName } from "../../utils/github.util";
import { truncateText } from "../../utils/text.util";

const allowedSeverities: ReviewSeverity[] = ["critical", "high", "medium", "low"];

export class PromptBuilderService {
  buildSystemPrompt(): string {
    return [
      "You are a senior software engineer performing a rigorous pull request review.",
      "Review only the changed code provided in the diff snippets.",
      "Ignore unrelated files, repository context, and anything outside the patch.",
      "Prioritize correctness, security, maintainability, and performance.",
      "Do not add unnecessary commentary.",
      "For every finding, return the exact file path and the new-file line number only when the problem is on an added line marked with + in the diff.",
      "If a valid finding is not on an added line, set its line to null.",
      "Return valid JSON only.",
      "Use this response shape:",
      "{",
      '  "summary": string,',
      '  "findings": [{ "file": string, "line": number | null, "severity": "critical" | "high" | "medium" | "low", "issue": string, "explanation": string, "suggestedFix": string }]',
      "}"
    ].join("\n");
  }

  buildUserPrompt(params: {
    owner: string;
    repository: string;
    pullNumber: number;
    commitSha: string;
    title?: string;
    body?: string | null;
    files: GitHubPullRequestFile[];
  }): string {
    const header = [
      `Repository: ${buildRepositoryFullName(params.owner, params.repository)}`,
      `Pull Request: #${params.pullNumber}`,
      `Commit SHA: ${params.commitSha}`,
      params.title ? `Title: ${params.title}` : undefined,
      params.body ? `Description: ${truncateText(params.body, 1200)}` : undefined,
      "",
      "Changed files:"
    ]
      .filter(Boolean)
      .join("\n");

    const fileBlocks = params.files.map((file) => {
      const patch = file.patch ? truncateText(file.patch, 5000) : "(No patch available)";

      return [
        `File: ${file.filename}`,
        `Status: ${file.status}`,
        `Additions: ${file.additions}, Deletions: ${file.deletions}, Changes: ${file.changes}`,
        "Patch:",
        patch,
        ""
      ].join("\n");
    });

    return [
      header,
      ...fileBlocks,
      "Review checklist:",
      "- Bugs",
      "- Security vulnerabilities",
      "- SQL injection",
      "- Hardcoded secrets",
      "- Missing validation",
      "- Performance issues",
      "- Code smells",
      "- Maintainability",
      "- Error handling",
      "- Best practices",
      "",
      `Use only these severities: ${allowedSeverities.join(", ")}.`,
      "If nothing important is found, return a concise summary that says no major issues were detected and set findings to an empty array."
    ].join("\n");
  }
}
