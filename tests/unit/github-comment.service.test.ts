import { GitHubCommentService } from "../../src/services/github/github-comment.service";
import { GitHubApiService } from "../../src/services/github/github-api.service";
import type { GitHubPullRequestFile } from "../../src/types/github.types";
import type { ReviewAnalysis } from "../../src/types/review.types";

const owner = "octocat";
const repository = "demo";
const pullNumber = 1;
const installationId = 1;
const commitSha = "abc123";

const files: GitHubPullRequestFile[] = [
  {
    filename: "src/demo.ts",
    status: "modified",
    additions: 3,
    deletions: 0,
    changes: 3,
    patch: "@@ -0,0 +1,3 @@\n+const first = true;\n+console.log(first);\n+console.error(first);"
  }
];

function createApiMock() {
  return {
    listIssueComments: jest.fn().mockResolvedValue([]),
    createIssueComment: jest.fn().mockResolvedValue({
      id: 1,
      body: "summary",
      user: { login: "codereviewagenticai[bot]" },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z"
    }),
    updateIssueComment: jest.fn(),
    listPullRequestReviewComments: jest.fn().mockResolvedValue([]),
    createPullRequestReviewComment: jest.fn().mockResolvedValue({ id: 2 })
  };
}

describe("GitHubCommentService", () => {
  it("keeps the existing top-level summary comment behavior", async () => {
    const api = createApiMock();
    const service = new GitHubCommentService(api as unknown as GitHubApiService);
    const analysis: ReviewAnalysis = {
      summary: "A debug statement was found.",
      findings: []
    };

    await service.postOrUpdateReviewComment(owner, repository, pullNumber, installationId, analysis, commitSha);

    expect(api.createIssueComment).toHaveBeenCalledTimes(1);
    expect(api.createIssueComment.mock.calls[0][4]).toContain("## AI Code Review");
  });

  it("creates an inline review comment for a finding on an added diff line", async () => {
    const api = createApiMock();
    const service = new GitHubCommentService(api as unknown as GitHubApiService);
    const analysis: ReviewAnalysis = {
      summary: "Debug statement found.",
      findings: [
        {
          file: "src/demo.ts",
          line: 2,
          lineContent: "console.log(first);",
          severity: "low",
          issue: "Debug statement",
          explanation: "Console output should not remain in production code.",
          suggestedFix: "Remove console.log(first)."
        }
      ]
    };

    await service.postInlineReviewComments(owner, repository, pullNumber, installationId, analysis, commitSha, files);

    expect(api.createPullRequestReviewComment).toHaveBeenCalledWith(
      owner,
      repository,
      pullNumber,
      installationId,
      commitSha,
      expect.objectContaining({
        path: "src/demo.ts",
        line: 2,
        side: "RIGHT"
      })
    );
  });

  it("skips findings without a valid added diff line", async () => {
    const api = createApiMock();
    const service = new GitHubCommentService(api as unknown as GitHubApiService);
    const analysis: ReviewAnalysis = {
      summary: "Findings include invalid locations.",
      findings: [
        {
          file: "src/demo.ts",
          line: null,
          lineContent: null,
          severity: "low",
          issue: "No line",
          explanation: "No valid location was supplied.",
          suggestedFix: "Inspect the changed code."
        },
        {
          file: "src/missing.ts",
          line: 2,
          lineContent: "console.log(first);",
          severity: "low",
          issue: "Missing file",
          explanation: "The finding is outside the PR diff.",
          suggestedFix: "Inspect the changed code."
        },
        {
          file: "src/demo.ts",
          line: 99,
          severity: "low",
          issue: "Invalid line",
          explanation: "The finding is outside the PR diff.",
          suggestedFix: "Inspect the changed code."
        }
      ]
    };

    await service.postInlineReviewComments(owner, repository, pullNumber, installationId, analysis, commitSha, files);

    expect(api.createPullRequestReviewComment).not.toHaveBeenCalled();
  });

  it("skips an inline finding already commented on for the same commit", async () => {
    const api = createApiMock();
    api.listPullRequestReviewComments.mockResolvedValue([
      {
        id: 10,
        body: "Existing comment\n<!-- ai-code-review-agent-inline -->",
        path: "src/demo.ts",
        line: 2,
        side: "RIGHT",
        commit_id: commitSha,
        user: { login: "codereviewagenticai[bot]" }
      }
    ]);
    const service = new GitHubCommentService(api as unknown as GitHubApiService);
    const analysis: ReviewAnalysis = {
      summary: "Duplicate finding.",
      findings: [
        {
          file: "src/demo.ts",
          line: 2,
          lineContent: "console.log(first);",
          severity: "low",
          issue: "Debug statement",
          explanation: "Console output should not remain in production code.",
          suggestedFix: "Remove console.log(first)."
        }
      ]
    };

    await service.postInlineReviewComments(owner, repository, pullNumber, installationId, analysis, commitSha, files);

    expect(api.createPullRequestReviewComment).not.toHaveBeenCalled();
  });

  it("continues when one inline comment is rejected by GitHub", async () => {
    const api = createApiMock();
    api.createPullRequestReviewComment
      .mockRejectedValueOnce(new Error("Invalid comment location"))
      .mockResolvedValueOnce({ id: 3 });
    const service = new GitHubCommentService(api as unknown as GitHubApiService);
    const analysis: ReviewAnalysis = {
      summary: "Two debug statements were found.",
      findings: [
        {
          file: "src/demo.ts",
          line: 2,
          lineContent: "console.log(first);",
          severity: "low",
          issue: "Debug statement",
          explanation: "Console output should not remain in production code.",
          suggestedFix: "Remove console.log(first)."
        },
        {
          file: "src/demo.ts",
          line: 3,
          lineContent: "console.error(first);",
          severity: "low",
          issue: "Debug statement",
          explanation: "Console output should not remain in production code.",
          suggestedFix: "Remove console.error(first)."
        }
      ]
    };
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await service.postInlineReviewComments(owner, repository, pullNumber, installationId, analysis, commitSha, files);

    expect(api.createPullRequestReviewComment).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
