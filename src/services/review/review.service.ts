import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import type { GitHubPullRequestWebhookPayload } from "../../types/github.types";
import { isSupportedPullRequestAction } from "../../validators/github.validator";
import { ReviewOrchestratorService } from "./review-orchestrator.service";
import type { ReviewJobPayload } from "../../types/review.types";

export class ReviewService {
  constructor(private readonly orchestrator = new ReviewOrchestratorService()) {}

  private static toJsonValue(payload: GitHubPullRequestWebhookPayload): Prisma.InputJsonValue {
    return payload as unknown as Prisma.InputJsonValue;
  }

  async handleWebhookEvent(payload: GitHubPullRequestWebhookPayload, deliveryId: string, eventType: string): Promise<{
    ignored: boolean;
    processed: boolean;
    reviewJobId?: number;
  }> {
    const existingWebhookEvent = await prisma.webhookEvent.findUnique({
      where: { deliveryId },
      include: {
        reviewJob: {
          include: {
            pullRequest: {
              include: { repository: true }
            }
          }
        }
      }
    });

    const existingStatus = existingWebhookEvent?.reviewJob?.status;
    if (existingWebhookEvent?.reviewJob && (existingStatus === "completed" || existingStatus === "superseded")) {
      return {
        ignored: existingWebhookEvent.ignored,
        processed: true,
        reviewJobId: existingWebhookEvent.reviewJob.id
      };
    }

    // A "failed" job is a retry after an error; a "processing" job means a previous attempt was
    // interrupted (crash, restart, expiry). The queue runs at most one attempt per delivery at a time,
    // so both cases are safe to resume here.
    if (existingWebhookEvent?.reviewJob) {
      const failedJob = existingWebhookEvent.reviewJob;
      const repository = failedJob.pullRequest.repository;
      const installationId = payload.installation.id;
      const commitSha = payload.pull_request.head.sha;

      await prisma.reviewJob.update({
        where: { id: failedJob.id },
        data: {
          status: "processing",
          retries: { increment: 1 },
          commitSha,
          error: null,
          startedAt: new Date(),
          completedAt: null
        }
      });

      const retryPayload: ReviewJobPayload = {
        reviewJobId: failedJob.id,
        webhookEventId: existingWebhookEvent.id,
        repositoryId: repository.id,
        pullRequestId: failedJob.pullRequestId,
        owner: repository.owner,
        repository: repository.name,
        pullNumber: payload.pull_request.number,
        installationId,
        commitSha,
        sender: payload.sender.login
      };

      try {
        await this.orchestrator.processReviewJob(retryPayload);
        return {
          ignored: false,
          processed: true,
          reviewJobId: failedJob.id
        };
      } catch (error) {
        await this.orchestrator.markJobFailed(failedJob.id, error);
        throw error;
      }
    }

    const repositoryOwner = payload.repository.owner.login;
    const repositoryName = payload.repository.name;
    const prNumber = payload.pull_request.number;
    const installationId = payload.installation.id;
    const commitSha = payload.pull_request.head.sha;
    const sender = payload.sender.login;
    const action = payload.action;
    const isSkippedDraft = payload.pull_request.draft === true && !env.REVIEW_DRAFTS;
    const shouldReview = isSupportedPullRequestAction(action) && !isSkippedDraft;

    const webhookEvent = await prisma.webhookEvent.upsert({
      where: { deliveryId },
      update: {
        eventType,
        action,
        repositoryOwner,
        repositoryName,
        prNumber,
        installationId: BigInt(installationId),
        payload: ReviewService.toJsonValue(payload),
        ignored: !shouldReview
      },
      create: {
        deliveryId,
        eventType,
        action,
        repositoryOwner,
        repositoryName,
        prNumber,
        installationId: BigInt(installationId),
        payload: ReviewService.toJsonValue(payload),
        processed: false,
        ignored: !shouldReview
      }
    });

    if (!shouldReview) {
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          processed: true,
          ignored: true
        }
      });

      return { ignored: true, processed: true };
    }

    const repository = await prisma.repository.upsert({
      where: {
        owner_name: {
          owner: repositoryOwner,
          name: repositoryName
        }
      },
      update: {},
      create: {
        owner: repositoryOwner,
        name: repositoryName
      }
    });

    const pullRequest = await prisma.pullRequest.upsert({
      where: {
        repositoryId_prNumber: {
          repositoryId: repository.id,
          prNumber
        }
      },
      update: {
        headSha: commitSha,
        sender,
        installationId: BigInt(installationId),
        status: "open"
      },
      create: {
        repositoryId: repository.id,
        prNumber,
        headSha: commitSha,
        sender,
        installationId: BigInt(installationId),
        status: "open"
      }
    });

    const reviewJob = await prisma.reviewJob.create({
      data: {
        pullRequestId: pullRequest.id,
        webhookEventId: webhookEvent.id,
        status: "processing",
        retries: 0,
        commitSha,
        startedAt: new Date()
      }
    });

    const jobPayload: ReviewJobPayload = {
      reviewJobId: reviewJob.id,
      webhookEventId: webhookEvent.id,
      repositoryId: repository.id,
      pullRequestId: pullRequest.id,
      owner: repositoryOwner,
      repository: repositoryName,
      pullNumber: prNumber,
      installationId,
      commitSha,
      sender
    };

    try {
      await this.orchestrator.processReviewJob(jobPayload);

      return {
        ignored: false,
        processed: true,
        reviewJobId: reviewJob.id
      };
    } catch (error) {
      await this.orchestrator.markJobFailed(reviewJob.id, error);
      throw error;
    }
  }
}
