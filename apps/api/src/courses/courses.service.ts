// prisma queries for courses, enrollments, and deep deletes

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
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
            instructor: { select: { id: true, fullName: true } },
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

      await tx.course.delete({
        where: { id: course.id },
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
}
