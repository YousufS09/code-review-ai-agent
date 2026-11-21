import { z } from "zod";

export const GithubWebhookHeadersSchema = z.object({
  event: z.string().min(1),
  delivery: z.string().min(1),
  signature256: z.string().min(1).optional()
});

export const GitHubWebhookInstallationSchema = z.object({
  id: z.number().int().positive()
});

export const GitHubWebhookRepositorySchema = z.object({
  name: z.string().min(1),
  owner: z.object({
    login: z.string().min(1)
  })
});

export const GitHubWebhookPullRequestSchema = z.object({
  number: z.number().int().positive(),
  head: z.object({
    sha: z.string().min(1)
  }),
  draft: z.boolean().optional()
});

export const GitHubWebhookSenderSchema = z.object({
  login: z.string().min(1)
});

export const GitHubPullRequestWebhookSchema = z
  .object({
    action: z.string().min(1),
    installation: GitHubWebhookInstallationSchema,
    repository: GitHubWebhookRepositorySchema,
    pull_request: GitHubWebhookPullRequestSchema,
    sender: GitHubWebhookSenderSchema
  })
  .passthrough();

export type SupportedPullRequestAction = "opened" | "synchronize" | "reopened" | "ready_for_review";

export const supportedPullRequestActions = new Set<SupportedPullRequestAction>([
  "opened",
  "synchronize",
  "reopened",
  "ready_for_review"
]);

export function isSupportedPullRequestAction(action: string): action is SupportedPullRequestAction {
  return supportedPullRequestActions.has(action as SupportedPullRequestAction);
}

