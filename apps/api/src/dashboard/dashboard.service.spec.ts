// goal: assert Prisma where clauses for instructor scoping vs global admin counts.

import { ContentStatus, ReviewStatus } from '@prisma/client';
import { Role } from '../common/enums/role.enum';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const prisma = {
    contentItem: {
      count: jest.fn(),
    },
    reviewRequest: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };

  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DashboardService(prisma as never);
  });

  it('applies instructor ownership filters in overview', async () => {
    prisma.contentItem.count.mockResolvedValue(2);
    prisma.reviewRequest.count.mockResolvedValue(3);

    await service.overview({ role: Role.INSTRUCTOR, userId: 'i1' });

    expect(prisma.contentItem.count).toHaveBeenNthCalledWith(1, {
      where: {
        status: ContentStatus.IN_REVIEW,
        module: {
          course: {
            OR: [{ createdById: 'i1' }, { instructorId: 'i1' }],
          },
        },
      },
    });
    expect(prisma.reviewRequest.count).toHaveBeenCalledWith({
      where: {
        status: ReviewStatus.COMPLETED,
        contentItem: {
          module: {
            course: {
              OR: [{ createdById: 'i1' }, { instructorId: 'i1' }],
            },
          },
        },
      },
    });
  });

  it('returns overview counts for admin without instructor filters', async () => {
    prisma.contentItem.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(4);
    prisma.reviewRequest.count.mockResolvedValueOnce(9);

    await expect(
      service.overview({ role: Role.ADMIN, userId: 'a1' }),
    ).resolves.toEqual({
      pending: 10,
      reviewed: 9,
      approved: 8,
      needsRevision: 6,
      rejected: 4,
    });
  });

  it('applies where filter in recent activity for instructors', async () => {
    prisma.reviewRequest.findMany.mockResolvedValue([]);

    await service.recentActivity({ role: Role.INSTRUCTOR, userId: 'i1' });

    expect(prisma.reviewRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          contentItem: {
            module: {
              course: {
                OR: [{ createdById: 'i1' }, { instructorId: 'i1' }],
              },
            },
          },
        },
      }),
    );
  });
});
