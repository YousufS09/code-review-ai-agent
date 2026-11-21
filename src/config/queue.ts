import PgBoss from "pg-boss";
import { env } from "./env";
import { prisma } from "./database";
import type { GitHubPullRequestWebhookPayload } from "../types/github.types";

export const REVIEW_QUEUE = "pr-review";
const WEBHOOK_RETENTION_QUEUE = "webhook-retention";

export interface ReviewQueueJobData {
  payload: GitHubPullRequestWebhookPayload;
  deliveryId: string;
  eventType: string;
}

/**
 * Durable job queue backed by the application's Postgres database (pg-boss keeps its own `pgboss` schema).
 * Jobs survive process crashes and restarts: unfinished work is picked up again once a worker is running.
 */
export const boss = new PgBoss({
  connectionString: env.DATABASE_URL,
  application_name: "ai-code-review-agent"
});

boss.on("error", (error) => {
  console.error("pg-boss error", error);
});

export async function startReviewQueue(handler: (data: ReviewQueueJobData) => Promise<void>): Promise<void> {
  await boss.start();
  await boss.createQueue(REVIEW_QUEUE, {
    name: REVIEW_QUEUE,
    // stately: at most one queued and one active job per singletonKey (the GitHub delivery id),
    // so duplicate deliveries are dropped while a manual redelivery after a final failure is still accepted.
    policy: "stately",
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    // A review that has not finished after 10 minutes is treated as hung and retried.
    expireInSeconds: 600
  });

  await boss.work<ReviewQueueJobData>(REVIEW_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await handler(job.data);
    }
  });

  await startWebhookRetention();
}

/** Deletes finished webhook events (and their stored payloads) older than WEBHOOK_RETENTION_DAYS, daily at 03:00 UTC. */
async function startWebhookRetention(): Promise<void> {
  await boss.createQueue(WEBHOOK_RETENTION_QUEUE, { name: WEBHOOK_RETENTION_QUEUE, policy: "singleton" });
  await boss.schedule(WEBHOOK_RETENTION_QUEUE, "0 3 * * *");
  await boss.work(WEBHOOK_RETENTION_QUEUE, async () => {
    const cutoff = new Date(Date.now() - env.WEBHOOK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    // ReviewJob.webhookEventId is ON DELETE SET NULL, so review history is kept.
    const { count } = await prisma.webhookEvent.deleteMany({
      where: { createdAt: { lt: cutoff }, OR: [{ processed: true }, { ignored: true }] }
    });
    console.log(`Webhook retention: deleted ${count} event(s) older than ${env.WEBHOOK_RETENTION_DAYS} days`);
  });
}

export async function enqueueReview(data: ReviewQueueJobData): Promise<void> {
  await boss.send(REVIEW_QUEUE, data, { singletonKey: data.deliveryId });
}

export async function stopReviewQueue(): Promise<void> {
  // graceful: stop fetching new jobs and wait for active reviews to finish before resolving.
  await boss.stop({ graceful: true, wait: true, timeout: 30_000 });
}
