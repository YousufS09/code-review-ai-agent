import express from "express";
import { healthRouter } from "./routes/health.routes";
import { githubRouter } from "./routes/github.routes";
import { jsonWithRawBody } from "./middlewares/raw-body.middleware";
import { applySecurityMiddleware } from "./middlewares/security.middleware";
import { errorMiddleware, notFoundMiddleware } from "./middlewares/error.middleware";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  applySecurityMiddleware(app);
  app.use(jsonWithRawBody);

  app.use(healthRouter);
  app.use(githubRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}

export const app = createApp();
