// goal: CRUD for CourseModule rows and cascade delete related content items.

import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CourseModulesService {
  constructor(private readonly prisma: PrismaService) {}

  async listByCourse(courseId: string) {
    return this.prisma.courseModule.findMany({
      where: { courseId },
      include: { _count: { select: { contentItems: true } } },
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

  async getModule(id: string) {
    const moduleEntity = await this.prisma.courseModule.findUnique({
      where: { id },
      include: {
        course: true,
        contentItems: {
          include: { _count: { select: { reviewRequests: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!moduleEntity) {
      throw new NotFoundException('Module not found');
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
      // delete children before the parent module row
      for (const contentItem of moduleEntity.contentItems) {
        await this.deleteContentItemDependencies(tx, contentItem.id);
      }

      await tx.courseModule.delete({
        where: { id: moduleEntity.id },
      });
    });

    return { deleted: true };
  }

  // slimmer than UsersService version: module delete does not need every attachment edge case
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

    await tx.contentItem.delete({
      where: { id: contentItemId },
    });
  }
}
