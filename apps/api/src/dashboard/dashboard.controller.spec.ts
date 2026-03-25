// goal: thin controller tests ensuring JWT user fields reach DashboardService.

import { Role } from '../common/enums/role.enum';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController', () => {
  const dashboardService = {
    overview: jest.fn(),
    recentActivity: jest.fn(),
  } as unknown as DashboardService;

  let controller: DashboardController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new DashboardController(dashboardService);
  });

  it('passes role and userId to overview service call', async () => {
    (dashboardService.overview as jest.Mock).mockResolvedValue({ pending: 1 });

    await expect(
      controller.overview({
        user: { role: Role.INSTRUCTOR, sub: 'u1' },
      } as never),
    ).resolves.toEqual({ pending: 1 });
    expect(dashboardService.overview).toHaveBeenCalledWith({
      role: Role.INSTRUCTOR,
      userId: 'u1',
    });
  });

  it('passes role and userId to recentActivity service call', async () => {
    (dashboardService.recentActivity as jest.Mock).mockResolvedValue([
      { id: 'r1' },
    ]);

    await expect(
      controller.recentActivity({
        user: { role: Role.ADMIN, sub: 'a1' },
      } as never),
    ).resolves.toEqual([{ id: 'r1' }]);
    expect(dashboardService.recentActivity).toHaveBeenCalledWith({
      role: Role.ADMIN,
      userId: 'a1',
    });
  });
});
