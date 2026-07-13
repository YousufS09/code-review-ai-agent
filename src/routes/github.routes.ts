import { Router } from "express";
import { handleGithubWebhook } from "../controllers/github.controller";
import { wrapAsync } from "../middlewares/error.middleware";

export const githubRouter = Router();

githubRouter.post("/webhooks/github", wrapAsync(handleGithubWebhook));