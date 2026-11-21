import { GitHubCommentService, sanitizeModelText } from "../../src/services/github/github-comment.service";
import { GitHubApiService } from "../../src/services/github/github-api.service";
import type { GitHubPullRequestFile } from "../../src/types/github.types";
import type { ReviewAnalysis, ReviewFinding } from "../../src/types/review.types";
import { HttpError } from "../../src/utils/http-error.util";

const owner = "octocat";
const repository = "demo";
const pullNumber = 1;
const installationId = 1;
const commitSha = "abc123";
const botLogin = "codereviewagenticai[bot]";

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

const debugFinding: ReviewFinding = {
  file: "src/demo.ts",
  line: 2,
  lineContent: "console.log(first);",
  severity: "low",
  issue: "Debug statement",
  explanation: "Console output should not remain in production code.",
  suggestedFix: "Remove console.log(first)."
};

function createApiMock() {
  return {
    getBotLogin: jest.fn().mockResolvedValue(botLogin),
    listIssueComments: jest.fn().mockResolvedValue([]),
    createIssueComment: jest.fn().mockResolvedValue({ id: 1 }),
    updateIssueComment: jest.fn().mockResolvedValue({ id: 1 }),
    listPullRequestReviewComments: jest.fn().mockResolvedValue([]),
    createPullRequestReview: jest.fn().mockResolvedValue({ id: 5 }),
    createPullRequestReviewComment: jest.fn().mockResolvedValue({ id: 2 })
  };
}

function createService(api = createApiMock()) {
  return { api, service: new GitHubCommentService(api as unknown as GitHubApiService) };
}

function analysisWith(...findings: ReviewFinding[]): ReviewAnalysis {
  return { summary: "Review summary.", findings };
}

function postedInlineComments(api: ReturnType<typeof createApiMock>) {
  return api.createPullRequestReview.mock.calls.flatMap((call) => call[6] as Array<{ path: string; line: number; body: string }>);
}

