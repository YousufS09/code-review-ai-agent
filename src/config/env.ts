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
  GROQ_MODEL: z.string().min(1).default("llama-3.1-70b-versatile"),
  CORS_ORIGIN: z.string().optional()
});

const testDefaults = {
  DATABASE_URL: "postgresql://admin_user:admin123@localhost:5432/code_review_agentic_ai_db?schema=public",
  GITHUB_APP_ID: "123456",
  GITHUB_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBALe3\n-----END RSA PRIVATE KEY-----",
  GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
  GROQ_API_KEY: "test-groq-api-key",
  GROQ_MODEL: "llama-3.1-70b-versatile"
};

const rawEnv = process.env.NODE_ENV === "test" ? { ...testDefaults, ...process.env } : process.env;
const parsedEnv = baseSchema.safeParse(rawEnv);

if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = parsedEnv.data;
export const isProduction = env.NODE_ENV === "production";
