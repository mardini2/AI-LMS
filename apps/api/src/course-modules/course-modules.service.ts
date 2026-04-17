// CRUD for CourseModule rows and cascade delete related content items

import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CourseModulesService {
  constructor(private readonly prisma: PrismaService) {}

  async listByCourse(
    courseId: string,
    viewer?: { role: UserRole; userId: string },
  ) {
    if (viewer?.role === UserRole.STUDENT) {
      await this.assertStudentEnrolledInCourse(courseId, viewer.userId);
    }

    return this.prisma.courseModule.findMany({
      where: { courseId },
      include: {
        _count: {
          select: {
            contentItems:
              viewer?.role === UserRole.STUDENT
                ? { where: { status: ContentStatus.APPROVED } }
                : true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createModule(
    courseId: string,
    title: string,
    description?: string,
    learningOutcomes?: string,
  ) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    return this.prisma.courseModule.create({
      data: {
        courseId,
        title,
        description,
        learningOutcomes,
      },
    });
  }

  async getModule(
    id: string,
    viewer?: { role: UserRole; userId: string },
  ) {
    const moduleEntity = await this.prisma.courseModule.findUnique({
      where: { id },
      include: {
        course: true,
        contentItems: {
          ...(viewer?.role === UserRole.STUDENT
            ? { where: { status: ContentStatus.APPROVED } }
            : {}),
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!moduleEntity) {
      throw new NotFoundException('Module not found');
    }

    if (viewer?.role === UserRole.STUDENT) {
      await this.assertStudentEnrolledInCourse(
        moduleEntity.courseId,
        viewer.userId,
      );
    }

    return moduleEntity;
  }

  async updateModule(
    id: string,
    title?: string,
    description?: string,
    learningOutcomes?: string,
  ) {
    const moduleEntity = await this.prisma.courseModule.findUnique({
      where: { id },
    });
    if (!moduleEntity) {
      throw new NotFoundException('Module not found');
    }

    return this.prisma.courseModule.update({
      where: { id },
      data: {
        title,
        description,
        learningOutcomes,
      },
    });
  }

  async deleteModule(id: string) {
    const moduleEntity = await this.prisma.courseModule.findUnique({
      where: { id },
      include: {
        contentItems: {
          select: { id: true },
        },
      },
    });

    if (!moduleEntity) {
      throw new NotFoundException('Module not found');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const contentItem of moduleEntity.contentItems) {
        await this.deleteContentItemDependencies(tx, contentItem.id);
      }

      await tx.courseModule.delete({
        where: { id: moduleEntity.id },
      });
    });

    return { deleted: true };
  }

  private async deleteContentItemDependencies(
    tx: Prisma.TransactionClient,
    contentItemId: string,
  ) {
    const submissionRows = await tx.studentSubmission.findMany({
      where: { contentItemId },
      select: { id: true },
    });
    const submissionIds = submissionRows.map((s) => s.id);

    if (submissionIds.length > 0) {
      await tx.fileAttachment.deleteMany({
        where: { submissionId: { in: submissionIds } },
      });
    }

    await tx.studentSubmission.deleteMany({
      where: { contentItemId },
    });

    await tx.coachingMessage.deleteMany({
      where: { contentItemId },
    });

    await tx.fileAttachment.deleteMany({
      where: { contentItemId },
    });

    await tx.contentItem.delete({
      where: { id: contentItemId },
    });
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
}
