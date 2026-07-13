export type ReviewSeverity = "critical" | "high" | "medium" | "low";

export interface ReviewFinding {
  file: string;
  line: number | null;
  severity: ReviewSeverity;
  issue: string;
  explanation: string;
  suggestedFix: string;
}

export interface ReviewAnalysis {
  summary: string;
  findings: ReviewFinding[];
}

export interface ReviewJobPayload {
  reviewJobId: number;
  webhookEventId: number;
  repositoryId: number;
  pullRequestId: number;
  owner: string;
  repository: string;
  pullNumber: number;
  installationId: number;
  commitSha: string;
  sender: string;
}

export interface ReviewCommentContext {
  owner: string;
  repository: string;
  pullNumber: number;
  commitSha: string;
}

