// goal: Prisma counts and lists scoped to instructor-owned courses when relevant.

import { Injectable } from '@nestjs/common';
import { ContentStatus, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(input: { role: Role; userId: string }) {
    // instructors only see stats for courses they own or teach
    const instructorFilter =
      input.role === Role.INSTRUCTOR
        ? {
            module: {
              course: {
                OR: [
                  { createdById: input.userId },
                  { instructorId: input.userId },
                ],
              },
            },
          }
        : {};

    const [pending, reviewed, approved, needsRevision, rejected] =
      await Promise.all([
        this.prisma.contentItem.count({
          where: { status: ContentStatus.IN_REVIEW, ...instructorFilter },
        }),
        this.prisma.reviewRequest.count({
          where: {
            status: ReviewStatus.COMPLETED,
            ...(input.role === Role.INSTRUCTOR
              ? {
                  contentItem: instructorFilter,
                }
              : {}),
          },
        }),
        this.prisma.contentItem.count({
          where: { status: ContentStatus.APPROVED, ...instructorFilter },
        }),
        this.prisma.contentItem.count({
          where: { status: ContentStatus.NEEDS_REVISION, ...instructorFilter },
        }),
        this.prisma.contentItem.count({
          where: { status: ContentStatus.REJECTED, ...instructorFilter },
        }),
      ]);

    return {
      pending,
      reviewed,
      approved,
      needsRevision,
      rejected,
    };
  }

  async recentActivity(input: { role: Role; userId: string }) {
    return this.prisma.reviewRequest.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      where:
        input.role === Role.INSTRUCTOR
          ? {
              contentItem: {
                module: {
                  course: {
                    OR: [
                      { createdById: input.userId },
                      { instructorId: input.userId },
                    ],
                  },
                },
              },
            }
          : undefined,
      include: {
        contentItem: {
          select: {
            id: true,
            title: true,
            contentType: true,
            status: true,
            module: {
              select: {
                id: true,
                title: true,
                course: { select: { title: true } },
              },
            },
          },
        },
        requestedBy: {
          select: {
            id: true,
            fullName: true,
            role: true,
          },
        },
        finalSummary: true,
      },
    });
  }
}
