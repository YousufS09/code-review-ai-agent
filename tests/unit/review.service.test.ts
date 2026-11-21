const mockPrisma = {
  webhookEvent: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
  reviewJob: { update: jest.fn(), create: jest.fn() },
  repository: { upsert: jest.fn() },
  pullRequest: { upsert: jest.fn() }
};

jest.mock("../../src/config/database", () => ({ prisma: mockPrisma }));

import { ReviewService } from "../../src/services/review/review.service";
import type { ReviewOrchestratorService } from "../../src/services/review/review-orchestrator.service";
import type { GitHubPullRequestWebhookPayload } from "../../src/types/github.types";

const payload: GitHubPullRequestWebhookPayload = {
  action: "synchronize",
  installation: { id: 7 },
  repository: { name: "demo", owner: { login: "octocat" } },
  pull_request: { number: 3, head: { sha: "def456" } },
  sender: { login: "octocat" }
};

function existingEvent(status: "processing" | "completed" | "failed") {
  return {
    id: 11,
    ignored: false,
    reviewJob: {
      id: 21,
      status,
      pullRequestId: 31,
      pullRequest: { repository: { id: 41, owner: "octocat", name: "demo" } }
    }
  };
}

function createService() {
  const orchestrator = {
    processReviewJob: jest.fn().mockResolvedValue({ summary: "ok", findings: [] }),
    markJobFailed: jest.fn().mockResolvedValue(undefined)
  };

  return {
    orchestrator,
    service: new ReviewService(orchestrator as unknown as ReviewOrchestratorService)
  };
}

describe("ReviewService.handleWebhookEvent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resumes a job left in processing by an interrupted attempt", async () => {
    mockPrisma.webhookEvent.findUnique.mockResolvedValue(existingEvent("processing"));
    const { service, orchestrator } = createService();

    const result = await service.handleWebhookEvent(payload, "delivery-1", "pull_request");

    expect(mockPrisma.reviewJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 21 },
        data: expect.objectContaining({ status: "processing", retries: { increment: 1 }, commitSha: "def456" })
      })
    );
    expect(orchestrator.processReviewJob).toHaveBeenCalledWith(
      expect.objectContaining({ reviewJobId: 21, webhookEventId: 11, pullNumber: 3, installationId: 7 })
    );
    expect(mockPrisma.reviewJob.create).not.toHaveBeenCalled();
    expect(result).toEqual({ ignored: false, processed: true, reviewJobId: 21 });
  });

  it("does not rerun a completed job", async () => {
    mockPrisma.webhookEvent.findUnique.mockResolvedValue(existingEvent("completed"));
    const { service, orchestrator } = createService();

    const result = await service.handleWebhookEvent(payload, "delivery-1", "pull_request");

    expect(orchestrator.processReviewJob).not.toHaveBeenCalled();
    expect(result).toEqual({ ignored: false, processed: true, reviewJobId: 21 });
  });

  it("marks the job failed and rethrows so the queue retries it", async () => {
    mockPrisma.webhookEvent.findUnique.mockResolvedValue(existingEvent("failed"));
    const { service, orchestrator } = createService();
    const failure = new Error("Groq unavailable");
    orchestrator.processReviewJob.mockRejectedValueOnce(failure);

    await expect(service.handleWebhookEvent(payload, "delivery-1", "pull_request")).rejects.toThrow("Groq unavailable");
    expect(orchestrator.markJobFailed).toHaveBeenCalledWith(21, failure);
  });
});
