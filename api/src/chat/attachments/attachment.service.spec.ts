import { ForbiddenException } from '@nestjs/common';
import { AttachmentService } from './attachment.service';

function mockRepo(overrides: Record<string, unknown> = {}) {
  return {
    findBy: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
    findOneByOrFail: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
    ...overrides,
  };
}

describe('AttachmentService ownership and limits', () => {
  it('rejects attachments owned by another user', async () => {
    const attachmentRepo = mockRepo({
      findBy: jest.fn().mockResolvedValue([
        {
          id: 'a1',
          moodleUserId: 99,
          conversationId: 'c1',
          filename: 'secret.txt',
        },
      ]),
    });
    const service = new AttachmentService(
      attachmentRepo as never,
      mockRepo() as never,
      { deleteObjectIfExists: jest.fn() } as never,
      { get: jest.fn() } as never,
    );

    await expect(
      service.assertOwnedAttachments(['a1'], 1, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('builds follow-up context from ready conversation chunks', async () => {
    const attachmentRepo = mockRepo({
      findBy: jest.fn().mockResolvedValue([]),
      find: jest.fn().mockResolvedValue([
        {
          id: 'prior',
          filename: 'notes.txt',
          status: 'ready',
          moodleUserId: 1,
          conversationId: 'c1',
        },
      ]),
      save: jest.fn(async (x) => x),
    });
    const chunkRepo = mockRepo({
      find: jest.fn().mockResolvedValue([
        {
          id: 'ch1',
          attachmentId: 'prior',
          chunkIndex: 0,
          content: 'Semaphores protect critical sections.',
        },
      ]),
    });
    const service = new AttachmentService(
      attachmentRepo as never,
      chunkRepo as never,
      {} as never,
      { get: jest.fn() } as never,
    );

    const resolved = await service.resolveForMessage({
      attachmentIds: [],
      moodleUserId: 1,
      conversationId: 'c1',
      query: 'What are semaphores?',
    });

    expect(resolved.promptBlock).toContain('Semaphores protect critical sections.');
    expect(resolved.usableFilenames).toEqual(['notes.txt']);
  });

  it('purges storage + chunks + metadata on delete', async () => {
    const row = {
      id: 'a1',
      moodleUserId: 1,
      storageKey: 'attachments/a1/original',
    };
    const attachmentRepo = mockRepo({
      findOneBy: jest.fn().mockResolvedValue(row),
      delete: jest.fn(),
    });
    const chunkRepo = mockRepo({ delete: jest.fn() });
    const storage = { deleteObjectIfExists: jest.fn() };
    const service = new AttachmentService(
      attachmentRepo as never,
      chunkRepo as never,
      storage as never,
      { get: jest.fn() } as never,
    );

    await expect(service.deleteAttachment('a1', 1)).resolves.toEqual({
      deleted: true,
    });
    expect(storage.deleteObjectIfExists).toHaveBeenCalledWith(
      'attachments/a1/original',
    );
    expect(chunkRepo.delete).toHaveBeenCalledWith({ attachmentId: 'a1' });
    expect(attachmentRepo.delete).toHaveBeenCalledWith({ id: 'a1' });
  });
});
