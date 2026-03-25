// goal: wire content items, submissions, file uploads, and audit logging.

import { Module } from '@nestjs/common';
import { ContentItemsController } from './content-items.controller';
import { ContentItemsService } from './content-items.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [AuditLogModule],
  controllers: [ContentItemsController],
  providers: [ContentItemsService],
  exports: [ContentItemsService],
})
export class ContentItemsModule {}
