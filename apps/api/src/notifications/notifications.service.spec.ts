// goal: verify take clamping and read-state updates for notifications.

import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const prisma = {
    notification: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationsService(prisma as never);
  });

  it('clamps lower bound of list limit to 1', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    await service.listForUser('u1', 0);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 }),
    );
  });

  it('clamps upper bound of list limit to 10', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    await service.listForUser('u1', 999);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });

  it('returns unread count scoped to user', async () => {
    prisma.notification.count.mockResolvedValue(7);

    await expect(service.unreadCount('u1')).resolves.toBe(7);
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 'u1', isRead: false },
    });
  });

  it('marks unread notifications as read', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });

    await expect(service.markAllRead('u1')).resolves.toEqual({ updated: true });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', isRead: false },
      data: { isRead: true },
    });
  });
});
