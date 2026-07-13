import { env } from "../../config/env";
import { prisma } from "../../config/database";
import type { GitHubPullRequest } from "../../types/github.types";
import type { ReviewAnalysis, ReviewFinding, ReviewJobPayload } from "../../types/review.types";
import { HttpError } from "../../utils/http-error.util";
import { GitHubApiService } from "../github/github-api.service";
import { GitHubCommentService } from "../github/github-comment.service";
import { GroqService } from "../ai/groq.service";
import { PromptBuilderService } from "../ai/prompt-builder.service";
import { ResponseParserService } from "../ai/response-parser.service";

function normalizeCommitSha(pr: GitHubPullRequest, fallbackSha: string): string {
  return pr.head?.sha || fallbackSha;
}

export class ReviewOrchestratorService {
  constructor(
    private readonly githubApi = new GitHubApiService(),
    private readonly commentService = new GitHubCommentService(),
    private readonly promptBuilder = new PromptBuilderService(),
    private readonly groqService = new GroqService(),
    private readonly responseParser = new ResponseParserService()
  ) {}

  private async persistFindings(reviewJobId: number, findings: ReviewFinding[]): Promise<void> {
    await prisma.reviewFinding.deleteMany({ where: { reviewJobId } });

    if (findings.length === 0) {
      return;
    }

    await prisma.reviewFinding.createMany({
      data: findings.map((finding) => ({
        reviewJobId,
        severity: finding.severity,
        file: finding.file,
        line: finding.line ?? null,
        issue: finding.issue,
        explanation: finding.explanation,
        suggestion: finding.suggestedFix
      }))
    });
  }

  async processReviewJob(job: ReviewJobPayload): Promise<ReviewAnalysis> {
    const reviewJobRecord = await prisma.reviewJob.findUnique({
      where: { id: job.reviewJobId },
      include: { pullRequest: { include: { repository: true } }, webhookEvent: true }
    });

    if (!reviewJobRecord) {
      throw new HttpError(404, `Review job ${job.reviewJobId} was not found`);
    }

    await prisma.reviewJob.update({
      where: { id: reviewJobRecord.id },
      data: {
        status: "processing",
        startedAt: new Date()
      }
    });

    const repository = reviewJobRecord.pullRequest.repository;
    const pullRequest = await this.githubApi.getPullRequest(repository.owner, repository.name, job.pullNumber, job.installationId);
    const commitSha = normalizeCommitSha(pullRequest, job.commitSha);
    const files = await this.githubApi.listPullRequestFiles(repository.owner, repository.name, job.pullNumber, job.installationId);

    if (files.length === 0) {
      const analysis: ReviewAnalysis = {
        summary: "No major issues were detected in the changed files returned by GitHub.",
        findings: []
      };

      await this.persistFindings(reviewJobRecord.id, analysis.findings);
      await this.commentService.postOrUpdateReviewComment(
        repository.owner,
        repository.name,
        job.pullNumber,
        job.installationId,
        analysis,
        commitSha
      );

      await prisma.reviewJob.update({
        where: { id: reviewJobRecord.id },
        data: {
          status: "completed",
          completedAt: new Date(),
          model: env.GROQ_MODEL
        }
      });

      await prisma.pullRequest.update({
        where: { id: reviewJobRecord.pullRequestId },
        data: {
          status: "reviewed",
          lastReviewedSha: commitSha,
          headSha: commitSha,
          sender: job.sender,
          installationId: BigInt(job.installationId)
        }
      });

      if (reviewJobRecord.webhookEventId) {
        await prisma.webhookEvent.update({
          where: { id: reviewJobRecord.webhookEventId },
          data: { processed: true, ignored: false, error: null }
        });
      }

      return analysis;
    }

    const systemPrompt = this.promptBuilder.buildSystemPrompt();
    const userPrompt = this.promptBuilder.buildUserPrompt({
      owner: repository.owner,
      repository: repository.name,
      pullNumber: job.pullNumber,
      commitSha,
      title: pullRequest.title,
      body: pullRequest.body,
      files
    });

    const groqResponse = await this.groqService.reviewCode(systemPrompt, userPrompt);
    const analysis = this.responseParser.parse(groqResponse);

    await this.persistFindings(reviewJobRecord.id, analysis.findings);
    await this.commentService.postOrUpdateReviewComment(
      repository.owner,
      repository.name,
      job.pullNumber,
      job.installationId,
      analysis,
      commitSha
    );

    await prisma.reviewJob.update({
      where: { id: reviewJobRecord.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        model: env.GROQ_MODEL,
        error: null
      }
    });

    await prisma.pullRequest.update({
      where: { id: reviewJobRecord.pullRequestId },
      data: {
        status: "reviewed",
        lastReviewedSha: commitSha,
        headSha: commitSha,
        sender: job.sender,
        installationId: BigInt(job.installationId)
      }
    });

    if (reviewJobRecord.webhookEventId) {
      await prisma.webhookEvent.update({
        where: { id: reviewJobRecord.webhookEventId },
        data: { processed: true, ignored: false, error: null }
      });
    }

    return analysis;
  }

  async markJobFailed(reviewJobId: number, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : "Unknown error";
    const reviewJobRecord = await prisma.reviewJob.findUnique({
      where: { id: reviewJobId },
      include: { pullRequest: true }
    });

    if (!reviewJobRecord) {
      throw new HttpError(404, `Review job ${reviewJobId} was not found`);
    }

    await prisma.reviewJob.update({
      where: { id: reviewJobId },
      data: {
        status: "failed",
        error: message,
        completedAt: new Date()
      }
    });

    if (reviewJobRecord.webhookEventId) {
      await prisma.webhookEvent.update({
        where: { id: reviewJobRecord.webhookEventId },
        data: { error: message, processed: false }
      });
    }

    await prisma.pullRequest.update({
      where: { id: reviewJobRecord.pullRequestId },
      data: {
        status: "failed"
      }
    });
  }
}
