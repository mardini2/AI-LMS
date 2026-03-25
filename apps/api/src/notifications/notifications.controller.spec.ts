// goal: cover query parsing, unread JSON shape, and mark-all-read delegation.

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  const notificationsService = {
    listForUser: jest.fn(),
    unreadCount: jest.fn(),
    markAllRead: jest.fn(),
  } as unknown as NotificationsService;

  let controller: NotificationsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new NotificationsController(notificationsService);
  });

  it('uses default limit when query limit is not provided', async () => {
    (notificationsService.listForUser as jest.Mock).mockResolvedValue([]);

    await controller.listMine({ user: { sub: 'u1' } } as never);

    expect(notificationsService.listForUser).toHaveBeenCalledWith('u1', 5);
  });

  it('parses provided limit query value', async () => {
    (notificationsService.listForUser as jest.Mock).mockResolvedValue([]);

    await controller.listMine({ user: { sub: 'u1' } } as never, '7');

    expect(notificationsService.listForUser).toHaveBeenCalledWith('u1', 7);
  });

  it('returns unread count object shape', async () => {
    (notificationsService.unreadCount as jest.Mock).mockResolvedValue(4);

    await expect(
      controller.unreadCount({ user: { sub: 'u1' } } as never),
    ).resolves.toEqual({ count: 4 });
  });

  it('delegates mark all read for current user', async () => {
    (notificationsService.markAllRead as jest.Mock).mockResolvedValue({
      updated: true,
    });

    await expect(
      controller.markAllRead({ user: { sub: 'u1' } } as never),
    ).resolves.toEqual({ updated: true });
    expect(notificationsService.markAllRead).toHaveBeenCalledWith('u1');
  });
});
