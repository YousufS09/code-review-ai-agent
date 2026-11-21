import { Router } from "express";
import { prisma } from "../config/database";

export const healthRouter = Router();

healthRouter.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok"
  });
});

healthRouter.get("/ready", async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.status(200).json({
      status: "ready"
    });
  } catch (error) {
    // Log details server-side only: database errors can reveal hosts and connection settings.
    console.error("Readiness check failed", error);
    response.status(503).json({
      status: "not ready"
    });
  }
});
