import { env } from "../../config/env";
import { prisma } from "../../config/database";
import type { GitHubPullRequest } from "../../types/github.types";
import type { ReviewAnalysis, ReviewFinding, ReviewJobPayload, ReviewSeverity } from "../../types/review.types";
import { HttpError } from "../../utils/http-error.util";
import { truncateText } from "../../utils/text.util";
import { GitHubApiService } from "../github/github-api.service";
import { GitHubCommentService } from "../github/github-comment.service";
import { GroqService } from "../ai/groq.service";
import { PromptBuilderService } from "../ai/prompt-builder.service";
import { ResponseParserService } from "../ai/response-parser.service";

const SEVERITY_RANK: Record<ReviewSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export type ReviewJobOutcome = { status: "completed"; analysis: ReviewAnalysis } | { status: "superseded"; reason: string };

/** Why this job should not post a review, or undefined when its commit is still the one to review. */
function supersededReason(pr: GitHubPullRequest, commitSha: string): string | undefined {
  if (pr.state === "closed") {
    return "pull request is closed";
  }

  if (pr.draft && !env.REVIEW_DRAFTS) {
    return "pull request is a draft";
  }

  if (pr.head.sha !== commitSha) {
    return `newer commit ${pr.head.sha.slice(0, 12)} is the pull request head`;
  }

  return undefined;
}

export function filterFindings(findings: ReviewFinding[], reviewedFiles: Set<string>, minSeverity: ReviewSeverity): ReviewFinding[] {
  return findings.filter(
    (finding) => reviewedFiles.has(finding.file) && SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[minSeverity]
  );
}

export class ReviewOrchestratorService {
  constructor(
    private readonly githubApi = new GitHubApiService(),
    private readonly commentService = new GitHubCommentService(),
    private readonly promptBuilder = new PromptBuilderService(),
    private readonly groqService = new GroqService(),
    private readonly responseParser = new ResponseParserService()
  ) {}

  async processReviewJob(job: ReviewJobPayload): Promise<ReviewJobOutcome> {
    const reviewJobRecord = await prisma.reviewJob.findUnique({
      where: { id: job.reviewJobId },
      include: { pullRequest: { include: { repository: true } } }
    });

    if (!reviewJobRecord) {
      throw new HttpError(404, `Review job ${job.reviewJobId} was not found`);
    }

    const { owner, name } = reviewJobRecord.pullRequest.repository;
    const commitSha = job.commitSha;

    const pullRequest = await this.githubApi.getPullRequest(owner, name, job.pullNumber, job.installationId);
    const staleBeforeReview = supersededReason(pullRequest, commitSha);
    if (staleBeforeReview) {
      return this.markSuperseded(job, staleBeforeReview);
    }

    const files = await this.githubApi.listPullRequestFiles(owner, name, job.pullNumber, job.installationId);
    const { included, skipped } = this.promptBuilder.selectFiles(files);

    let analysis: ReviewAnalysis;
    if (included.length === 0) {
      analysis = {
        summary:
          files.length === 0
            ? "No changed files were returned by GitHub."
            : "None of the changed files could be reviewed (see the list of files not reviewed).",
        findings: []
      };
    } else {
      const userPrompt = this.promptBuilder.buildUserPrompt({
        owner,
        repository: name,
        pullNumber: job.pullNumber,
        commitSha,
        title: pullRequest.title,
        body: pullRequest.body,
        files: included,
        skippedFiles: skipped
      });
      const groqResponse = await this.groqService.reviewCode(this.promptBuilder.buildSystemPrompt(), userPrompt);
      const parsed = this.responseParser.parse(groqResponse);

      analysis = {
        summary: parsed.summary,
        findings: filterFindings(parsed.findings, new Set(included.map((file) => file.filename)), env.REVIEW_MIN_SEVERITY)
      };
    }

    // The review took a while: if a newer commit was pushed meanwhile, its own job will post the review.
    const latestPullRequest = await this.githubApi.getPullRequest(owner, name, job.pullNumber, job.installationId);
    const staleAfterReview = supersededReason(latestPullRequest, commitSha);
    if (staleAfterReview) {
      return this.markSuperseded(job, staleAfterReview);
    }

    await this.commentService.postOrUpdateReviewComment(owner, name, job.pullNumber, job.installationId, analysis, commitSha, skipped);
    await this.commentService.postInlineReviewComments(owner, name, job.pullNumber, job.installationId, analysis, commitSha, included);

    await this.completeJob(job, analysis.findings);

    return { status: "completed", analysis };
  }

