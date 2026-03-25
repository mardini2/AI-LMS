// goal: guardrails for enrollment helpers, email uniqueness, and admin delete safety.

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    course: {
      findUnique: jest.fn(),
    },
    enrollment: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(prisma as never);
  });

  it('rejects createUser when email is already used', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

    await expect(
      service.createUser({
        email: 'x@example.com',
        fullName: 'X',
        password: 'p',
        role: UserRole.STUDENT,
      }),
    ).rejects.toThrow(new BadRequestException('Email already in use'));
  });

  it('only allows students to be enrolled in a course', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: UserRole.REVIEWER,
    });
    prisma.course.findUnique.mockResolvedValue({ id: 'c1' });

    await expect(service.addStudentToCourse('u1', 'c1')).rejects.toThrow(
      new BadRequestException('Only students can be enrolled'),
    );
  });

  it('throws when removing a non-existent enrollment', async () => {
    prisma.enrollment.findUnique.mockResolvedValue(null);

    await expect(service.removeStudentFromCourse('u1', 'c1')).rejects.toThrow(
      new NotFoundException('Enrollment not found'),
    );
  });

  it('blocks deleting admin accounts', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      fullName: 'Admin User',
      role: UserRole.ADMIN,
    });

    await expect(service.deleteUser('u1', 'Admin User')).rejects.toThrow(
      new BadRequestException('Deleting admin accounts is disabled for safety'),
    );
  });
});
