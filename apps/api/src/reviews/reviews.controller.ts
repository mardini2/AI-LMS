// goal: HTTP API to request AI reviews, read history, and record human decisions.

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';
import { ReviewDecisionDto } from './reviews.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

@Controller('reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post('content-items/:contentItemId/request')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER)
  async requestReview(
    @Param('contentItemId') contentItemId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const reviewRequest = await this.reviewsService.requestReview(
      contentItemId,
      request.user.sub,
    );

    await this.auditLogService.write({
      actorId: request.user.sub,
      action: 'AI_REVIEW_REQUESTED',
      entityType: 'ReviewRequest',
      entityId: reviewRequest.id,
      metadata: { contentItemId },
    });

    return reviewRequest;
  }

  @Get('content-items/:contentItemId/history')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async reviewHistory(@Param('contentItemId') contentItemId: string) {
    return this.reviewsService.getReviewHistoryByContent(contentItemId);
  }

  @Get(':reviewRequestId')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async getReviewRequest(@Param('reviewRequestId') reviewRequestId: string) {
    return this.reviewsService.getReviewRequestById(reviewRequestId);
  }

  @Patch(':reviewRequestId/decision')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER)
  async setDecision(
    @Param('reviewRequestId') reviewRequestId: string,
    @Body() body: ReviewDecisionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reviewsService.setHumanDecision({
      reviewRequestId,
      decidedById: request.user.sub,
      decision: body.decision,
      notes: body.notes,
    });
  }
}
