// goal: Prisma logic for lessons/assignments, submissions, grading, and file storage.

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContentStatus,
  ContentType,
  FileAttachment,
  SubmissionStatus,
  UserRole,
  NotificationType,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { unlink } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service';

// shape multer gives us after disk storage writes under uploads/
interface UploadFile {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
}

@Injectable()
export class ContentItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async listByModule(
    moduleId: string,
    viewer?: { role: UserRole; userId: string },
  ) {
    if (viewer?.role === UserRole.STUDENT) {
      await this.assertStudentEnrolledInModule(moduleId, viewer.userId);
    }

    return this.prisma.contentItem.findMany({
      where: { moduleId },
      include: {
        createdBy: {
          select: { id: true, fullName: true, role: true },
        },
        _count: {
          select: { reviewRequests: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    moduleId: string,
    createdById: string,
    title: string,
    contentType: ContentType,
    body: string,
    rubricText?: string,
    dueAt?: string,
  ) {
    const moduleEntity = await this.prisma.courseModule.findUnique({
      where: { id: moduleId },
    });
    if (!moduleEntity) {
      throw new NotFoundException('Module not found');
    }

    const createdItem = await this.prisma.contentItem.create({
      data: {
        moduleId,
        createdById,
        title,
        contentType,
        body,
        rubricText,
        dueAt: dueAt ? new Date(dueAt) : undefined,
      },
    });

    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId: moduleEntity.courseId },
      select: { studentId: true },
    });

    if (enrollments.length > 0) {
      const targetUserIds = enrollments.map(
        (enrollment) => enrollment.studentId,
      );
      await this.prisma.notification.createMany({
        data: enrollments.map((enrollment) => ({
          userId: enrollment.studentId,
          courseId: moduleEntity.courseId,
          type: NotificationType.CONTENT_POSTED,
          title: `${title} is now available`,
          message: `${moduleEntity.title} • ${
            dueAt &&
            (contentType === ContentType.ASSIGNMENT ||
              contentType === ContentType.QUIZ)
              ? `A new ${contentType.toLowerCase().replace('_', ' ')} was posted with due date ${new Date(dueAt).toLocaleString()}.`
              : `A new ${contentType.toLowerCase().replace('_', ' ')} was posted in your course.`
          }`,
          entityId: createdItem.id,
        })),
      });
      await this.pruneNotificationsForUsers(targetUserIds);
    }

    return createdItem;
  }

  async getOne(id: string, viewer?: { role: UserRole; userId: string }) {
    const contentItem = await this.prisma.contentItem.findUnique({
      where: { id },
      include: {
        module: {
          include: { course: true },
        },
        reviewRequests: {
          include: {
            agentReviews: true,
            finalSummary: true,
            humanDecisions: {
              include: {
                decidedBy: {
                  select: { id: true, fullName: true, role: true },
                },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        submissions: {
          where:
            viewer?.role === UserRole.STUDENT
              ? { studentId: viewer.userId }
              : undefined,
          include: {
            student: {
              select: { id: true, fullName: true, email: true, role: true },
            },
            gradedBy: {
              select: { id: true, fullName: true, role: true },
            },
            attachments: true,
          },
          orderBy: { updatedAt: 'desc' },
        },
        attachments: true,
      },
    });

    if (!contentItem) {
      throw new NotFoundException('Content item not found');
    }

    if (viewer?.role === UserRole.STUDENT) {
      await this.assertStudentEnrolledInCourse(
        contentItem.module.course.id,
        viewer.userId,
      );
    }

    return contentItem;
  }

  async update(
    id: string,
    input: {
      title?: string;
      contentType?: ContentType;
      body?: string;
      rubricText?: string;
      dueAt?: string;
      status?: ContentStatus;
    },
  ) {
    const contentItem = await this.prisma.contentItem.findUnique({
      where: { id },
    });
    if (!contentItem) {
      throw new NotFoundException('Content item not found');
    }

    return this.prisma.contentItem.update({
      where: { id },
      data: {
        ...input,
        dueAt:
          typeof input.dueAt === 'string'
            ? input.dueAt
              ? new Date(input.dueAt)
              : null
            : undefined,
      },
    });
  }

  async delete(id: string) {
    const contentItem = await this.prisma.contentItem.findUnique({
      where: { id },
    });
    if (!contentItem) {
      throw new NotFoundException('Content item not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.deleteContentItemDependencies(tx, id);
    });

    return { deleted: true };
  }

  async upsertStudentSubmission(
    contentItemId: string,
    studentId: string,
    answerText: string,
  ) {
    const contentItem = await this.prisma.contentItem.findUnique({
      where: { id: contentItemId },
    });
    if (!contentItem) {
      throw new NotFoundException('Content item not found');
    }
    await this.assertStudentEnrolledInContentCourse(contentItemId, studentId);

    return this.prisma.studentSubmission.upsert({
      where: {
        contentItemId_studentId: { contentItemId, studentId },
      },
      update: {
        answerText,
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      create: {
        contentItemId,
        studentId,
        answerText,
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date(),
      },
    });
  }

  async saveStudentSubmissionDraft(
    contentItemId: string,
    studentId: string,
    answerText: string,
  ) {
    const contentItem = await this.prisma.contentItem.findUnique({
      where: { id: contentItemId },
    });
    if (!contentItem) {
      throw new NotFoundException('Content item not found');
    }
    await this.assertStudentEnrolledInContentCourse(contentItemId, studentId);

    return this.prisma.studentSubmission.upsert({
      where: {
        contentItemId_studentId: { contentItemId, studentId },
      },
      update: {
        answerText,
        status: SubmissionStatus.DRAFT,
      },
      create: {
        contentItemId,
        studentId,
        answerText,
        status: SubmissionStatus.DRAFT,
      },
    });
  }

  async listStudentSubmissions(studentId: string) {
    return this.prisma.studentSubmission.findMany({
      where: { studentId },
      include: {
        contentItem: {
          include: {
            module: {
              include: {
                course: {
                  select: { id: true, title: true },
                },
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async gradeSubmission(input: {
    submissionId: string;
    gradedById: string;
    score?: number;
    feedback?: string;
  }) {
    const submission = await this.prisma.studentSubmission.findUnique({
      where: { id: input.submissionId },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    const grader = await this.prisma.user.findUnique({
      where: { id: input.gradedById },
      select: { id: true, role: true },
    });
    if (!grader) {
      throw new NotFoundException('User not found');
    }
    if (grader.role === UserRole.INSTRUCTOR) {
      const allowed = await this.prisma.studentSubmission.findFirst({
        where: {
          id: input.submissionId,
          contentItem: {
            module: {
              course: {
                OR: [{ createdById: grader.id }, { instructorId: grader.id }],
              },
            },
          },
        },
        select: { id: true },
      });
      if (!allowed) {
        throw new NotFoundException('Submission not found');
      }
    }

    return this.prisma.studentSubmission.update({
      where: { id: input.submissionId },
      data: {
        status: SubmissionStatus.GRADED,
        score: input.score,
        feedback: input.feedback,
        gradedById: input.gradedById,
        gradedAt: new Date(),
      },
    });
  }

  async uploadContentResource(input: {
    contentItemId: string;
    uploadedById: string;
    file: UploadFile;
  }) {
    const contentItem = await this.prisma.contentItem.findUnique({
      where: { id: input.contentItemId },
    });
    if (!contentItem) {
      throw new NotFoundException('Content item not found');
    }

    return this.prisma.fileAttachment.create({
      data: {
        originalName: input.file.originalname,
        mimeType: input.file.mimetype || 'application/octet-stream',
        sizeBytes: input.file.size,
        storagePath: input.file.path,
        uploadedById: input.uploadedById,
        contentItemId: input.contentItemId,
      },
    });
  }

  async uploadSubmissionAttachment(input: {
    contentItemId: string;
    studentId: string;
    file: UploadFile;
  }) {
    const contentItem = await this.prisma.contentItem.findUnique({
      where: { id: input.contentItemId },
    });
    if (!contentItem) {
      throw new NotFoundException('Content item not found');
    }
    await this.assertStudentEnrolledInContentCourse(
      input.contentItemId,
      input.studentId,
    );

    const submission = await this.prisma.studentSubmission.upsert({
      where: {
        contentItemId_studentId: {
          contentItemId: input.contentItemId,
          studentId: input.studentId,
        },
      },
      update: {},
      create: {
        contentItemId: input.contentItemId,
        studentId: input.studentId,
        answerText: '',
        status: SubmissionStatus.DRAFT,
      },
    });

    return this.prisma.fileAttachment.create({
      data: {
        originalName: input.file.originalname,
        mimeType: input.file.mimetype || 'application/octet-stream',
        sizeBytes: input.file.size,
        storagePath: input.file.path,
        uploadedById: input.studentId,
        contentItemId: input.contentItemId,
        submissionId: submission.id,
      },
    });
  }

  async listContentResources(contentItemId: string) {
    return this.prisma.fileAttachment.findMany({
      where: {
        contentItemId,
        submissionId: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listStudentSubmissionAttachments(
    contentItemId: string,
    studentId: string,
  ) {
    await this.assertStudentEnrolledInContentCourse(contentItemId, studentId);

    const submission = await this.prisma.studentSubmission.findUnique({
      where: {
        contentItemId_studentId: { contentItemId, studentId },
      },
      select: { id: true },
    });
    if (!submission) return [];

    return this.prisma.fileAttachment.findMany({
      where: { submissionId: submission.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeStudentSubmissionAttachment(input: {
    contentItemId: string;
    studentId: string;
    attachmentId: string;
  }) {
    await this.assertStudentEnrolledInContentCourse(
      input.contentItemId,
      input.studentId,
    );

    const submission = await this.prisma.studentSubmission.findUnique({
      where: {
        contentItemId_studentId: {
          contentItemId: input.contentItemId,
          studentId: input.studentId,
        },
      },
      select: { id: true, status: true },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }
    if (submission.status !== SubmissionStatus.DRAFT) {
      throw new BadRequestException(
        'You can only remove files before submitting your answer',
      );
    }

    const attachment = await this.prisma.fileAttachment.findFirst({
      where: {
        id: input.attachmentId,
        submissionId: submission.id,
        uploadedById: input.studentId,
      },
    });
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    await this.prisma.fileAttachment.delete({
      where: { id: attachment.id },
    });

    // Best-effort cleanup on disk. DB record is already removed.
    try {
      await unlink(attachment.storagePath);
    } catch {
      // Ignore missing/locked file errors to avoid blocking UX.
    }

    return { removed: true, attachmentId: attachment.id };
  }

  async getAttachmentForDownload(input: {
    attachmentId: string;
    requesterId: string;
    requesterRole: UserRole;
  }): Promise<FileAttachment> {
    const attachment = await this.prisma.fileAttachment.findUnique({
      where: { id: input.attachmentId },
      include: {
        contentItem: {
          select: {
            module: {
              select: {
                course: {
                  select: {
                    id: true,
                    createdById: true,
                    instructorId: true,
                  },
                },
              },
            },
          },
        },
        submission: {
          select: { studentId: true },
        },
      },
    });
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    const courseId = attachment.contentItem?.module.course.id;
    if (!courseId) {
      throw new NotFoundException('Attachment not found');
    }

    if (input.requesterRole === UserRole.STUDENT) {
      if (attachment.submissionId) {
        if (attachment.submission?.studentId !== input.requesterId) {
          throw new NotFoundException('Attachment not found');
        }
      } else {
        const enrollment = await this.prisma.enrollment.findFirst({
          where: { courseId, studentId: input.requesterId },
          select: { id: true },
        });
        if (!enrollment) {
          throw new NotFoundException('Attachment not found');
        }
      }
    }

    if (input.requesterRole === UserRole.INSTRUCTOR) {
      const course = attachment.contentItem?.module.course;
      const ownsCourse =
        course?.createdById === input.requesterId ||
        course?.instructorId === input.requesterId;
      if (!ownsCourse) {
        throw new NotFoundException('Attachment not found');
      }
    }

    return attachment;
  }

  private async assertStudentEnrolledInContentCourse(
    contentItemId: string,
    studentId: string,
  ) {
    const enrollment = await this.prisma.contentItem.findFirst({
      where: {
        id: contentItemId,
        module: {
          course: {
            enrollments: {
              some: { studentId },
            },
          },
        },
      },
      select: { id: true },
    });
    if (!enrollment) {
      throw new NotFoundException('Content item not found');
    }
  }

  private async assertStudentEnrolledInModule(
    moduleId: string,
    studentId: string,
  ) {
    const enrollment = await this.prisma.courseModule.findFirst({
      where: {
        id: moduleId,
        course: {
          enrollments: {
            some: { studentId },
          },
        },
      },
      select: { id: true },
    });
    if (!enrollment) {
      throw new NotFoundException('Module not found');
    }
  }

  private async assertStudentEnrolledInCourse(
    courseId: string,
    studentId: string,
  ) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { courseId, studentId },
      select: { id: true },
    });
    if (!enrollment) {
      throw new NotFoundException('Course not found');
    }
  }

  private async deleteContentItemDependencies(
    tx: Prisma.TransactionClient,
    contentItemId: string,
  ) {
    const reviewRequests = await tx.reviewRequest.findMany({
      where: { contentItemId },
      select: { id: true },
    });

    for (const reviewRequest of reviewRequests) {
      await tx.humanReviewDecision.deleteMany({
        where: { reviewRequestId: reviewRequest.id },
      });
      await tx.agentReview.deleteMany({
        where: { reviewRequestId: reviewRequest.id },
      });
      await tx.finalReviewSummary.deleteMany({
        where: { reviewRequestId: reviewRequest.id },
      });
    }

    await tx.reviewRequest.deleteMany({
      where: { contentItemId },
    });

    await tx.coachingMessage.deleteMany({
      where: { contentItemId },
    });

    await tx.studentSubmission.deleteMany({
      where: { contentItemId },
    });

    await tx.fileAttachment.deleteMany({
      where: { contentItemId },
    });

    await tx.notification.deleteMany({
      where: { entityId: contentItemId },
    });

    await tx.contentItem.delete({
      where: { id: contentItemId },
    });
  }

  private async pruneNotificationsForUsers(userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds)];
    for (const userId of uniqueUserIds) {
      const overflow = await this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: 10,
        select: { id: true },
      });
      if (overflow.length === 0) continue;
      await this.prisma.notification.deleteMany({
        where: {
          id: { in: overflow.map((item) => item.id) },
        },
      });
    }
  }
}
