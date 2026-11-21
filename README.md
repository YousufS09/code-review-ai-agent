# AI Code Review Agent

Backend-only AI agent that reviews GitHub Pull Requests using a GitHub App, PostgreSQL, Prisma and Groq.

When a pull request is opened, synchronized, reopened, or marked ready for review, the service:

1. Verifies the GitHub webhook signature.
2. Saves a review job to a durable Postgres-backed queue (pg-boss) and acknowledges the webhook.
3. A worker stores the webhook event, then fetches the Pull Request and its changed files.
4. Skips the job if the commit is no longer the PR head, or the PR is closed or a draft.
5. Filters out generated/vendored files, fits the rest into a size budget, and sends the diff to Groq.
6. Posts or updates one summary comment and posts inline findings as a single PR review.

Failed jobs are retried with backoff; if a review cannot be completed, the summary comment says so.

The architecture is intentionally repository-scoped today, but the data model and service boundaries are designed so we can expand to multiple repositories or a full GitHub Organization later without reworking the core pipeline.

## Architecture

```text
GitHub Pull Request
    |
    v
POST /webhooks/github
    |
    v
Webhook signature verification
    |
    v
pg-boss job queue (PostgreSQL)  --> 202 Accepted
    |
    v
Worker: WebhookEvent + ReviewJob records in PostgreSQL
    |
    v
GitHub REST API (installation token)
    |
    v
Groq LLM
    |
    v
GitHub PR summary comment + batched inline review
```

## Tech Stack

- Node.js
- Express.js
- TypeScript
- PostgreSQL
- Prisma ORM
- pg-boss (durable job queue)
- Groq LLM
- GitHub App + GitHub Webhooks
- Zod
- Helmet
- CORS
- Express Rate Limit
- Jest

## Folder Structure

```text
ai-code-review-agent/
|-- src/
|   |-- config/
|   |-- controllers/
|   |-- middlewares/
|   |-- routes/
|   |-- services/
|   |-- types/
|   |-- utils/
|   |-- validators/
|   |-- app.ts
|   `-- server.ts
|-- prisma/
|   |-- schema.prisma
|   `-- migrations/
|-- tests/
|-- .env.example
|-- eslint.config.js
|-- jest.config.js
|-- package.json
`-- tsconfig.json
```

## Project Structure Notes

- `src/controllers` receives webhooks and delegates immediately.
- `src/services/review` owns webhook handling and review orchestration.
- `src/services/github` owns GitHub App auth, API calls, and comment posting.
- `src/services/ai` owns prompt construction and Groq response parsing.
- `src/middlewares` contains security, raw body capture, and error handling.

## Installation

```bash
npm install
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
NODE_ENV=
PORT=
DATABASE_URL=
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
GROQ_API_KEY=
GROQ_MODEL=
CORS_ORIGIN=
```

Optional settings (see `.env.example` for defaults):

| Variable | Purpose |
| --- | --- |
| `ALLOWED_GITHUB_OWNERS` | Comma-separated users/orgs allowed to use the app. Empty allows every installation (a warning is logged in production). |
| `GROQ_TEMPERATURE`, `GROQ_TIMEOUT_MS` | Model temperature and per-request timeout. |
| `GITHUB_TIMEOUT_MS` | Per-request timeout for GitHub API calls. |
| `REVIEW_MAX_PROMPT_CHARS`, `REVIEW_MAX_PATCH_CHARS` | Total and per-file diff size sent to the model. Files beyond the budget are listed as not reviewed. |
| `REVIEW_IGNORE_PATTERNS` | Extra globs to skip (lockfiles, `dist/`, `vendor/`, minified files are always skipped). |
| `REVIEW_MIN_SEVERITY` | Lowest severity reported (`critical`, `high`, `medium`, `low`). |
| `REVIEW_DRAFTS` | `true` to review draft PRs. |
| `WEBHOOK_RETENTION_DAYS` | Days to keep processed webhook events and their payloads. |

The database user needs permission to create a schema: pg-boss creates its own `pgboss` schema on first start.

## PostgreSQL Setup

Create a database for the app and apply the Prisma migration:

```bash
npx prisma generate
npx prisma migrate deploy
```

For local development, you can also use:

```bash
npx prisma migrate dev
```

## GitHub App Configuration

Create a GitHub App with these permissions:

- Pull Requests: Read and write
- Contents: Read-only
- Metadata: Read-only
- Issues: Read and write for the PR conversation comment used by this MVP

Enable webhook delivery for the repository and set the webhook secret to match `GITHUB_WEBHOOK_SECRET`.

Required webhook event:

- `pull_request`

The app should be installed on the target personal repository.

## Webhook Configuration

Set the webhook URL to:

```text
POST /webhooks/github
```

Handle these pull request actions:

- `opened`
- `synchronize`
- `reopened`
- `ready_for_review`

All other events are ignored. Draft PRs are skipped unless `REVIEW_DRAFTS=true`.

## Ngrok Local Testing

Expose your local API with ngrok:

```bash
ngrok http 3000
```

Then configure the GitHub App webhook URL to the ngrok HTTPS URL, for example:

```text
https://abcd-1234.ngrok-free.app/webhooks/github
```

## Running the API

```bash
npm run dev
```

Health endpoints:

- `GET /health`
- `GET /ready`

## Testing

```bash
npm test
```

Run a single test file:

```bash
npx jest tests/unit/crypto.util.test.ts
```

## Production Build

```bash
npm ci
npm run build          # generates the Prisma client and compiles TypeScript
npm run prisma:deploy  # applies database migrations
npm start              # runs the API and the review worker
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, migrations against a clean Postgres, and the build.

