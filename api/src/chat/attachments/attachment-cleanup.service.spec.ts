import { AttachmentCleanupService } from './attachment-cleanup.service';

describe('AttachmentCleanupService', () => {
  it('runs an idempotent cleanup pass and skips overlaps', async () => {
    const attachments = {
      cleanupAbandoned: jest.fn().mockResolvedValue(2),
      getRetentionDays: jest.fn().mockReturnValue(30),
      cleanupExpiredByRetention: jest.fn().mockResolvedValue(1),
    };
    const conversationRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]),
    };
    const service = new AttachmentCleanupService(
      attachments as never,
      conversationRepo as never,
    );

    const first = await service.runCleanupPass();
    expect(first).toEqual({ abandoned: 2, expired: 1 });
    expect(attachments.cleanupExpiredByRetention).toHaveBeenCalledWith([
      'c1',
      'c2',
    ]);

    // Force overlapping run: set running via first call in progress.
    let resolveAbandoned!: (n: number) => void;
    attachments.cleanupAbandoned.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          resolveAbandoned = resolve;
        }),
    );
    const pending = service.runCleanupPass();
    const skipped = await service.runCleanupPass();
    expect(skipped).toEqual({ abandoned: 0, expired: 0 });
    resolveAbandoned(0);
    await pending;
  });
});
