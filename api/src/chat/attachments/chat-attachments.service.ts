import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  ChatAttachmentInput,
  ProcessedChatAttachments,
} from './attachment.constants';
import {
  composeUserMessageForLlm,
  composeUserMessageForStorage,
  processChatAttachments,
} from './attachment.extractor';
import { AttachmentService } from './attachment.service';

/**
 * Facade used by ChatService.
 * Prefer attachment IDs (persistent). Legacy Base64 path remains for tests only.
 */
@Injectable()
export class ChatAttachmentsService {
  private readonly logger = new Logger(ChatAttachmentsService.name);

  constructor(private readonly attachments: AttachmentService) {}

  async resolveByIds(params: {
    attachmentIds?: string[];
    moodleUserId: number;
    conversationId: string;
    query: string;
  }) {
    return this.attachments.resolveForMessage(params);
  }

  async linkToMessage(
    attachmentIds: string[],
    messageId: string,
    conversationId: string,
    moodleUserId: number,
  ) {
    return this.attachments.linkToMessage(
      attachmentIds,
      messageId,
      conversationId,
      moodleUserId,
    );
  }

  /** @deprecated Base64 path — unit tests / emergency fallback only. */
  async process(
    inputs: ChatAttachmentInput[] | undefined | null,
  ): Promise<ProcessedChatAttachments> {
    try {
      const processed = await processChatAttachments(inputs);
      if (processed.errors.length) {
        this.logger.warn(
          `Attachment issues: ${processed.errors.join(' | ')}`,
        );
      }
      return processed;
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  buildLlmMessage(message: string, promptBlock: string): string {
    return composeUserMessageForLlm(message, promptBlock);
  }

  buildStorageMessage(message: string, storagePrefix: string): string {
    return composeUserMessageForStorage(message, storagePrefix);
  }
}