describe("GitHubCommentService summary comment", () => {
  it("creates the summary comment when none exists", async () => {
    const { api, service } = createService();

    await service.postOrUpdateReviewComment(owner, repository, pullNumber, installationId, analysisWith(), commitSha);

    expect(api.createIssueComment).toHaveBeenCalledTimes(1);
    expect(api.createIssueComment.mock.calls[0][4]).toContain("## AI Code Review");
  });

  it("updates the bot's own previous summary comment", async () => {
    const { api, service } = createService();
    api.listIssueComments.mockResolvedValue([
      { id: 9, body: "old <!-- ai-code-review-agent -->", user: { login: botLogin } }
    ]);

    await service.postOrUpdateReviewComment(owner, repository, pullNumber, installationId, analysisWith(), commitSha);

    expect(api.updateIssueComment).toHaveBeenCalledWith(owner, repository, 9, installationId, expect.any(String));
    expect(api.createIssueComment).not.toHaveBeenCalled();
  });

  it("ignores a user comment that contains the bot marker", async () => {
    const { api, service } = createService();
    api.listIssueComments.mockResolvedValue([
      { id: 7, body: "hijack <!-- ai-code-review-agent -->", user: { login: "mallory" } }
    ]);

    await service.postOrUpdateReviewComment(owner, repository, pullNumber, installationId, analysisWith(), commitSha);

    expect(api.updateIssueComment).not.toHaveBeenCalled();
    expect(api.createIssueComment).toHaveBeenCalledTimes(1);
  });

  it("creates a new comment when the previous one was deleted", async () => {
    const { api, service } = createService();
    api.listIssueComments.mockResolvedValue([{ id: 9, body: "<!-- ai-code-review-agent -->", user: { login: botLogin } }]);
    api.updateIssueComment.mockRejectedValue(new HttpError(404, "Not Found", false));

    await service.postOrUpdateReviewComment(owner, repository, pullNumber, installationId, analysisWith(), commitSha);

    expect(api.createIssueComment).toHaveBeenCalledTimes(1);
  });

  it("lists files that were not reviewed", () => {
    const { service } = createService();

    const body = service.buildCommentBody(analysisWith(), owner, repository, pullNumber, commitSha, [
      { filename: "package-lock.json", reason: "generated or vendored file" }
    ]);

    expect(body).toContain("1 file(s) not reviewed");
    expect(body).toContain("`package-lock.json`: generated or vendored file");
  });

  it("sanitizes model text in the summary and findings table", () => {
    const { service } = createService();
    const body = service.buildCommentBody(
      {
        summary: "Ping @org/team <!-- ai-code-review-agent --> [click](https://evil.example)",
        findings: [{ ...debugFinding, issue: "<img src=x> @admin" }]
      },
      owner,
      repository,
      pullNumber,
      commitSha
    );

    expect(body).not.toMatch(/(^|[^\w`])@org/);
    expect(body).not.toContain("[click](");
    expect(body).toContain("click (https://evil.example)");
    expect(body).not.toContain("<img");
    // Only the real trailing marker remains intact.
    expect(body.match(/<!-- ai-code-review-agent -->/g)).toHaveLength(1);
  });
});

describe("sanitizeModelText", () => {
  it("leaves ordinary code text readable", () => {
    expect(sanitizeModelText("Use `a < b` and user@example.com")).toBe("Use `a < b` and user@example.com");
  });
});

describe("GitHubCommentService inline comments", () => {
  it("posts inline findings as one batched review", async () => {
    const { api, service } = createService();

    await service.postInlineReviewComments(
      owner,
      repository,
      pullNumber,
      installationId,
      analysisWith(debugFinding, { ...debugFinding, line: 3, lineContent: "console.error(first);" }),
      commitSha,
      files
    );

    expect(api.createPullRequestReview).toHaveBeenCalledTimes(1);
    expect(api.createPullRequestReview.mock.calls[0][4]).toBe(commitSha);
    expect(postedInlineComments(api)).toEqual([
      expect.objectContaining({ path: "src/demo.ts", line: 2, side: "RIGHT" }),
      expect.objectContaining({ path: "src/demo.ts", line: 3, side: "RIGHT" })
    ]);
    expect(api.createPullRequestReviewComment).not.toHaveBeenCalled();
  });

  it("reanchors a finding only when its exact source line appears once in the changed diff", async () => {
    const { api, service } = createService();

    await service.postInlineReviewComments(owner, repository, pullNumber, installationId, analysisWith({ ...debugFinding, line: 1 }), commitSha, files);

    expect(postedInlineComments(api)).toEqual([expect.objectContaining({ line: 2 })]);
  });

  it("skips a finding when its description does not match the changed source line", async () => {
    const { api, service } = createService();

    await service.postInlineReviewComments(
      owner,
      repository,
      pullNumber,
      installationId,
      analysisWith({ ...debugFinding, line: 1, lineContent: "const first = true;" }),
      commitSha,
      files
    );

    expect(api.createPullRequestReview).not.toHaveBeenCalled();
  });

  it("skips findings without a valid added diff line", async () => {
    const { api, service } = createService();

    await service.postInlineReviewComments(
      owner,
      repository,
      pullNumber,
      installationId,
      analysisWith(
        { ...debugFinding, line: null, lineContent: null },
        { ...debugFinding, file: "src/missing.ts" },
        { ...debugFinding, line: 99, lineContent: "missing();" }
      ),
      commitSha,
      files
    );

    expect(api.createPullRequestReview).not.toHaveBeenCalled();
  });

  it("skips an inline finding already commented on for the same commit", async () => {
    const { api, service } = createService();
    api.listPullRequestReviewComments.mockResolvedValue([
      {
        id: 10,
        body: "Existing comment\n<!-- ai-code-review-agent-inline -->",
        path: "src/demo.ts",
        line: 2,
        side: "RIGHT",
        commit_id: commitSha,
        user: { login: botLogin }
      }
    ]);

    await service.postInlineReviewComments(owner, repository, pullNumber, installationId, analysisWith(debugFinding), commitSha, files);

    expect(api.createPullRequestReview).not.toHaveBeenCalled();
  });

  it("does not repeat the same finding after a new push moves its line", async () => {
    const first = createService();
    await first.service.postInlineReviewComments(owner, repository, pullNumber, installationId, analysisWith(debugFinding), commitSha, files);
    const previousBody = postedInlineComments(first.api)[0].body;

    const { api, service } = createService();
    api.listPullRequestReviewComments.mockResolvedValue([
      { id: 11, body: previousBody, path: "src/demo.ts", line: 2, side: "RIGHT", commit_id: "oldsha", user: { login: botLogin } }
    ]);
    const shiftedFiles: GitHubPullRequestFile[] = [
      { ...files[0], patch: "@@ -0,0 +1,4 @@\n+// header\n+const first = true;\n+console.log(first);\n+console.error(first);" }
    ];

    await service.postInlineReviewComments(
      owner,
      repository,
      pullNumber,
      installationId,
      analysisWith({ ...debugFinding, line: 3 }),
      "newsha",
      shiftedFiles
    );

    expect(api.createPullRequestReview).not.toHaveBeenCalled();
  });

  it("does not treat another user's comment with the inline marker as a duplicate", async () => {
    const { api, service } = createService();
    api.listPullRequestReviewComments.mockResolvedValue([
      {
        id: 12,
        body: "<!-- ai-code-review-agent-inline -->",
        path: "src/demo.ts",
        line: 2,
        side: "RIGHT",
        commit_id: commitSha,
        user: { login: "mallory" }
      }
    ]);

    await service.postInlineReviewComments(owner, repository, pullNumber, installationId, analysisWith(debugFinding), commitSha, files);

    expect(api.createPullRequestReview).toHaveBeenCalledTimes(1);
  });

  it("anchors a comment-related finding on a # comment line", async () => {
    const { api, service } = createService();
    const pythonFiles: GitHubPullRequestFile[] = [
      { filename: "app.py", status: "added", additions: 1, deletions: 0, changes: 1, patch: "@@ -0,0 +1 @@\n+# TODO remove hack" }
    ];

    await service.postInlineReviewComments(
      owner,
      repository,
      pullNumber,
      installationId,
      analysisWith({
        file: "app.py",
        line: 1,
        lineContent: "# TODO remove hack",
        severity: "low",
        issue: "Unresolved TODO",
        explanation: "TODO left in code.",
        suggestedFix: "Resolve the TODO."
      }),
      commitSha,
      pythonFiles
    );

    expect(postedInlineComments(api)).toEqual([expect.objectContaining({ path: "app.py", line: 1 })]);
  });

  it("keeps a finding whose suggestion mentions adding a comment", async () => {
    const { api, service } = createService();

    await service.postInlineReviewComments(
      owner,
      repository,
      pullNumber,
      installationId,
      analysisWith({
        ...debugFinding,
        line: 1,
        lineContent: "const first = true;",
        issue: "Magic boolean",
        explanation: "The flag meaning is unclear.",
        suggestedFix: "Add a comment explaining the flag."
      }),
      commitSha,
      files
    );

    expect(postedInlineComments(api)).toEqual([expect.objectContaining({ line: 1 })]);
  });

  it("falls back to individual comments when the batched review is rejected", async () => {
    const { api, service } = createService();
    api.createPullRequestReview.mockRejectedValue(new Error("Unprocessable Entity"));
    api.createPullRequestReviewComment.mockRejectedValueOnce(new Error("Invalid comment location")).mockResolvedValueOnce({ id: 3 });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await service.postInlineReviewComments(
      owner,
      repository,
      pullNumber,
      installationId,
      analysisWith(debugFinding, { ...debugFinding, line: 3, lineContent: "console.error(first);", suggestedFix: "Remove console.error(first)." }),
      commitSha,
      files
    );

    expect(api.createPullRequestReviewComment).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
