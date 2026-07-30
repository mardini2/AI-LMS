import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '../../conversation/entities/conversation.entity';
import { Attachment } from './attachment.entity';
import { AttachmentChunk } from './attachment-chunk.entity';
import { AttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';
import { AttachmentCleanupService } from './attachment-cleanup.service';
import { ChatAttachmentsService } from './chat-attachments.service';
import { LocalFileStorageService } from './storage/local-file-storage.service';
import { StorageService } from './storage/storage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Attachment, AttachmentChunk, Conversation]),
  ],
  controllers: [AttachmentController],
  providers: [
    {
      provide: StorageService,
      useClass: LocalFileStorageService,
    },
    AttachmentService,
    AttachmentCleanupService,
    ChatAttachmentsService,
  ],
  exports: [AttachmentService, ChatAttachmentsService, StorageService],
})
export class AttachmentModule {}
