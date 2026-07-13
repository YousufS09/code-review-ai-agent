import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { verifyGitHubWebhookSignature } from "../utils/crypto.util";
import { HttpError } from "../utils/http-error.util";
import { GitHubPullRequestWebhookSchema, GithubWebhookHeadersSchema } from "../validators/github.validator";
import { ReviewService } from "../services/review/review.service";

const reviewService = new ReviewService();

function processReviewInBackground(
  payload: Parameters<ReviewService["handleWebhookEvent"]>[0],
  deliveryId: string,
  eventType: string
): void {
  setImmediate(() => {
    void reviewService.handleWebhookEvent(payload, deliveryId, eventType).catch((error: unknown) => {
      console.error(`Background PR review failed for GitHub delivery ${deliveryId}`, error);
    });
  });
}

export async function handleGithubWebhook(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const headers = GithubWebhookHeadersSchema.parse({
      event: request.header("x-github-event"),
      delivery: request.header("x-github-delivery"),
      signature256: request.header("x-hub-signature-256") ?? undefined
    });

    if (!request.rawBody) {
      throw new HttpError(400, "Missing raw webhook body");
    }

    if (!verifyGitHubWebhookSignature(request.rawBody, headers.signature256, env.GITHUB_WEBHOOK_SECRET)) {
      throw new HttpError(401, "Invalid GitHub webhook signature");
    }

    if (headers.event !== "pull_request") {
      response.status(200).json({ received: true, ignored: true });
      return;
    }

    const payload = GitHubPullRequestWebhookSchema.parse(request.body);

    response.status(202).json({
      received: true,
      accepted: true,
      deliveryId: headers.delivery
    });

    processReviewInBackground(payload, headers.delivery, headers.event);
  } catch (error) {
    next(error);
  }
}
