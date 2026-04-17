import { Role } from '../common/enums/role.enum';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const prisma = {
    course: {
      count: jest.fn(),
    },
  };

  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DashboardService(prisma as never);
  });

  it('counts only courses owned or taught by the instructor', async () => {
    prisma.course.count.mockResolvedValue(3);

    await expect(
      service.overview({ role: Role.INSTRUCTOR, userId: 'i1' }),
    ).resolves.toEqual({ courses: 3 });

    expect(prisma.course.count).toHaveBeenCalledWith({
      where: {
        OR: [{ createdById: 'i1' }, { instructorId: 'i1' }],
      },
    });
  });

  it('counts all courses for admin', async () => {
    prisma.course.count.mockResolvedValue(10);

    await expect(
      service.overview({ role: Role.ADMIN, userId: 'a1' }),
    ).resolves.toEqual({ courses: 10 });

    expect(prisma.course.count).toHaveBeenCalledWith();
  });
});