  /** Stores findings and marks the job, pull request, and webhook event done in one transaction. */
  private async completeJob(job: ReviewJobPayload, findings: ReviewFinding[]): Promise<void> {
    await prisma.$transaction([
      prisma.reviewFinding.deleteMany({ where: { reviewJobId: job.reviewJobId } }),
      prisma.reviewFinding.createMany({
        data: findings.map((finding) => ({
          reviewJobId: job.reviewJobId,
          severity: finding.severity,
          file: finding.file,
          line: finding.line ?? null,
          issue: finding.issue,
          explanation: finding.explanation,
          suggestion: finding.suggestedFix
        }))
      }),
      prisma.reviewJob.update({
        where: { id: job.reviewJobId },
        data: { status: "completed", completedAt: new Date(), model: env.GROQ_MODEL, error: null }
      }),
      prisma.pullRequest.update({
        where: { id: job.pullRequestId },
        data: {
          status: "reviewed",
          lastReviewedSha: job.commitSha,
          headSha: job.commitSha,
          sender: job.sender,
          installationId: BigInt(job.installationId)
        }
      }),
      prisma.webhookEvent.update({
        where: { id: job.webhookEventId },
        data: { processed: true, ignored: false, error: null }
      })
    ]);
  }

  private async markSuperseded(job: ReviewJobPayload, reason: string): Promise<ReviewJobOutcome> {
    await prisma.$transaction([
      prisma.reviewJob.update({
        where: { id: job.reviewJobId },
        data: { status: "superseded", completedAt: new Date(), error: `Skipped: ${reason}` }
      }),
      prisma.webhookEvent.update({
        where: { id: job.webhookEventId },
        data: { processed: true, error: null }
      })
    ]);

    return { status: "superseded", reason };
  }

  /**
   * Records a failed attempt and tells the PR author. Never throws: a failure here must not hide the
   * original error, which the caller rethrows so the queue can retry the job.
   */
  async markJobFailed(reviewJobId: number, error: unknown): Promise<void> {
    const message = truncateText(error instanceof Error ? error.message : "Unknown error", 2000);

    try {
      const reviewJobRecord = await prisma.reviewJob.findUnique({
        where: { id: reviewJobId },
        include: { pullRequest: { include: { repository: true } } }
      });

      if (!reviewJobRecord) {
        console.error(`Review job ${reviewJobId} was not found while recording a failure`);
        return;
      }

      await prisma.$transaction([
        prisma.reviewJob.update({
          where: { id: reviewJobRecord.id },
          data: { status: "failed", error: message, completedAt: new Date() }
        }),
        ...(reviewJobRecord.webhookEventId
          ? [
              prisma.webhookEvent.update({
                where: { id: reviewJobRecord.webhookEventId },
                data: { error: message, processed: false }
              })
            ]
          : []),
        prisma.pullRequest.update({
          where: { id: reviewJobRecord.pullRequestId },
          data: { status: "failed" }
        })
      ]);

      const { pullRequest } = reviewJobRecord;
      if (pullRequest.installationId !== null && reviewJobRecord.commitSha) {
        await this.commentService
          .postFailureComment(
            pullRequest.repository.owner,
            pullRequest.repository.name,
            pullRequest.prNumber,
            Number(pullRequest.installationId),
            reviewJobRecord.commitSha
          )
          .catch((commentError: unknown) => {
            console.error(`Unable to post failure comment for review job ${reviewJobId}`, commentError);
          });
      }
    } catch (recordError) {
      console.error(`Unable to record failure for review job ${reviewJobId}`, recordError);
    }
  }
}
