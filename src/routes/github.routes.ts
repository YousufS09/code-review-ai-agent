import { Router } from "express";
import { handleGithubWebhook } from "../controllers/github.controller";

export const githubRouter = Router();

export const GITHUB_WEBHOOK_PATH = "/webhooks/github";

// Express 5 forwards rejected promises from async handlers to the error middleware.
githubRouter.post(GITHUB_WEBHOOK_PATH, handleGithubWebhook);
