// goal: ensure review requests log audit and decisions pass through IDs.

import { HumanDecisionType } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

describe('ReviewsController', () => {
  const reviewsService = {
    requestReview: jest.fn(),
    getReviewHistoryByContent: jest.fn(),
    getReviewRequestById: jest.fn(),
    setHumanDecision: jest.fn(),
  } as unknown as ReviewsService;

  const auditLogService = {
    write: jest.fn(),
  } as unknown as AuditLogService;

  let controller: ReviewsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ReviewsController(reviewsService, auditLogService);
  });

  it('requests review and writes audit log', async () => {
    (reviewsService.requestReview as jest.Mock).mockResolvedValue({ id: 'r1' });

    await expect(
      controller.requestReview('content-1', { user: { sub: 'u1' } } as never),
    ).resolves.toEqual({ id: 'r1' });

    expect(reviewsService.requestReview).toHaveBeenCalledWith(
      'content-1',
      'u1',
    );
    expect(auditLogService.write).toHaveBeenCalledWith({
      actorId: 'u1',
      action: 'AI_REVIEW_REQUESTED',
      entityType: 'ReviewRequest',
      entityId: 'r1',
      metadata: { contentItemId: 'content-1' },
    });
  });

  it('forwards decision payload and user context', async () => {
    (reviewsService.setHumanDecision as jest.Mock).mockResolvedValue({
      id: 'd1',
    });

    await expect(
      controller.setDecision(
        'r1',
        { decision: HumanDecisionType.APPROVED, notes: 'ok' },
        { user: { sub: 'reviewer-1' } } as never,
      ),
    ).resolves.toEqual({ id: 'd1' });

    expect(reviewsService.setHumanDecision).toHaveBeenCalledWith({
      reviewRequestId: 'r1',
      decidedById: 'reviewer-1',
      decision: HumanDecisionType.APPROVED,
      notes: 'ok',
    });
  });
});
