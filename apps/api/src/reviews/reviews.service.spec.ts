// goal: test AI failure path, happy-path transaction, and human decision rules.

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, HumanDecisionType, ReviewStatus } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { ReviewsService } from './reviews.service';

describe('ReviewsService', () => {
  const prisma = {
    contentItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    reviewRequest: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    humanReviewDecision: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const aiService = {
    runContentReview: jest.fn(),
  } as unknown as AiService;

  let service: ReviewsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReviewsService(prisma as never, aiService);
  });

  it('throws when requesting a review for a missing content item', async () => {
    prisma.contentItem.findUnique.mockResolvedValue(null);

    await expect(service.requestReview('missing', 'u1')).rejects.toThrow(
      new NotFoundException('Content item not found'),
    );
  });

  it('marks review request as FAILED and throws ConflictException when AI fails', async () => {
    prisma.contentItem.findUnique.mockResolvedValue({
      id: 'c1',
      title: 'Title',
      contentType: 'LECTURE_NOTE',
      body: 'Body',
      rubricText: null,
      module: {
        title: 'M',
        description: 'Md',
        learningOutcomes: 'Lo',
        course: { title: 'C', description: 'Cd' },
      },
    });
    prisma.reviewRequest.create.mockResolvedValue({ id: 'r1' });
    (aiService.runContentReview as jest.Mock).mockRejectedValue(
      new Error('ollama down'),
    );

    await expect(service.requestReview('c1', 'u1')).rejects.toThrow(
      new ConflictException(
        'AI review failed. Check Ollama health and model availability.',
      ),
    );

    expect(prisma.reviewRequest.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: ReviewStatus.FAILED, completedAt: expect.any(Date) },
    });
  });

  it('creates review artifacts and returns hydrated review request on success', async () => {
    prisma.contentItem.findUnique.mockResolvedValue({
      id: 'c1',
      title: 'Title',
      contentType: 'LECTURE_NOTE',
      body: 'Body',
      rubricText: null,
      module: {
        title: 'M',
        description: 'Md',
        learningOutcomes: 'Lo',
        course: { title: 'C', description: 'Cd' },
      },
    });
    prisma.reviewRequest.create.mockResolvedValue({ id: 'r1' });
    (aiService.runContentReview as jest.Mock).mockResolvedValue({
      agentResults: [
        {
          agentType: 'STRUCTURE',
          findings: 'ok',
          confidenceScore: 0.9,
          confidenceLabel: 'HIGH',
          suggestedActions: 'none',
        },
      ],
      summary: 'Looks good',
      qualityScore: 90,
      confidenceLabel: 'HIGH',
      suggestedAction: 'APPROVE',
    });
    const tx = {
      contentItem: { update: jest.fn() },
      agentReview: { createMany: jest.fn() },
      finalReviewSummary: { create: jest.fn() },
      reviewRequest: { update: jest.fn() },
    };
    prisma.$transaction.mockImplementation(
      async (cb: (x: typeof tx) => unknown) => cb(tx),
    );
    // final read after requestReview finishes
    prisma.reviewRequest.findUnique.mockResolvedValue({
      id: 'r1',
      status: 'COMPLETED',
    });

    await expect(service.requestReview('c1', 'u1')).resolves.toEqual({
      id: 'r1',
      status: 'COMPLETED',
    });
    expect(tx.contentItem.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: ContentStatus.IN_REVIEW },
    });
    expect(tx.reviewRequest.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: ReviewStatus.COMPLETED, completedAt: expect.any(Date) },
    });
  });

  it('maps human decision to content status update', async () => {
    prisma.reviewRequest.findUnique.mockResolvedValue({
      id: 'r1',
      status: ReviewStatus.COMPLETED,
      contentItemId: 'c1',
    });
    prisma.humanReviewDecision.create.mockResolvedValue({ id: 'd1' });

    await service.setHumanDecision({
      reviewRequestId: 'r1',
      decidedById: 'u1',
      decision: HumanDecisionType.NEEDS_REVISION,
      notes: 'Fix clarity',
    });

    expect(prisma.contentItem.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: ContentStatus.NEEDS_REVISION },
    });
  });

  it('rejects decision when review is not completed yet', async () => {
    prisma.reviewRequest.findUnique.mockResolvedValue({
      id: 'r1',
      status: ReviewStatus.PENDING,
      contentItemId: 'c1',
    });

    await expect(
      service.setHumanDecision({
        reviewRequestId: 'r1',
        decidedById: 'u1',
        decision: HumanDecisionType.APPROVED,
      }),
    ).rejects.toThrow(
      new BadRequestException(
        'Human decision can only be set after AI review is completed',
      ),
    );
  });
});
