import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { HttpError } from "../../utils/http-error.util";
import { fetchWithRetry } from "../../utils/http.util";
import { normalizeGitHubPrivateKey } from "../../utils/github-private-key.util";

interface CachedInstallationToken {
  token: string;
  expiresAt: number;
}

interface GitHubAccessTokenResponse {
  token: string;
  expires_at: string;
}

interface GitHubAppResponse {
  slug: string;
}

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "ai-code-review-agent"
};

export class GitHubAuthService {
  private readonly installationTokenCache = new Map<number, CachedInstallationToken>();
  private botLoginPromise: Promise<string> | undefined;

  private buildAppJwt(): string {
    const privateKey = normalizeGitHubPrivateKey(env.GITHUB_PRIVATE_KEY);
    const now = Math.floor(Date.now() / 1000);

    return jwt.sign(
      {
        iat: now - 60,
        exp: now + 540,
        iss: String(env.GITHUB_APP_ID)
      },
      privateKey,
      {
        algorithm: "RS256"
      }
    );
  }

  async getInstallationAccessToken(installationId: number): Promise<string> {
    const cachedToken = this.installationTokenCache.get(installationId);
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
      return cachedToken.token;
    }

    const response = await fetchWithRetry(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${this.buildAppJwt()}` }
      },
      // Creating an extra token is harmless, so every transient failure may be retried.
      { timeoutMs: env.GITHUB_TIMEOUT_MS, retries: 2, retryUnsafe: true }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new HttpError(
        response.status,
        `Failed to create installation access token: ${response.status} ${response.statusText} ${errorBody}`,
        false
      );
    }

    const data = (await response.json()) as GitHubAccessTokenResponse;
    this.installationTokenCache.set(installationId, {
      token: data.token,
      expiresAt: new Date(data.expires_at).getTime()
    });

    return data.token;
  }

  /** The login GitHub shows for comments this app writes, e.g. "my-review-app[bot]". */
  getBotLogin(): Promise<string> {
    this.botLoginPromise ??= this.fetchBotLogin().catch((error: unknown) => {
      this.botLoginPromise = undefined;
      throw error;
    });

    return this.botLoginPromise;
  }

  private async fetchBotLogin(): Promise<string> {
    const response = await fetchWithRetry(
      "https://api.github.com/app",
      { headers: { ...GITHUB_HEADERS, Authorization: `Bearer ${this.buildAppJwt()}` } },
      { timeoutMs: env.GITHUB_TIMEOUT_MS, retries: 2, retryUnsafe: true }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new HttpError(response.status, `Failed to read GitHub App details: ${errorBody}`, false);
    }

    const data = (await response.json()) as GitHubAppResponse;
    return `${data.slug}[bot]`;
  }
}
