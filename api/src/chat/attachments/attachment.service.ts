import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  CHAT_ATTACHMENT_DEFAULT_ABANDONED_HOURS,
  CHAT_ATTACHMENT_DEFAULT_RETENTION_DAYS,
  CHAT_ATTACHMENT_DEFAULT_USER_QUOTA_BYTES,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_CHARS_PER_FILE,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
  CHAT_ATTACHMENT_MIME_BY_EXT,
  type AttachmentClientDto,
} from './attachment.constants';
import {
  chunkExtractedText,
  formatChunksForPrompt,
  selectRelevantChunks,
  type TextChunk,
} from './attachment.chunking';
import { Attachment } from './attachment.entity';
import { AttachmentChunk } from './attachment-chunk.entity';
import {
  composeUserMessageForLlm,
  composeUserMessageForStorage,
  extensionOf,
  extractBufferContent,
  isAllowedAttachmentExtension,
} from './attachment.extractor';
import { StorageService } from './storage/storage.service';

export interface UploadAttachmentParams {
  file: Express.Multer.File;
  moodleUserId: number;
  courseId: number;
  conversationId?: string;
}

export interface ResolvedAttachmentContext {
  promptBlock: string;
  storagePrefix: string;
  usableFilenames: string[];
  errors: string[];
  attachmentIds: string[];
}

