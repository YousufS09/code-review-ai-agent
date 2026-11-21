import cors from "cors";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { Express } from "express";
import { env, isProduction } from "../config/env";

export function applySecurityMiddleware(app: Express): void {
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(",").map((value) => value.trim()) : false,
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type", "X-GitHub-Event", "X-GitHub-Delivery", "X-Hub-Signature-256"],
      credentials: false
    })
  );
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: isProduction ? 300 : 1000,
      standardHeaders: true,
      legacyHeaders: false,
      // GitHub sends every webhook from a few shared IPs, so per-IP limits would drop real deliveries
      // (GitHub does not retry them). Webhooks are authenticated by their HMAC signature instead.
      skip: (request) =>
        request.path === "/health" ||
        request.path === "/ready" ||
        (request.method === "POST" && request.path === "/webhooks/github")
    })
  );
}