## AWS Deployment

This project is designed to deploy cleanly on AWS using:

- EC2 or ECS for the API container or service
- Amazon RDS for PostgreSQL
- AWS Secrets Manager for environment variables
- CloudWatch Logs for application logs

Deployment notes:

- Keep the API process simple and stateless.
- Store secrets outside the image.
- Run Prisma migrations as part of your deployment pipeline.
- Do not hardcode AWS-specific resource identifiers in the codebase.

## Security Controls

- GitHub webhook signature verification
- Raw request body capture for webhooks
- Owner allowlist (`ALLOWED_GITHUB_OWNERS`)
- Helmet
- Secure CORS
- Rate limiting (signed webhooks are exempt, because GitHub delivers from shared IPs)
- Zod validation
- Centralized error handling; internal error details are never returned to callers
- Model output is sanitized before posting: no HTML, hidden comments, @-mentions, or disguised links
- PR content is passed to the model as untrusted data (prompt injection is reduced, not eliminated)

## AI Prompt Behavior

The model is instructed to behave like a senior software engineer and:

- Review only changed code.
- Ignore unrelated files.
- Prioritize correctness, security, maintainability, and performance.
- Return valid JSON only.

## Commenting Behavior

The bot posts one PR comment and updates it in place whenever possible using this marker:

```html
<!-- ai-code-review-agent -->
```

This avoids duplicate comments while keeping the latest analysis visible in the pull request. Only a comment written by this app is updated, so a user pasting the marker cannot redirect it.

Inline findings are posted as one PR review (one notification). Each inline comment carries a fingerprint, so the same finding is not posted again on later pushes even if its line moves.

## Database Models

Core tables:

- `Repository`
- `PullRequest`
- `ReviewJob`
- `ReviewFinding`
- `WebhookEvent`

The schema is relational and designed to support future organization-wide review workflows.

## Future Roadmap

- GitHub Organization support
- Comment threading and dismissal handling
- Reviewing large pull requests in several model calls instead of a single size budget
- Per-repository configuration file
- Read API or dashboard for stored findings
- Rule-based prefilters before LLM review
- Multi-model routing
- Metrics and dashboards
- GitHub App installation management UI

## License

This MVP is provided for internal engineering use and can be adapted to your team's licensing requirements.
