process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "3001";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/ai_code_review_agent?schema=public";
process.env.GITHUB_APP_ID = process.env.GITHUB_APP_ID || "123456";
process.env.GITHUB_PRIVATE_KEY =
  process.env.GITHUB_PRIVATE_KEY || "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBALe3\n-----END RSA PRIVATE KEY-----";
process.env.GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "test-webhook-secret";
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || "test-groq-api-key";
process.env.GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-70b-versatile";
