// goal: Prisma queries for courses, enrollments, announcements, and deep deletes.

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async listCourses() {
    return this.prisma.course.findMany({
      include: {
        createdBy: { select: { id: true, fullName: true, role: true } },
        instructor: { select: { id: true, fullName: true, role: true } },
        enrollments: { select: { studentId: true } },
        _count: { select: { modules: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listInstructorCourses(instructorId: string) {
    return this.prisma.course.findMany({
      where: { createdById: instructorId },
      include: {
        createdBy: { select: { id: true, fullName: true, role: true } },
        instructor: { select: { id: true, fullName: true, role: true } },
        enrollments: { select: { studentId: true } },
        _count: { select: { modules: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listStudentCourses(studentId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId },
      include: {
        course: {
          include: {
            instructor: { select: { id: true, fullName: true, role: true } },
            _count: { select: { modules: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return enrollments.map((item) => item.course);
  }

  async createCourse(
    createdById: string,
    title: string,
    description?: string,
    backgroundImage?: string,
  ) {
    const creator = await this.prisma.user.findUnique({
      where: { id: createdById },
      select: { role: true },
    });

    return this.prisma.course.create({
      data: {
        title,
        description,
        backgroundImage,
        createdById,
        // admins can create shells; only instructors become the listed instructor
        instructorId:
          creator?.role === UserRole.INSTRUCTOR ? createdById : undefined,
      },
    });
  }

  async getCourse(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        modules: {
          include: {
            _count: { select: { contentItems: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        instructor: { select: { id: true, fullName: true, role: true } },
        enrollments: {
          include: {
            student: {
              select: { id: true, fullName: true, email: true, role: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    return course;
  }

  async listAnnouncements(courseId: string) {
    return this.prisma.courseAnnouncement.findMany({
      where: { courseId },
      include: {
        createdBy: { select: { id: true, fullName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async assertStudentEnrollment(courseId: string, studentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: {
        courseId_studentId: { courseId, studentId },
      },
    });
    if (!enrollment) {
      throw new NotFoundException('Course not found for this student');
    }
  }

  async createAnnouncement(
    courseId: string,
    createdById: string,
    title: string,
    body: string,
  ) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    const announcement = await this.prisma.courseAnnouncement.create({
      data: {
        courseId,
        createdById,
        title,
        body,
      },
      include: {
        createdBy: { select: { id: true, fullName: true, role: true } },
      },
    });

    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId },
      select: { studentId: true },
    });

    if (enrollments.length > 0) {
      const targetUserIds = enrollments.map(
        (enrollment) => enrollment.studentId,
      );
      // one in-app notification per enrolled student
      await this.prisma.notification.createMany({
        data: enrollments.map((enrollment) => ({
          userId: enrollment.studentId,
          courseId,
          type: NotificationType.ANNOUNCEMENT,
          title: `${course.title}: ${title}`,
          message: body,
          entityId: announcement.id,
        })),
      });
      // keeps each user's inbox from growing without bound
      await this.pruneNotificationsForUsers(targetUserIds);
    }

    return announcement;
  }

  async updateCourse(
    id: string,
    title?: string,
    description?: string,
    backgroundImage?: string,
  ) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) {
      throw new NotFoundException('Course not found');
    }

    return this.prisma.course.update({
      where: { id },
      data: {
        title,
        description,
        backgroundImage,
      },
    });
  }

  async deleteCourse(id: string, confirmTitle: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        modules: {
          include: {
            contentItems: {
              select: { id: true },
            },
          },
        },
      },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.title !== confirmTitle) {
      throw new BadRequestException('Course title confirmation does not match');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const moduleEntity of course.modules) {
        for (const contentItem of moduleEntity.contentItems) {
          await this.deleteContentItemDependencies(tx, contentItem.id);
        }
      }

      await tx.courseModule.deleteMany({
        where: { courseId: course.id },
      });

      await tx.enrollment.deleteMany({
        where: { courseId: course.id },
      });

      await tx.courseAnnouncement.deleteMany({
        where: { courseId: course.id },
      });

      await tx.notification.deleteMany({
        where: { courseId: course.id },
      });

      await tx.course.delete({
        where: { id: course.id },
      });
    });

    return { deleted: true };
  }

  // mirrors similar cleanup in UsersService / CourseModulesService; order matters for FKs
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

    await tx.fileAttachment.deleteMany({
      where: { contentItemId },
    });

    await tx.contentItem.delete({
      where: { id: contentItemId },
    });
  }

  // cap at 10 newest rows per user; delete older extras
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
