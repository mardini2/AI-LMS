import { Role } from '../common/enums/role.enum';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController', () => {
  const dashboardService = {
    overview: jest.fn(),
  } as unknown as DashboardService;

  let controller: DashboardController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new DashboardController(dashboardService);
  });

  it('passes role and userId to overview service call', async () => {
    (dashboardService.overview as jest.Mock).mockResolvedValue({ courses: 2 });

    await expect(
      controller.overview({
        user: { role: Role.INSTRUCTOR, sub: 'u1' },
      } as never),
    ).resolves.toEqual({ courses: 2 });
    expect(dashboardService.overview).toHaveBeenCalledWith({
      role: Role.INSTRUCTOR,
      userId: 'u1',
    });
  });
});
