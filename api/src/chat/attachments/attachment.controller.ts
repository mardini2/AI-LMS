import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
} from './attachment.constants';
import { AttachmentService } from './attachment.service';

@Controller('chat/attachments')
export class AttachmentController {
  constructor(private readonly attachments: AttachmentService) {}

  /**
   * POST /chat/attachments
   * multipart/form-data fields:
   *   files: one or more files (field name "files")
   * Query: moodleUserId, courseId, conversationId (optional)
   */
  @Post()
  @UseInterceptors(
    FilesInterceptor('files', CHAT_ATTACHMENT_MAX_FILES, {
      storage: memoryStorage(),
      limits: {
        fileSize: CHAT_ATTACHMENT_MAX_BYTES,
        files: CHAT_ATTACHMENT_MAX_FILES,
        fieldSize: CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
      },
    }),
  )
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Query('moodleUserId', ParseIntPipe) moodleUserId: number,
    @Query('courseId', ParseIntPipe) courseId: number,
    @Query('conversationId') conversationId?: string,
  ) {
    const list = Array.isArray(files) ? files : [];
    if (!list.length) {
      throw new BadRequestException('Select at least one file to upload.');
    }
    if (list.length > CHAT_ATTACHMENT_MAX_FILES) {
      throw new BadRequestException(
        'You can attach up to 10 files per message.',
      );
    }
    const total = list.reduce((sum, f) => sum + (f?.size || 0), 0);
    if (total > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
      throw new BadRequestException(
        `Upload limit exceeded. Maximum total upload size is ${Math.round(CHAT_ATTACHMENT_MAX_TOTAL_BYTES / (1024 * 1024))} MB.`,
      );
    }

    const attachments = [];
    for (const file of list) {
      attachments.push(
        await this.attachments.uploadAndProcess({
          file,
          moodleUserId,
          courseId,
          conversationId: conversationId || undefined,
        }),
      );
    }
    return { attachments };
  }

  /**
   * GET /chat/attachments/:id?moodleUserId=
   * Metadata only — never returns storage keys or file bytes.
   */
  @Get(':id')
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('moodleUserId', ParseIntPipe) moodleUserId: number,
  ) {
    return this.attachments.getByIdForUser(id, moodleUserId);
  }

  /**
   * DELETE /chat/attachments/:id?moodleUserId=
   */
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('moodleUserId', ParseIntPipe) moodleUserId: number,
  ) {
    return this.attachments.deleteAttachment(id, moodleUserId);
  }
}
