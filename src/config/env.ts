import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";
import {
  normalizeGitHubPrivateKey,
  normalizeGitHubSecretValue,
  readGitHubPrivateKeyFromEnvFile
} from "../utils/github-private-key.util";

const envPath = path.resolve(__dirname, "../../.env");

dotenv.config({
  path: envPath
});

const envFilePrivateKey = readGitHubPrivateKeyFromEnvFile(envPath);
const currentPrivateKey = process.env.GITHUB_PRIVATE_KEY;
const currentWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

if (envFilePrivateKey && (!currentPrivateKey || !normalizeGitHubPrivateKey(currentPrivateKey).includes("-----END"))) {
  process.env.GITHUB_PRIVATE_KEY = envFilePrivateKey;
} else if (currentPrivateKey) {
  process.env.GITHUB_PRIVATE_KEY = normalizeGitHubPrivateKey(currentPrivateKey);
}

if (currentWebhookSecret) {
  process.env.GITHUB_WEBHOOK_SECRET = normalizeGitHubSecretValue(currentWebhookSecret);
}

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
  GROQ_MODEL: z.string().min(1).default("llama-3.3-70b-versatile"),
  GROQ_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  GROQ_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  GITHUB_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  CORS_ORIGIN: z.string().optional(),
  /** Comma-separated GitHub owners (users/orgs) allowed to use this app. Empty = allow all installations. */
  ALLOWED_GITHUB_OWNERS: z.string().optional().transform(parseList),
  /** Total characters of diff sent to the model per review (~4 characters per token). */
  REVIEW_MAX_PROMPT_CHARS: z.coerce.number().int().positive().default(40_000),
  /** Characters of diff sent per file before truncation. */
  REVIEW_MAX_PATCH_CHARS: z.coerce.number().int().positive().default(6_000),
  /** Extra comma-separated glob patterns for files that should never be reviewed. */
  REVIEW_IGNORE_PATTERNS: z.string().optional().transform(parseList),
  /** Lowest severity that is reported. */
  REVIEW_MIN_SEVERITY: z.enum(["critical", "high", "medium", "low"]).default("low"),
  /** Whether draft pull requests are reviewed. */
  REVIEW_DRAFTS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Days to keep processed webhook events (and their payloads) in the database. */
  WEBHOOK_RETENTION_DAYS: z.coerce.number().int().positive().default(30)
});

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const testDefaults = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ai_code_review_agent_test?schema=public",
  GITHUB_APP_ID: "123456",
  GITHUB_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBALe3\n-----END RSA PRIVATE KEY-----",
  GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
  GROQ_API_KEY: "test-groq-api-key",
  GROQ_MODEL: "llama-3.3-70b-versatile"
};

const rawEnv = process.env.NODE_ENV === "test" ? { ...testDefaults, ...process.env } : process.env;
const parsedEnv = baseSchema.safeParse(rawEnv);

if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = parsedEnv.data;
export const isProduction = env.NODE_ENV === "production";

if (isProduction && env.ALLOWED_GITHUB_OWNERS.length === 0) {
  console.warn(
    "ALLOWED_GITHUB_OWNERS is not set: any account that installs this GitHub App can trigger reviews and spend Groq credits."
  );
}
