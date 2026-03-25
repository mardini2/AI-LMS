// goal: connect AI review runs, human decisions, and audit logging for review flows.

import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { AiModule } from '../ai/ai.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AiModule, AuditLogModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
