import { env } from "../../config/env";
import { HttpError } from "../../utils/http-error.util";
import { fetchWithRetry } from "../../utils/http.util";
import { truncateText } from "../../utils/text.util";
import type {
  GitHubIssueComment,
  GitHubPullRequest,
  GitHubPullRequestFile,
  GitHubPullRequestReview,
  GitHubPullRequestReviewComment,
  GitHubPullRequestReviewCommentInput
} from "../../types/github.types";
import { GitHubAuthService } from "./auth.service";

type RequestMethod = "GET" | "POST" | "PATCH";

interface GitHubRequestOptions {
  method?: RequestMethod;
  body?: unknown;
}

export class GitHubApiService {
  constructor(private readonly authService = new GitHubAuthService()) {}

  private async request<T>(installationId: number, path: string, options: GitHubRequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const token = await this.authService.getInstallationAccessToken(installationId);
    const response = await fetchWithRetry(
      `https://api.github.com${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "ai-code-review-agent",
          ...(options.body ? { "Content-Type": "application/json" } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      },
      // POST creates comments/reviews: retrying after a timeout could post them twice.
      { timeoutMs: env.GITHUB_TIMEOUT_MS, retries: 2, retryUnsafe: method !== "POST" }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new HttpError(response.status, `GitHub API request failed for ${path}: ${truncateText(errorBody, 500)}`, false);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private async requestPaginated<T>(installationId: number, path: string): Promise<T[]> {
    const results: T[] = [];
    let page = 1;

    while (true) {
      const separator = path.includes("?") ? "&" : "?";
      const currentPage = await this.request<T[]>(installationId, `${path}${separator}per_page=100&page=${page}`);
      results.push(...currentPage);

      if (currentPage.length < 100) {
        break;
      }

      page += 1;
    }

    return results;
  }

  getBotLogin(): Promise<string> {
    return this.authService.getBotLogin();
  }

  async getPullRequest(owner: string, repository: string, pullNumber: number, installationId: number): Promise<GitHubPullRequest> {
    return this.request<GitHubPullRequest>(installationId, `/repos/${owner}/${repository}/pulls/${pullNumber}`);
  }

  async listPullRequestFiles(
    owner: string,
    repository: string,
    pullNumber: number,
    installationId: number
  ): Promise<GitHubPullRequestFile[]> {
    return this.requestPaginated<GitHubPullRequestFile>(installationId, `/repos/${owner}/${repository}/pulls/${pullNumber}/files`);
  }

  async listIssueComments(
    owner: string,
    repository: string,
    pullNumber: number,
    installationId: number
  ): Promise<GitHubIssueComment[]> {
    return this.requestPaginated<GitHubIssueComment>(installationId, `/repos/${owner}/${repository}/issues/${pullNumber}/comments`);
  }

  async createIssueComment(
    owner: string,
    repository: string,
    pullNumber: number,
    installationId: number,
    body: string
  ): Promise<GitHubIssueComment> {
    return this.request<GitHubIssueComment>(installationId, `/repos/${owner}/${repository}/issues/${pullNumber}/comments`, {
      method: "POST",
      body: { body }
    });
  }

  async updateIssueComment(
    owner: string,
    repository: string,
    commentId: number,
    installationId: number,
    body: string
  ): Promise<GitHubIssueComment> {
    return this.request<GitHubIssueComment>(installationId, `/repos/${owner}/${repository}/issues/comments/${commentId}`, {
      method: "PATCH",
      body: { body }
    });
  }

  async listPullRequestReviewComments(
    owner: string,
    repository: string,
    pullNumber: number,
    installationId: number
  ): Promise<GitHubPullRequestReviewComment[]> {
    return this.requestPaginated<GitHubPullRequestReviewComment>(
      installationId,
      `/repos/${owner}/${repository}/pulls/${pullNumber}/comments`
    );
  }

  /** Posts all inline comments as one review: one API call and one notification. */
  async createPullRequestReview(
    owner: string,
    repository: string,
    pullNumber: number,
    installationId: number,
    commitSha: string,
    body: string,
    comments: GitHubPullRequestReviewCommentInput[]
  ): Promise<GitHubPullRequestReview> {
    return this.request<GitHubPullRequestReview>(installationId, `/repos/${owner}/${repository}/pulls/${pullNumber}/reviews`, {
      method: "POST",
      body: {
        commit_id: commitSha,
        event: "COMMENT",
        body,
        comments
      }
    });
  }

  async createPullRequestReviewComment(
    owner: string,
    repository: string,
    pullNumber: number,
    installationId: number,
    commitSha: string,
    comment: GitHubPullRequestReviewCommentInput
  ): Promise<GitHubPullRequestReviewComment> {
    return this.request<GitHubPullRequestReviewComment>(
      installationId,
      `/repos/${owner}/${repository}/pulls/${pullNumber}/comments`,
      {
        method: "POST",
        body: {
          commit_id: commitSha,
          ...comment
        }
      }
    );
  }
}
