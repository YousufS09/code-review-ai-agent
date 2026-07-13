export interface GitHubInstallation {
  id: number;
}

export interface GitHubUser {
  login: string;
}

export interface GitHubRepositoryOwner {
  login: string;
}

export interface GitHubRepository {
  name: string;
  owner: GitHubRepositoryOwner;
  full_name?: string;
}

export interface GitHubPullRequestRef {
  sha: string;
}

export interface GitHubPullRequest {
  number: number;
  head: GitHubPullRequestRef;
  html_url?: string;
  title?: string;
  body?: string | null;
}

export interface GitHubPullRequestWebhookPayload {
  action: string;
  installation: GitHubInstallation;
  repository: GitHubRepository;
  pull_request: GitHubPullRequest;
  sender: GitHubUser;
}

export interface GitHubPullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface GitHubIssueComment {
  id: number;
  body: string;
  user: GitHubUser;
  updated_at: string;
  created_at: string;
}

export interface GitHubReviewContext {
  owner: string;
  repository: string;
  pullNumber: number;
  installationId: number;
  commitSha: string;
  sender: string;
}

