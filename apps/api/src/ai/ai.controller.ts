// goal: HTTP routes for coaching chat and student guidance tied to a content item.

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CoachingQuestionDto, StudentGuidanceDto } from './dto-coaching.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('coaching/content-items/:contentItemId/chat')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async chat(
    @Param('contentItemId') contentItemId: string,
    @Body() body: CoachingQuestionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.aiService.askCoachingQuestion({
      contentItemId,
      userId: request.user.sub,
      userRole: request.user.role as Role,
      question: body.question,
      studentDraft: body.studentDraft,
    });
  }

  @Get('coaching/content-items/:contentItemId/history')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async coachingHistory(
    @Param('contentItemId') contentItemId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.aiService.listCoachingHistory({
      contentItemId,
      userId: request.user.sub,
      userRole: request.user.role as Role,
    });
  }

  @Post('student-guidance/content-items/:contentItemId')
  @Roles(Role.STUDENT)
  async studentGuidance(
    @Param('contentItemId') contentItemId: string,
    @Body() body: StudentGuidanceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.aiService.askStudentGuidance({
      contentItemId,
      studentId: request.user.sub,
      studentQuestion: body.question,
    });
  }
}
