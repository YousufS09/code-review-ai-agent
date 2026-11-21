import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { verifyGitHubWebhookSignature } from "../utils/crypto.util";
import { HttpError } from "../utils/http-error.util";
import { GitHubPullRequestWebhookSchema, GithubWebhookHeadersSchema } from "../validators/github.validator";
import { enqueueReview } from "../config/queue";

function isAllowedOwner(owner: string): boolean {
  if (env.ALLOWED_GITHUB_OWNERS.length === 0) {
    return true;
  }

  const normalizedOwner = owner.toLowerCase();
  return env.ALLOWED_GITHUB_OWNERS.some((allowed) => allowed.toLowerCase() === normalizedOwner);
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

    if (!isAllowedOwner(payload.repository.owner.login)) {
      response.status(200).json({ received: true, ignored: true });
      return;
    }

    // Persist the job before acknowledging, so an accepted webhook is never lost.
    // If enqueueing fails, GitHub receives an error and records the delivery as failed.
    await enqueueReview({ payload, deliveryId: headers.delivery, eventType: headers.event });

    response.status(202).json({
      received: true,
      accepted: true,
      deliveryId: headers.delivery
    });
  } catch (error) {
    next(error);
  }
}
