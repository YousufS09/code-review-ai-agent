const mockPrisma = {
  reviewJob: { findUnique: jest.fn(), update: jest.fn((args: unknown) => ({ op: "reviewJob.update", args })) },
  reviewFinding: {
    deleteMany: jest.fn((args: unknown) => ({ op: "reviewFinding.deleteMany", args })),
    createMany: jest.fn((args: unknown) => ({ op: "reviewFinding.createMany", args }))
  },
  pullRequest: { update: jest.fn((args: unknown) => ({ op: "pullRequest.update", args })) },
  webhookEvent: { update: jest.fn((args: unknown) => ({ op: "webhookEvent.update", args })) },
  $transaction: jest.fn(async (operations: unknown[]) => operations)
};

jest.mock("../../src/config/database", () => ({ prisma: mockPrisma }));

import { ReviewOrchestratorService, filterFindings } from "../../src/services/review/review-orchestrator.service";
import type { ReviewFinding, ReviewJobPayload } from "../../src/types/review.types";
import type { GitHubPullRequestFile } from "../../src/types/github.types";

const job: ReviewJobPayload = {
  reviewJobId: 1,
  webhookEventId: 2,
  repositoryId: 3,
  pullRequestId: 4,
  owner: "octocat",
  repository: "demo",
  pullNumber: 5,
  installationId: 6,
  commitSha: "sha-current",
  sender: "octocat"
};

const files: GitHubPullRequestFile[] = [
  { filename: "src/app.ts", status: "modified", additions: 1, deletions: 0, changes: 1, patch: "@@ -0,0 +1 @@\n+eval(x);" }
];

const finding: ReviewFinding = {
  file: "src/app.ts",
  line: 1,
  lineContent: "eval(x);",
  severity: "high",
  issue: "Use of eval",
  explanation: "eval runs arbitrary code.",
  suggestedFix: "Remove eval."
};

function openPr(sha = "sha-current") {
  return { number: 5, head: { sha }, state: "open", draft: false, title: "t", body: null };
}

function createOrchestrator() {
  const githubApi = {
    getPullRequest: jest.fn().mockResolvedValue(openPr()),
    listPullRequestFiles: jest.fn().mockResolvedValue(files)
  };
  const commentService = {
    postOrUpdateReviewComment: jest.fn().mockResolvedValue(undefined),
    postInlineReviewComments: jest.fn().mockResolvedValue(undefined),
    postFailureComment: jest.fn().mockResolvedValue(undefined)
  };
  const groqService = {
    reviewCode: jest.fn().mockResolvedValue(
      JSON.stringify({ summary: "Found issues.", findings: [finding, { ...finding, severity: "low", issue: "Style" }] })
    )
  };

  const orchestrator = new ReviewOrchestratorService(
    githubApi as never,
    commentService as never,
    undefined,
    groqService as never,
    undefined
  );

  return { orchestrator, githubApi, commentService, groqService };
}

describe("ReviewOrchestratorService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.reviewJob.findUnique.mockResolvedValue({
      id: 1,
      pullRequestId: 4,
      webhookEventId: 2,
      commitSha: "sha-current",
      pullRequest: { prNumber: 5, installationId: BigInt(6), repository: { owner: "octocat", name: "demo" } }
    });
  });

  it("reviews the commit, posts comments, and completes the job in one transaction", async () => {
    const { orchestrator, commentService } = createOrchestrator();

    const outcome = await orchestrator.processReviewJob(job);

    expect(outcome.status).toBe("completed");
    expect(commentService.postOrUpdateReviewComment).toHaveBeenCalledTimes(1);
    expect(commentService.postInlineReviewComments).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const operations = mockPrisma.$transaction.mock.calls[0][0] as Array<{ op: string }>;
    expect(operations.map((operation) => operation.op)).toEqual([
      "reviewFinding.deleteMany",
      "reviewFinding.createMany",
      "reviewJob.update",
      "pullRequest.update",
      "webhookEvent.update"
    ]);
  });

  it("skips a job whose commit is no longer the pull request head", async () => {
    const { orchestrator, githubApi, groqService, commentService } = createOrchestrator();
    githubApi.getPullRequest.mockResolvedValue(openPr("sha-newer"));

    const outcome = await orchestrator.processReviewJob(job);

    expect(outcome).toEqual({ status: "superseded", reason: expect.stringContaining("sha-newer") });
    expect(groqService.reviewCode).not.toHaveBeenCalled();
    expect(commentService.postOrUpdateReviewComment).not.toHaveBeenCalled();
    expect(mockPrisma.reviewJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "superseded" }) })
    );
  });

  it("does not post when a newer commit arrives while the model is reviewing", async () => {
    const { orchestrator, githubApi, groqService, commentService } = createOrchestrator();
    githubApi.getPullRequest.mockResolvedValueOnce(openPr()).mockResolvedValueOnce(openPr("sha-newer"));

    const outcome = await orchestrator.processReviewJob(job);

    expect(groqService.reviewCode).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("superseded");
    expect(commentService.postOrUpdateReviewComment).not.toHaveBeenCalled();
    expect(commentService.postInlineReviewComments).not.toHaveBeenCalled();
  });

  it("skips closed pull requests", async () => {
    const { orchestrator, githubApi } = createOrchestrator();
    githubApi.getPullRequest.mockResolvedValue({ ...openPr(), state: "closed" });

    const outcome = await orchestrator.processReviewJob(job);

    expect(outcome).toEqual({ status: "superseded", reason: "pull request is closed" });
  });

  it("records a failure, posts a failure note, and never throws", async () => {
    const { orchestrator, commentService } = createOrchestrator();

    await expect(orchestrator.markJobFailed(1, new Error("Groq timeout"))).resolves.toBeUndefined();

    expect(mockPrisma.reviewJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed", error: "Groq timeout" }) })
    );
    expect(commentService.postFailureComment).toHaveBeenCalledWith("octocat", "demo", 5, 6, "sha-current");
  });

  it("swallows errors while recording a failure so the original error is kept", async () => {
    const { orchestrator } = createOrchestrator();
    mockPrisma.reviewJob.findUnique.mockRejectedValueOnce(new Error("database down"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(orchestrator.markJobFailed(1, new Error("Groq timeout"))).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });
});

describe("filterFindings", () => {
  it("drops findings below the minimum severity or outside the reviewed files", () => {
    const result = filterFindings(
      [finding, { ...finding, severity: "low" }, { ...finding, file: "other.ts" }],
      new Set(["src/app.ts"]),
      "medium"
    );

    expect(result).toEqual([finding]);
  });
});
