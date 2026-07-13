import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/database";

async function main(): Promise<void> {
  const server = app.listen(env.PORT, () => {
    console.log(`AI Code Review Agent API listening on port ${env.PORT}`);
  });

  const shutdown = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
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
