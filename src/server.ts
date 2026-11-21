import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/database";
import { startReviewQueue, stopReviewQueue } from "./config/queue";
import { ReviewService } from "./services/review/review.service";

async function main(): Promise<void> {
  const reviewService = new ReviewService();

  await startReviewQueue(async ({ payload, deliveryId, eventType }) => {
    // Errors propagate to pg-boss, which retries the job with backoff.
    await reviewService.handleWebhookEvent(payload, deliveryId, eventType);
  });

  const server = app.listen(env.PORT, () => {
    console.log(`AI Code Review Agent API listening on port ${env.PORT}`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await stopReviewQueue();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