@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);

  constructor(
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    @InjectRepository(AttachmentChunk)
    private readonly chunkRepo: Repository<AttachmentChunk>,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  getUserQuotaBytes(): number {
    const raw = this.config.get<number>('ATTACHMENT_USER_QUOTA_BYTES');
    return Number.isFinite(raw) && Number(raw) > 0
      ? Number(raw)
      : CHAT_ATTACHMENT_DEFAULT_USER_QUOTA_BYTES;
  }

  getAbandonedHours(): number {
    const raw = this.config.get<number>('ATTACHMENT_ABANDONED_HOURS');
    return Number.isFinite(raw) && Number(raw) > 0
      ? Number(raw)
      : CHAT_ATTACHMENT_DEFAULT_ABANDONED_HOURS;
  }

  getRetentionDays(): number {
    const raw = this.config.get<number>('ATTACHMENT_RETENTION_DAYS');
    return Number.isFinite(raw) && Number(raw) > 0
      ? Number(raw)
      : CHAT_ATTACHMENT_DEFAULT_RETENTION_DAYS;
  }

  toClientDto(row: Attachment): AttachmentClientDto {
    return {
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      byteLength: row.byteLength,
      status: row.status,
      processingError: row.processingError,
      conversationId: row.conversationId,
      messageId: row.messageId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async getUsedQuotaBytes(moodleUserId: number): Promise<number> {
    const result = await this.attachmentRepo
      .createQueryBuilder('a')
      .select('COALESCE(SUM(a.byte_length), 0)', 'total')
      .where('a.moodle_user_id = :moodleUserId', { moodleUserId })
      .andWhere("a.status != 'failed'")
      .getRawOne<{ total: string }>();
    return Number(result?.total ?? 0);
  }

  /**
   * Accept a multipart file, persist bytes via StorageService, process extraction.
   * Never executes the file — only reads bytes for text extraction.
   */
  async uploadAndProcess(
    params: UploadAttachmentParams,
  ): Promise<AttachmentClientDto> {
    const { file, moodleUserId, courseId, conversationId } = params;
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file was uploaded.');
    }

    const filename = this.sanitizeFilename(file.originalname || 'file');
    const ext = extensionOf(filename);
    if (!ext || !isAllowedAttachmentExtension(ext)) {
      throw new BadRequestException('This file type is not supported.');
    }
    if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException(
        `This file is too large. Maximum size is ${Math.round(CHAT_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB per file.`,
      );
    }
    if (file.size > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
      throw new BadRequestException(
        `Upload limit exceeded. Maximum total upload size is ${Math.round(CHAT_ATTACHMENT_MAX_TOTAL_BYTES / (1024 * 1024))} MB.`,
      );
    }

    const used = await this.getUsedQuotaBytes(moodleUserId);
    const quota = this.getUserQuotaBytes();
    if (used + file.size > quota) {
      const gb = quota / (1024 * 1024 * 1024);
      const quotaLabel =
        gb >= 1
          ? `${Math.round(gb * 10) / 10} GB`
          : `${Math.round(quota / (1024 * 1024))} MB`;
      throw new BadRequestException(
        `Your attachment storage is full. Maximum storage is ${quotaLabel}.`,
      );
    }

    const id = randomUUID();
    const storageKey = `attachments/${id}/original`;
    const mimeType =
      (file.mimetype && String(file.mimetype).trim()) ||
      CHAT_ATTACHMENT_MIME_BY_EXT[ext] ||
      'application/octet-stream';

    await this.storage.putObject(storageKey, file.buffer, mimeType);

    let row = this.attachmentRepo.create({
      id,
      filename,
      storageKey,
      mimeType,
      byteLength: file.size,
      moodleUserId,
      courseId,
      conversationId: conversationId || null,
      messageId: null,
      status: 'uploaded',
      processingError: null,
      chunkRefs: null,
      extension: ext,
    });
    row = await this.attachmentRepo.save(row);

    try {
      await this.processAttachment(row.id);
    } catch (err) {
      this.logger.warn(
        `Processing failed for ${row.id}: ${(err as Error).message}`,
      );
    }

    const fresh = await this.attachmentRepo.findOneByOrFail({ id: row.id });
    return this.toClientDto(fresh);
  }

  async processAttachment(attachmentId: string): Promise<Attachment> {
    const row = await this.attachmentRepo.findOneBy({ id: attachmentId });
    if (!row) {
      throw new NotFoundException('Attachment not found.');
    }

    row.status = 'processing';
    row.processingError = null;
    await this.attachmentRepo.save(row);

    try {
      const buffer = await this.storage.getObject(row.storageKey);
      const extracted = await extractBufferContent(
        row.filename,
        row.extension || extensionOf(row.filename),
        buffer,
      );

      await this.chunkRepo.delete({ attachmentId: row.id });

      if (
        extracted.status !== 'ok' &&
        extracted.status !== 'binary_only'
      ) {
        row.status = 'failed';
        row.processingError =
          extracted.error ||
          `"${row.filename}" could not be processed.`;
        row.chunkRefs = [];
        return this.attachmentRepo.save(row);
      }

      const text = (extracted.text || '').slice(
        0,
        CHAT_ATTACHMENT_MAX_CHARS_PER_FILE,
      );
      const pieces = chunkExtractedText(text);
      if (!pieces.length) {
        row.status = 'failed';
        row.processingError =
          extracted.error || `"${row.filename}" contained no extractable text.`;
        row.chunkRefs = [];
        return this.attachmentRepo.save(row);
      }

      const chunkEntities = pieces.map((content, chunkIndex) =>
        this.chunkRepo.create({
          attachmentId: row.id,
          chunkIndex,
          content,
          charCount: content.length,
        }),
      );
      const savedChunks = await this.chunkRepo.save(chunkEntities);

      row.status = 'ready';
      row.processingError =
        extracted.status === 'binary_only'
          ? 'OCR/transcription is not available yet for this media type; only a metadata note was stored.'
          : null;
      row.chunkRefs = savedChunks.map((c) => c.id);
      return this.attachmentRepo.save(row);
    } catch (err) {
      row.status = 'failed';
      row.processingError = `"${row.filename}" could not be processed (${(err as Error).message}).`;
      row.chunkRefs = [];
      return this.attachmentRepo.save(row);
    }
  }

  async assertOwnedAttachments(
    ids: string[],
    moodleUserId: number,
    conversationId?: string,
  ): Promise<Attachment[]> {
    if (!ids.length) return [];
    if (ids.length > CHAT_ATTACHMENT_MAX_FILES) {
      throw new BadRequestException(
        'You can attach up to 10 files per message.',
      );
    }

    const unique = [...new Set(ids)];
    const rows = await this.attachmentRepo.findBy({ id: In(unique) });
    if (rows.length !== unique.length) {
      throw new NotFoundException('One or more attachments were not found.');
    }

    for (const row of rows) {
      if (row.moodleUserId !== moodleUserId) {
        throw new ForbiddenException(
          'You do not have access to one or more attachments.',
        );
      }
      if (
        conversationId &&
        row.conversationId &&
        row.conversationId !== conversationId
      ) {
        throw new ForbiddenException(
          'Attachment does not belong to this conversation.',
        );
      }
    }
    return rows;
  }

  /**
   * Build LLM context from newly referenced IDs plus relevant prior
   * conversation attachments (follow-up reuse).
   */
  async resolveForMessage(params: {
    attachmentIds?: string[];
    moodleUserId: number;
    conversationId: string;
    query: string;
  }): Promise<ResolvedAttachmentContext> {
    const requestedIds = [...new Set(params.attachmentIds || [])];
    const errors: string[] = [];

    let current: Attachment[] = [];
    if (requestedIds.length) {
      current = await this.assertOwnedAttachments(
        requestedIds,
        params.moodleUserId,
        params.conversationId,
      );
      for (const row of current) {
        if (!row.conversationId) {
          row.conversationId = params.conversationId;
          await this.attachmentRepo.save(row);
        }
        if (row.status === 'uploaded') {
          await this.processAttachment(row.id);
        }
      }
      current = await this.attachmentRepo.findBy({ id: In(requestedIds) });
      for (const row of current) {
        if (row.status === 'failed') {
          errors.push(
            row.processingError ||
              `"${row.filename}" could not be processed.`,
          );
        } else if (row.status !== 'ready') {
          errors.push(`"${row.filename}" is still processing. Try again shortly.`);
        }
      }
    }

    const prior = await this.attachmentRepo.find({
      where: {
        conversationId: params.conversationId,
        moodleUserId: params.moodleUserId,
        status: 'ready',
      },
      order: { createdAt: 'ASC' },
      take: 40,
    });

    const byId = new Map<string, Attachment>();
    for (const row of [...current, ...prior]) {
      byId.set(row.id, row);
    }
    const all = [...byId.values()];
    const allIds = all.map((a) => a.id);

    const dbChunks = allIds.length
      ? await this.chunkRepo.find({
          where: { attachmentId: In(allIds) },
          order: { chunkIndex: 'ASC' },
        })
      : [];

    const textChunks: TextChunk[] = dbChunks.map((c) => {
      const parent = byId.get(c.attachmentId)!;
      return {
        id: c.id,
        attachmentId: c.attachmentId,
        filename: parent.filename,
        chunkIndex: c.chunkIndex,
        content: c.content,
      };
    });

    // Prefer chunks from the current turn's attachments by listing them first.
    const currentIdSet = new Set(current.map((c) => c.id));
    const ordered = [
      ...textChunks.filter((c) => currentIdSet.has(c.attachmentId)),
      ...textChunks.filter((c) => !currentIdSet.has(c.attachmentId)),
    ];

    const selected = selectRelevantChunks(ordered, params.query);
    const promptBlock = formatChunksForPrompt(selected);
    const usable = all
      .filter((a) => a.status === 'ready')
      .map((a) => a.filename);
    const storagePrefix = current.length
      ? `[syllentras-files: ${current.map((a) => a.filename).join(', ')}]`
      : '';

    return {
      promptBlock,
      storagePrefix,
      usableFilenames: usable,
      errors,
      attachmentIds: current.map((a) => a.id),
    };
  }

  buildLlmMessage(message: string, promptBlock: string): string {
    return composeUserMessageForLlm(message, promptBlock);
  }

  buildStorageMessage(message: string, storagePrefix: string): string {
    return composeUserMessageForStorage(message, storagePrefix);
  }

  async linkToMessage(
    attachmentIds: string[],
    messageId: string,
    conversationId: string,
    moodleUserId: number,
  ): Promise<void> {
    if (!attachmentIds.length) return;
    const rows = await this.assertOwnedAttachments(
      attachmentIds,
      moodleUserId,
      conversationId,
    );
    for (const row of rows) {
      row.messageId = messageId;
      row.conversationId = conversationId;
      await this.attachmentRepo.save(row);
    }
  }

  async listForMessages(
    messageIds: string[],
    moodleUserId: number,
  ): Promise<Map<string, AttachmentClientDto[]>> {
    const map = new Map<string, AttachmentClientDto[]>();
    if (!messageIds.length) return map;
    const rows = await this.attachmentRepo.find({
      where: {
        messageId: In(messageIds),
        moodleUserId,
      },
      order: { createdAt: 'ASC' },
    });
    for (const row of rows) {
      if (!row.messageId) continue;
      const list = map.get(row.messageId) || [];
      list.push(this.toClientDto(row));
      map.set(row.messageId, list);
    }
    return map;
  }

  async getByIdForUser(
    id: string,
    moodleUserId: number,
  ): Promise<AttachmentClientDto> {
    const row = await this.attachmentRepo.findOneBy({ id });
    if (!row) throw new NotFoundException('Attachment not found.');
    if (row.moodleUserId !== moodleUserId) {
      throw new ForbiddenException('You do not have access to this attachment.');
    }
    return this.toClientDto(row);
  }

  async deleteAttachment(
    id: string,
    moodleUserId: number,
  ): Promise<{ deleted: true }> {
    const row = await this.attachmentRepo.findOneBy({ id });
    if (!row) throw new NotFoundException('Attachment not found.');
    if (row.moodleUserId !== moodleUserId) {
      throw new ForbiddenException('You do not have access to this attachment.');
    }
    await this.purgeAttachmentRow(row);
    return { deleted: true };
  }

  async purgeForConversation(conversationId: string): Promise<number> {
    const rows = await this.attachmentRepo.find({
      where: { conversationId },
    });
    for (const row of rows) {
      await this.purgeAttachmentRow(row);
    }
    return rows.length;
  }

  /**
   * Idempotent full delete: chunks (CASCADE), object store, then metadata row.
   */
  async purgeAttachmentRow(row: Attachment): Promise<void> {
    await this.storage.deleteObjectIfExists(row.storageKey);
    await this.chunkRepo.delete({ attachmentId: row.id });
    await this.attachmentRepo.delete({ id: row.id });
  }

  /** Abandoned / incomplete / failed uploads older than N hours with no message. */
  async cleanupAbandoned(): Promise<number> {
    const cutoff = new Date(
      Date.now() - this.getAbandonedHours() * 60 * 60 * 1000,
    );
    const rows = await this.attachmentRepo.find({
      where: [
        {
          messageId: IsNull(),
          status: In(['uploaded', 'processing', 'failed']),
          createdAt: LessThan(cutoff),
        },
        {
          messageId: IsNull(),
          status: 'ready',
          createdAt: LessThan(cutoff),
        },
      ],
    });
    for (const row of rows) {
      await this.purgeAttachmentRow(row);
    }
    return rows.length;
  }

  /**
   * Delete attachments whose conversation has been inactive longer than retention.
   * Uses conversation updated_at via raw query to avoid circular module imports.
   */
  async cleanupExpiredByRetention(
    inactiveConversationIds: string[],
  ): Promise<number> {
    if (!inactiveConversationIds.length) return 0;
    const rows = await this.attachmentRepo.find({
      where: { conversationId: In(inactiveConversationIds) },
    });
    for (const row of rows) {
      await this.purgeAttachmentRow(row);
    }
    return rows.length;
  }

  private sanitizeFilename(name: string): string {
    const base = String(name || 'file')
      .replace(/[/\\]/g, '_')
      .replace(/\0/g, '')
      .trim();
    const clipped = base.slice(0, 200) || 'file';
    // Strip path traversal leftovers after sanitization.
    return clipped.replace(/\.\./g, '_');
  }
}
