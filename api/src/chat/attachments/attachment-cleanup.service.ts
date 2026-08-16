import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Conversation } from '../../conversation/entities/conversation.entity';
import { AttachmentService } from './attachment.service';

/**
 * Scheduled, idempotent cleanup for chat attachments.
 * Safe to re-run: missing files/rows are ignored.
 */
@Injectable()
export class AttachmentCleanupService {
  private readonly logger = new Logger(AttachmentCleanupService.name);
  private running = false;

  constructor(
    private readonly attachments: AttachmentService,
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runScheduledCleanup(): Promise<void> {
    await this.runCleanupPass();
  }

  /** Exposed for tests / manual ops. */
  async runCleanupPass(): Promise<{
    abandoned: number;
    expired: number;
  }> {
    if (this.running) {
      this.logger.debug('Cleanup already running; skipping overlapping pass.');
      return { abandoned: 0, expired: 0 };
    }
    this.running = true;
    try {
      const abandoned = await this.attachments.cleanupAbandoned();
      const retentionDays = this.attachments.getRetentionDays();
      const cutoff = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1000,
      );
      const staleConversations = await this.conversationRepo.find({
        where: { updatedAt: LessThan(cutoff) },
        select: ['id'],
        take: 500,
      });
      const expired = await this.attachments.cleanupExpiredByRetention(
        staleConversations.map((c) => c.id),
      );
      if (abandoned || expired) {
        this.logger.log(
          `Attachment cleanup removed abandoned=${abandoned} expired=${expired}`,
        );
      }
      return { abandoned, expired };
    } finally {
      this.running = false;
    }
  }
}
