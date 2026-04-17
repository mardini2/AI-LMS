// prisma-backed admin operations on users, enrollments, and safe cascading delete

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { hash } from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateRole(userId: string, role: UserRole) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
      },
    });
  }

  async createUser(input: {
    email: string;
    fullName: string;
    password: string;
    role: UserRole;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      throw new BadRequestException('Email already in use');
    }

    const passwordHash = await hash(input.password, 10);

    return this.prisma.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        passwordHash,
        role: input.role,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async studentEnrollments(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.role !== UserRole.STUDENT) {
      throw new BadRequestException('User is not a student');
    }

    return this.prisma.enrollment.findMany({
      where: { studentId: userId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            description: true,
            backgroundImage: true,
            instructor: { select: { id: true, fullName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addStudentToCourse(userId: string, courseId: string) {
    const [user, course] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.course.findUnique({ where: { id: courseId } }),
    ]);

    if (!user) throw new NotFoundException('User not found');
    if (!course) throw new NotFoundException('Course not found');
    if (user.role !== UserRole.STUDENT) {
      throw new BadRequestException('Only students can be enrolled');
    }

    return this.prisma.enrollment.upsert({
      where: {
        courseId_studentId: { courseId, studentId: userId },
      },
      update: {},
      create: {
        courseId,
        studentId: userId,
      },
    });
  }

  async removeStudentFromCourse(userId: string, courseId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: {
        courseId_studentId: { courseId, studentId: userId },
      },
    });
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    await this.prisma.enrollment.delete({
      where: {
        courseId_studentId: { courseId, studentId: userId },
      },
    });

    return { removed: true };
  }

  async deleteUser(userId: string, confirmFullName: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.fullName !== confirmFullName) {
      throw new BadRequestException(
        'User full name confirmation does not match',
      );
    }
    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Deleting admin accounts is disabled for safety',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const ownedCourses = await tx.course.findMany({
        where: { createdById: user.id },
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

      for (const course of ownedCourses) {
        for (const moduleEntity of course.modules) {
          for (const contentItem of moduleEntity.contentItems) {
            await this.deleteContentItemDependencies(tx, contentItem.id);
          }
        }

        await tx.courseModule.deleteMany({ where: { courseId: course.id } });
        await tx.enrollment.deleteMany({ where: { courseId: course.id } });
        await tx.course.delete({ where: { id: course.id } });
      }

      const authoredItems = await tx.contentItem.findMany({
        where: { createdById: user.id },
        select: { id: true },
      });
      for (const item of authoredItems) {
        await this.deleteContentItemDependencies(tx, item.id);
      }

      await tx.fileAttachment.deleteMany({ where: { uploadedById: user.id } });
      await tx.coachingMessage.deleteMany({ where: { userId: user.id } });
      await tx.studentSubmission.deleteMany({ where: { studentId: user.id } });
      await tx.enrollment.deleteMany({ where: { studentId: user.id } });

      await tx.studentSubmission.updateMany({
        where: { gradedById: user.id },
        data: { gradedById: null },
      });

      await tx.course.updateMany({
        where: { instructorId: user.id },
        data: { instructorId: null },
      });

      await tx.user.delete({ where: { id: user.id } });
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
