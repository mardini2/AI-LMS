import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CoursesService } from './courses.service';

describe('CoursesService', () => {
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

  it('deletes course and nested content in a transaction', async () => {
    prisma.course.findUnique.mockResolvedValue({
      id: 'c1',
      title: 'Real',
      modules: [{ contentItems: [{ id: 'content-1' }] }],
    });
    const tx = {
      studentSubmission: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
      fileAttachment: { deleteMany: jest.fn() },
      coachingMessage: { deleteMany: jest.fn() },
      contentItem: { delete: jest.fn() },
      courseModule: { deleteMany: jest.fn() },
      enrollment: { deleteMany: jest.fn() },
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
