// goal: cover instructor flagging on create, announcements, enrollment checks, and delete.

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationType, UserRole } from '@prisma/client';
import { CoursesService } from './courses.service';

describe('CoursesService', () => {
  // hand-rolled prisma mock; tests override return values per case
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    course: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    enrollment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    courseAnnouncement: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    notification: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: CoursesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CoursesService(prisma as never);
  });

  it('sets instructorId on createCourse when creator is instructor', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.INSTRUCTOR });
    prisma.course.create.mockResolvedValue({ id: 'c1' });

    await service.createCourse('i1', 'Course', 'Desc', '/bg.png');

    expect(prisma.course.create).toHaveBeenCalledWith({
      data: {
        title: 'Course',
        description: 'Desc',
        backgroundImage: '/bg.png',
        createdById: 'i1',
        instructorId: 'i1',
      },
    });
  });

  it('does not set instructorId on createCourse for non-instructor creators', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: UserRole.ADMIN });
    prisma.course.create.mockResolvedValue({ id: 'c1' });

    await service.createCourse('a1', 'Course');

    expect(prisma.course.create).toHaveBeenCalledWith({
      data: {
        title: 'Course',
        description: undefined,
        backgroundImage: undefined,
        createdById: 'a1',
        instructorId: undefined,
      },
    });
  });

  it('throws when student is not enrolled in course', async () => {
    prisma.enrollment.findUnique.mockResolvedValue(null);

    await expect(service.assertStudentEnrollment('c1', 's1')).rejects.toThrow(
      new NotFoundException('Course not found for this student'),
    );
  });

  it('creates announcement notifications and prunes overflow', async () => {
    prisma.course.findUnique.mockResolvedValue({ id: 'c1', title: 'Data Lit' });
    prisma.courseAnnouncement.create.mockResolvedValue({
      id: 'a1',
      createdBy: { id: 'u1', fullName: 'Inst', role: 'INSTRUCTOR' },
    });
    prisma.enrollment.findMany.mockResolvedValue([
      { studentId: 's1' },
      { studentId: 's2' },
    ]);
    prisma.notification.findMany
      .mockResolvedValueOnce([{ id: 'n-old' }])
      .mockResolvedValueOnce([]);

    await service.createAnnouncement('c1', 'u1', 'Week 1', 'Read chapter 1');

    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 's1',
          courseId: 'c1',
          type: NotificationType.ANNOUNCEMENT,
          title: 'Data Lit: Week 1',
          message: 'Read chapter 1',
          entityId: 'a1',
        },
        {
          userId: 's2',
          courseId: 'c1',
          type: NotificationType.ANNOUNCEMENT,
          title: 'Data Lit: Week 1',
          message: 'Read chapter 1',
          entityId: 'a1',
        },
      ],
    });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['n-old'] } },
    });
  });

  it('rejects deleteCourse when title confirmation does not match', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'c1',
      title: 'Real',
      modules: [],
    });

    await expect(service.deleteCourse('c1', 'Wrong')).rejects.toThrow(
      new BadRequestException('Course title confirmation does not match'),
    );
  });

  it('deletes course and nested dependencies in a transaction', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'c1',
      title: 'Real',
      modules: [{ contentItems: [{ id: 'content-1' }] }],
    });
    const tx = {
      reviewRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
      humanReviewDecision: { deleteMany: jest.fn() },
      agentReview: { deleteMany: jest.fn() },
      finalReviewSummary: { deleteMany: jest.fn() },
      coachingMessage: { deleteMany: jest.fn() },
      fileAttachment: { deleteMany: jest.fn() },
      contentItem: { delete: jest.fn() },
      courseModule: { deleteMany: jest.fn() },
      enrollment: { deleteMany: jest.fn() },
      courseAnnouncement: { deleteMany: jest.fn() },
      notification: { deleteMany: jest.fn() },
      course: { delete: jest.fn() },
    };
    prisma.$transaction.mockImplementation(
      async (cb: (x: typeof tx) => unknown) => cb(tx),
    );

    await expect(service.deleteCourse('c1', 'Real')).resolves.toEqual({
      deleted: true,
    });
    expect(tx.contentItem.delete).toHaveBeenCalledWith({
      where: { id: 'content-1' },
    });
    expect(tx.course.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });
});
