// goal: orchestrate Prisma review rows + AiService multi-agent output and human follow-up.

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConfidenceLabel,
  ContentStatus,
  HumanDecisionType,
  ReviewStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async requestReview(contentItemId: string, requestedById: string) {
    const contentItem = await this.prisma.contentItem.findUnique({
      where: { id: contentItemId },
      include: {
        module: {
          include: {
            course: true,
          },
        },
      },
    });

    if (!contentItem) {
      throw new NotFoundException('Content item not found');
    }

    const reviewRequest = await this.prisma.reviewRequest.create({
      data: {
        contentItemId,
        requestedById,
        status: ReviewStatus.PENDING,
      },
    });

    let reviewOutput: Awaited<ReturnType<AiService['runContentReview']>>;
    try {
      // pulls course/module/content context into prompts; may throw if Ollama is down
      reviewOutput = await this.aiService.runContentReview({
        courseTitle: contentItem.module.course.title,
        courseDescription: contentItem.module.course.description,
        moduleTitle: contentItem.module.title,
        moduleDescription: contentItem.module.description,
        moduleLearningOutcomes: contentItem.module.learningOutcomes,
        contentTitle: contentItem.title,
        contentType: contentItem.contentType,
        contentBody: contentItem.body,
        rubricText: contentItem.rubricText,
      });
    } catch (error) {
      await this.prisma.reviewRequest.update({
        where: { id: reviewRequest.id },
        data: { status: ReviewStatus.FAILED, completedAt: new Date() },
      });
      throw new ConflictException(
        'AI review failed. Check Ollama health and model availability.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.contentItem.update({
        where: { id: contentItemId },
        data: { status: ContentStatus.IN_REVIEW },
      });

      await tx.agentReview.createMany({
        data: reviewOutput.agentResults.map((result) => ({
          reviewRequestId: reviewRequest.id,
          agentType: result.agentType,
          findings: result.findings,
          confidenceScore: result.confidenceScore,
          confidenceLabel: result.confidenceLabel as ConfidenceLabel,
          suggestedActions: result.suggestedActions,
        })),
      });

      await tx.finalReviewSummary.create({
        data: {
          reviewRequestId: reviewRequest.id,
          summaryText: reviewOutput.summary,
          qualityScore: reviewOutput.qualityScore,
          confidenceLabel: reviewOutput.confidenceLabel as ConfidenceLabel,
          suggestedAction: reviewOutput.suggestedAction,
        },
      });

      await tx.reviewRequest.update({
        where: { id: reviewRequest.id },
        data: {
          status: ReviewStatus.COMPLETED,
          completedAt: new Date(),
        },
      });
    });

    return this.getReviewRequestById(reviewRequest.id);
  }

  async getReviewHistoryByContent(contentItemId: string) {
    return this.prisma.reviewRequest.findMany({
      where: { contentItemId },
      include: {
        requestedBy: {
          select: { id: true, fullName: true, role: true },
        },
        finalSummary: true,
        humanDecisions: {
          include: {
            decidedBy: {
              select: { id: true, fullName: true, role: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReviewRequestById(reviewRequestId: string) {
    const reviewRequest = await this.prisma.reviewRequest.findUnique({
      where: { id: reviewRequestId },
      include: {
        contentItem: {
          include: { module: { include: { course: true } } },
        },
        requestedBy: { select: { id: true, fullName: true, role: true } },
        agentReviews: true,
        finalSummary: true,
        humanDecisions: {
          include: {
            decidedBy: {
              select: { id: true, fullName: true, role: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!reviewRequest) {
      throw new NotFoundException('Review request not found');
    }

    return reviewRequest;
  }

  async setHumanDecision(input: {
    reviewRequestId: string;
    decidedById: string;
    decision: HumanDecisionType;
    notes?: string;
  }) {
    const reviewRequest = await this.prisma.reviewRequest.findUnique({
      where: { id: input.reviewRequestId },
    });

    if (!reviewRequest) {
      throw new NotFoundException('Review request not found');
    }

    if (reviewRequest.status !== ReviewStatus.COMPLETED) {
      throw new BadRequestException(
        'Human decision can only be set after AI review is completed',
      );
    }

    const humanDecision = await this.prisma.humanReviewDecision.create({
      data: {
        reviewRequestId: input.reviewRequestId,
        decidedById: input.decidedById,
        decision: input.decision,
        notes: input.notes,
      },
    });

    const nextContentStatus: ContentStatus =
      input.decision === HumanDecisionType.APPROVED
        ? ContentStatus.APPROVED
        : input.decision === HumanDecisionType.NEEDS_REVISION
          ? ContentStatus.NEEDS_REVISION
          : ContentStatus.REJECTED;

    await this.prisma.contentItem.update({
      where: { id: reviewRequest.contentItemId },
      data: { status: nextContentStatus },
    });

    return humanDecision;
  }
}
