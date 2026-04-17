// HTTP routes for content items, student work, and attachment download

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ContentItemsService } from './content-items.service';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  CreateContentItemDto,
  GradeSubmissionDto,
  StudentSubmissionDto,
  UpdateContentItemDto,
} from './content-item.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';
import { FileInterceptor } from '@nestjs/platform-express';
import { attachmentMulterOptions } from '../common/upload/upload.config';
import type { Response } from 'express';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContentItemsController {
  constructor(private readonly contentItemsService: ContentItemsService) {}

  @Get('modules/:moduleId/content-items')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async listByModule(
    @Param('moduleId') moduleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentItemsService.listByModule(moduleId, {
      role: request.user.role as UserRole,
      userId: request.user.sub,
    });
  }

  @Post('modules/:moduleId/content-items')
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  async create(
    @Param('moduleId') moduleId: string,
    @Body() body: CreateContentItemDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentItemsService.create(
      moduleId,
      request.user.sub,
      body.title,
      body.contentType,
      body.body,
      body.rubricText,
      body.dueAt,
    );
  }

  @Get('content-items/:id')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async getOne(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.contentItemsService.getOne(id, {
      role: request.user.role as UserRole,
      userId: request.user.sub,
    });
  }

  @Patch('content-items/:id')
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  async update(@Param('id') id: string, @Body() body: UpdateContentItemDto) {
    return this.contentItemsService.update(id, body);
  }

  @Delete('content-items/:id')
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  async delete(@Param('id') id: string) {
    return this.contentItemsService.delete(id);
  }

  @Post('content-items/:id/submissions')
  @Roles(Role.STUDENT)
  async submitAnswer(
    @Param('id') id: string,
    @Body() body: StudentSubmissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentItemsService.upsertStudentSubmission(
      id,
      request.user.sub,
      body.answerText,
    );
  }

  @Patch('content-items/:id/submissions/draft')
  @Roles(Role.STUDENT)
  async saveDraft(
    @Param('id') id: string,
    @Body() body: StudentSubmissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentItemsService.saveStudentSubmissionDraft(
      id,
      request.user.sub,
      body.answerText,
    );
  }

  @Get('students/me/submissions')
  @Roles(Role.STUDENT)
  async mySubmissions(@Req() request: AuthenticatedRequest) {
    return this.contentItemsService.listStudentSubmissions(request.user.sub);
  }

  @Patch('submissions/:submissionId/grade')
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  async gradeSubmission(
    @Param('submissionId') submissionId: string,
    @Body() body: GradeSubmissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentItemsService.gradeSubmission({
      submissionId,
      gradedById: request.user.sub,
      score: body.score,
      feedback: body.feedback,
    });
  }

  @Post('content-items/:id/resources')
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  async uploadResource(
    @Param('id') id: string,
    @UploadedFile()
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      path: string;
    },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentItemsService.uploadContentResource({
      contentItemId: id,
      uploadedById: request.user.sub,
      file,
    });
  }

  @Get('content-items/:id/resources')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async listResources(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentItemsService.listContentResources(id, {
      role: request.user.role as UserRole,
      userId: request.user.sub,
    });
  }

  @Delete('content-items/:id/resources/:attachmentId')
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  async removeResource(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentItemsService.removeContentResource({
      contentItemId: id,
      attachmentId,
      requesterId: request.user.sub,
      requesterRole: request.user.role as UserRole,
    });
  }

  @Post('content-items/:id/submissions/attachments')
  @Roles(Role.STUDENT)
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  async uploadSubmissionAttachment(
    @Param('id') id: string,
    @UploadedFile()
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      path: string;
    },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentItemsService.uploadSubmissionAttachment({
      contentItemId: id,
      studentId: request.user.sub,
      file,
    });
  }

  @Get('content-items/:id/submissions/my/attachments')
  @Roles(Role.STUDENT)
  async mySubmissionAttachments(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentItemsService.listStudentSubmissionAttachments(
      id,
      request.user.sub,
    );
  }

  @Delete('content-items/:id/submissions/attachments/:attachmentId')
  @Roles(Role.STUDENT)
  async removeMySubmissionAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.contentItemsService.removeStudentSubmissionAttachment({
      contentItemId: id,
      studentId: request.user.sub,
      attachmentId,
    });
  }

  @Get('attachments/:attachmentId/download')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    const attachment = await this.contentItemsService.getAttachmentForDownload({
      attachmentId,
      requesterId: request.user.sub,
      requesterRole: request.user.role as UserRole,
    });
    response.download(attachment.storagePath, attachment.originalName);
  }
}
