import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { ConversationService } from './conversation.service';
import {
  Conversation,
  ConversationType,
} from './entities/conversation.entity';
import { Message, MessageRole } from './entities/message.entity';

describe('ConversationService', () => {
  let service: ConversationService;
  let conversations: Conversation[];
  let messages: Message[];
  let conversationRepo: jest.Mocked<Repository<Conversation>>;
  let messageRepo: jest.Mocked<Repository<Message>>;

  const OWNER_ID = 42;
  const OTHER_USER_ID = 99;
  const COURSE_ID = 7;

  function makeConversation(
    overrides: Partial<Conversation> & Pick<Conversation, 'id' | 'type'> = {
      id: 'conv-1',
      type: 'general',
    },
  ): Conversation {
    const now = new Date('2026-01-15T12:00:00.000Z');
    return {
      id: overrides.id,
      courseId: overrides.courseId ?? COURSE_ID,
      moodleUserId: overrides.moodleUserId ?? OWNER_ID,
      type: overrides.type,
      title: overrides.title ?? (overrides.type === 'manual' ? 'My chat' : 'Main'),
      sectionId: overrides.sectionId,
      sectionNumber: overrides.sectionNumber,
      sectionName: overrides.sectionName,
      tag: overrides.tag ?? '#main',
      pinned: overrides.pinned ?? false,
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
      messages: overrides.messages ?? [],
    };
  }

  function makeMessage(
    overrides: Partial<Message> &
      Pick<Message, 'id' | 'conversationId' | 'content'> = {
      id: 'msg-1',
      conversationId: 'conv-1',
      content: 'hello',
    },
  ): Message {
    return {
      id: overrides.id,
      conversationId: overrides.conversationId,
      role: overrides.role ?? 'user',
      content: overrides.content,
      createdAt: overrides.createdAt ?? new Date('2026-01-15T12:00:00.000Z'),
      conversation: overrides.conversation as Conversation,
    };
  }

  /** Chainable query-builder mock that filters/sorts an in-memory row set. */
  function createQueryBuilderMock<T extends { createdAt?: Date }>(
    getRows: () => T[],
    applyWhere: (rows: T[], alias: string, condition: string, params: Record<string, unknown>) => T[],
  ) {
    let rows: T[] = [];
    let takeCount: number | undefined;
    let orderDir: 'ASC' | 'DESC' = 'ASC';

    const qb: Record<string, jest.Mock> = {};
    qb.where = jest.fn((condition: string, params: Record<string, unknown>) => {
      rows = applyWhere(getRows(), 'root', condition, params);
      return qb;
    });
    qb.andWhere = jest.fn((condition: string, params: Record<string, unknown>) => {
      rows = applyWhere(rows, 'root', condition, params);
      return qb;
    });
    qb.orderBy = jest.fn((_expr: string, direction?: 'ASC' | 'DESC') => {
      orderDir = direction ?? 'ASC';
      return qb;
    });
    qb.addOrderBy = jest.fn(() => qb);
    qb.take = jest.fn((n: number) => {
      takeCount = n;
      return qb;
    });
    qb.getOne = jest.fn(async () => {
      const sorted = [...rows].sort((a, b) => {
        const aTime = a.createdAt?.getTime() ?? 0;
        const bTime = b.createdAt?.getTime() ?? 0;
        return orderDir === 'DESC' ? bTime - aTime : aTime - bTime;
      });
      return sorted[0] ?? null;
    });
    qb.getMany = jest.fn(async () => {
      const sorted = [...rows].sort((a, b) => {
        const aTime = a.createdAt?.getTime() ?? 0;
        const bTime = b.createdAt?.getTime() ?? 0;
        return orderDir === 'DESC' ? bTime - aTime : aTime - bTime;
      });
      return takeCount === undefined ? sorted : sorted.slice(0, takeCount);
    });

    return qb;
  }

  beforeEach(() => {
    conversations = [];
    messages = [];

    conversationRepo = {
      create: jest.fn((data: Partial<Conversation>) =>
        makeConversation({
          id: `conv-${conversations.length + 1}`,
          type: (data.type as ConversationType) ?? 'general',
          ...data,
        }),
      ),
      save: jest.fn(async (entity: Conversation) => {
        const idx = conversations.findIndex((c) => c.id === entity.id);
        if (idx >= 0) {
          conversations[idx] = { ...conversations[idx], ...entity };
          return conversations[idx];
        }
        conversations.push(entity);
        return entity;
      }),
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
        return conversations.find((c) => c.id === where.id) ?? null;
      }),
      find: jest.fn(async () => conversations),
      delete: jest.fn(async (criteria: { id: string }) => {
        const before = conversations.length;
        conversations = conversations.filter((c) => c.id !== criteria.id);
        // Simulate TypeORM onDelete: 'CASCADE' from Message -> Conversation
        messages = messages.filter((m) => m.conversationId !== criteria.id);
        return { affected: before === conversations.length ? 0 : 1 };
      }),
      createQueryBuilder: jest.fn(() =>
        createQueryBuilderMock<Conversation>(
          () => conversations,
          (rows, _alias, condition, params) => {
            let filtered = rows;
            if (condition.includes('moodle_user_id') && params.moodleUserId !== undefined) {
              filtered = filtered.filter((c) => c.moodleUserId === params.moodleUserId);
            }
            if (condition.includes('course_id') && params.courseId !== undefined) {
              filtered = filtered.filter((c) => c.courseId === params.courseId);
            }
            if (condition.includes("COALESCE(c.type, 'general') = 'general'")) {
              filtered = filtered.filter((c) => (c.type ?? 'general') === 'general');
            }
            if (condition.includes('c.type = :type') && params.type !== undefined) {
              filtered = filtered.filter((c) => c.type === params.type);
            }
            if (condition.includes('section_id') && params.sectionId !== undefined) {
              filtered = filtered.filter((c) => c.sectionId === params.sectionId);
            }
            if (condition.includes('section_number') && params.sectionNumber !== undefined) {
              filtered = filtered.filter((c) => c.sectionNumber === params.sectionNumber);
            }
            return filtered;
          },
        ),
      ),
    } as unknown as jest.Mocked<Repository<Conversation>>;

    messageRepo = {
      create: jest.fn((data: Partial<Message>) =>
        makeMessage({
          id: `msg-${messages.length + 1}`,
          conversationId: data.conversationId ?? 'conv-1',
          content: data.content ?? '',
          role: data.role as MessageRole,
          createdAt: data.createdAt,
        }),
      ),
      save: jest.fn(async (entity: Message) => {
        messages.push(entity);
        return entity;
      }),
      createQueryBuilder: jest.fn(() =>
        createQueryBuilderMock<Message>(
          () => messages,
          (rows, _alias, condition, params) => {
            let filtered = rows;
            if (
              condition.includes('conversation_id') &&
              params.conversationId !== undefined
            ) {
              filtered = filtered.filter(
                (m) => m.conversationId === params.conversationId,
              );
            }
            if (condition.includes('created_at <') && params.before instanceof Date) {
              const before = params.before;
              filtered = filtered.filter(
                (m) => m.createdAt.getTime() < before.getTime(),
              );
            }
            return filtered;
          },
        ),
      ),
    } as unknown as jest.Mocked<Repository<Message>>;

    service = new ConversationService(conversationRepo, messageRepo);
  });

  describe('ownership check', () => {
    beforeEach(() => {
      conversations.push(
        makeConversation({
          id: 'owned-conv',
          type: 'general',
          moodleUserId: OWNER_ID,
        }),
      );
    });

    it('rejects getSummary when moodleUserId does not match the owner', async () => {
      await expect(
        service.getSummary('owned-conv', OTHER_USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects updateConversation when moodleUserId does not match the owner', async () => {
      await expect(
        service.updateConversation('owned-conv', OTHER_USER_ID, {
          pinned: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects deleteConversation when moodleUserId does not match the owner', async () => {
      await expect(
        service.deleteConversation('owned-conv', OTHER_USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(conversationRepo.delete).not.toHaveBeenCalled();
    });

    it('rejects getMessagesPage when moodleUserId does not match the owner', async () => {
      await expect(
        service.getMessagesPage('owned-conv', OTHER_USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows the owner to access the conversation', async () => {
      const summary = await service.getSummary('owned-conv', OWNER_ID);
      expect(summary.id).toBe('owned-conv');
    });

    it('rejects with NotFoundException when the conversation does not exist', async () => {
      await expect(
        service.getSummary('missing', OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('idempotent open', () => {
    it('returns the existing general conversation instead of creating a duplicate', async () => {
      const existing = makeConversation({
        id: 'general-1',
        type: 'general',
        title: 'Main',
        moodleUserId: OWNER_ID,
        courseId: COURSE_ID,
      });
      conversations.push(existing);

      const first = await service.openConversation(COURSE_ID, OWNER_ID, {
        type: 'general',
      });
      const second = await service.openConversation(COURSE_ID, OWNER_ID, {
        type: 'general',
      });

      expect(first.id).toBe('general-1');
      expect(second.id).toBe('general-1');
      expect(conversations.filter((c) => c.type === 'general')).toHaveLength(1);
      // save is used to refresh metadata on the existing row, not create
      expect(conversationRepo.create).not.toHaveBeenCalled();
    });

    it('returns the existing section conversation instead of creating a duplicate', async () => {
      const existing = makeConversation({
        id: 'section-1',
        type: 'section',
        title: 'Week 1 chat',
        sectionId: 10,
        sectionNumber: 1,
        sectionName: 'Week 1',
        tag: '#week1',
        moodleUserId: OWNER_ID,
        courseId: COURSE_ID,
      });
      conversations.push(existing);

      const first = await service.openConversation(COURSE_ID, OWNER_ID, {
        type: 'section',
        sectionId: 10,
        sectionNumber: 1,
        sectionName: 'Week 1',
      });
      const second = await service.openConversation(COURSE_ID, OWNER_ID, {
        type: 'section',
        sectionId: 10,
        sectionNumber: 1,
        sectionName: 'Week 1',
      });

      expect(first.id).toBe('section-1');
      expect(second.id).toBe('section-1');
      expect(
        conversations.filter(
          (c) => c.type === 'section' && c.sectionId === 10,
        ),
      ).toHaveLength(1);
      expect(conversationRepo.create).not.toHaveBeenCalled();
    });

    it('creates a general conversation when none exists', async () => {
      const created = await service.openConversation(COURSE_ID, OWNER_ID, {
        type: 'general',
      });

      expect(created.type).toBe('general');
      expect(conversations).toHaveLength(1);
      expect(conversationRepo.create).toHaveBeenCalled();
    });
  });

  describe('rename restriction', () => {
    it('allows renaming a manual conversation', async () => {
      conversations.push(
        makeConversation({
          id: 'manual-1',
          type: 'manual',
          title: 'Old title',
          tag: '#old-title',
        }),
      );

      const updated = await service.updateConversation('manual-1', OWNER_ID, {
        title: 'New title',
      });

      expect(updated.title).toBe('New title');
      expect(conversations[0].title).toBe('New title');
    });

    it('rejects renaming a general conversation', async () => {
      conversations.push(
        makeConversation({
          id: 'general-1',
          type: 'general',
          title: 'Main',
        }),
      );

      await expect(
        service.updateConversation('general-1', OWNER_ID, {
          title: 'Renamed Main',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(conversations[0].title).toBe('Main');
    });

    it('rejects renaming a section conversation', async () => {
      conversations.push(
        makeConversation({
          id: 'section-1',
          type: 'section',
          title: 'Week 1 chat',
          sectionName: 'Week 1',
          tag: '#week1',
        }),
      );

      await expect(
        service.updateConversation('section-1', OWNER_ID, {
          title: 'Renamed section',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(conversations[0].title).toBe('Week 1 chat');
    });

    it('still allows pinning a general conversation without renaming', async () => {
      conversations.push(
        makeConversation({
          id: 'general-1',
          type: 'general',
          pinned: false,
        }),
      );

      const updated = await service.updateConversation('general-1', OWNER_ID, {
        pinned: true,
      });

      expect(updated.pinned).toBe(true);
    });
  });

  describe('pagination on message history', () => {
    const CONV_ID = 'conv-page';

    beforeEach(() => {
      conversations.push(
        makeConversation({
          id: CONV_ID,
          type: 'manual',
          title: 'Paginated chat',
        }),
      );

      // 40 messages, newest last in construction; timestamps increase
      for (let i = 1; i <= 40; i++) {
        messages.push(
          makeMessage({
            id: `msg-${i}`,
            conversationId: CONV_ID,
            role: i % 2 === 0 ? 'assistant' : 'user',
            content: `message ${i}`,
            createdAt: new Date(`2026-01-15T12:${String(i).padStart(2, '0')}:00.000Z`),
          }),
        );
      }
    });

    it('respects the default limit of 30', async () => {
      const page = await service.getMessagesPage(CONV_ID, OWNER_ID);

      expect(page.messages).toHaveLength(30);
      expect(page.hasMore).toBe(true);
      // Page is returned chronological (oldest of the page first)
      expect(page.messages[0].content).toBe('message 11');
      expect(page.messages[29].content).toBe('message 40');
    });

    it('respects a custom limit', async () => {
      const page = await service.getMessagesPage(CONV_ID, OWNER_ID, 10);

      expect(page.messages).toHaveLength(10);
      expect(page.hasMore).toBe(true);
      expect(page.messages[0].content).toBe('message 31');
      expect(page.messages[9].content).toBe('message 40');
    });

    it('clamps limit exceeding the max of 100 down to 100', async () => {
      // Seed enough messages that a clamp is observable vs uncapped
      for (let i = 41; i <= 120; i++) {
        messages.push(
          makeMessage({
            id: `msg-${i}`,
            conversationId: CONV_ID,
            role: 'user',
            content: `message ${i}`,
            createdAt: new Date(
              `2026-01-16T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
            ),
          }),
        );
      }

      const page = await service.getMessagesPage(CONV_ID, OWNER_ID, 500);

      expect(page.messages).toHaveLength(100);
      expect(page.hasMore).toBe(true);
    });

    it('filters to older messages when before cursor is provided', async () => {
      const before = new Date('2026-01-15T12:20:00.000Z'); // exclusive: messages 1–19

      const page = await service.getMessagesPage(
        CONV_ID,
        OWNER_ID,
        10,
        before,
      );

      expect(page.messages).toHaveLength(10);
      expect(
        page.messages.every((m) => m.createdAt.getTime() < before.getTime()),
      ).toBe(true);
      expect(page.messages[0].content).toBe('message 10');
      expect(page.messages[9].content).toBe('message 19');
      expect(page.hasMore).toBe(true);
    });
  });

  describe('synthetic welcome message filtering', () => {
    it('filters a matching synthetic welcome message out of message history', async () => {
      const CONV_ID = 'conv-welcome';
      conversations.push(makeConversation({ id: CONV_ID, type: 'general' }));
      messages.push(
        makeMessage({
          id: 'welcome-msg',
          conversationId: CONV_ID,
          role: 'assistant',
          content: 'What would you like to know about this course?',
          createdAt: new Date('2026-01-15T12:00:00.000Z'),
        }),
        makeMessage({
          id: 'real-msg',
          conversationId: CONV_ID,
          role: 'user',
          content: 'Actual question',
          createdAt: new Date('2026-01-15T12:01:00.000Z'),
        }),
      );

      const page = await service.getMessagesPage(CONV_ID, OWNER_ID);

      expect(page.messages.find((m) => m.id === 'welcome-msg')).toBeUndefined();
      expect(page.messages).toHaveLength(1);
    });
  });
  
  describe('cascade delete', () => {
    it('removes associated messages when a conversation is deleted', async () => {
      const conv = makeConversation({
        id: 'to-delete',
        type: 'manual',
        title: 'Delete me',
      });
      conversations.push(conv);
      messages.push(
        makeMessage({
          id: 'm1',
          conversationId: 'to-delete',
          content: 'first',
          role: 'user',
        }),
        makeMessage({
          id: 'm2',
          conversationId: 'to-delete',
          content: 'second',
          role: 'assistant',
        }),
        makeMessage({
          id: 'other',
          conversationId: 'other-conv',
          content: 'unrelated',
          role: 'user',
        }),
      );

      await service.deleteConversation('to-delete', OWNER_ID);

      expect(conversationRepo.delete).toHaveBeenCalledWith({ id: 'to-delete' });
      expect(conversations.find((c) => c.id === 'to-delete')).toBeUndefined();
      expect(messages.filter((m) => m.conversationId === 'to-delete')).toHaveLength(
        0,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('other');
    });
  });

  describe('listForCourse', () => {
    it('calls repository find with the correct where and order', async () => {
      conversationRepo.find.mockResolvedValue([]);

      await service.listForCourse(OWNER_ID, COURSE_ID);

      expect(conversationRepo.find).toHaveBeenCalledWith({
        where: { moodleUserId: OWNER_ID, courseId: COURSE_ID },
        order: {
          pinned: 'DESC',
          type: 'ASC',
          sectionNumber: 'ASC',
          createdAt: 'ASC',
        },
      });
    });

    it('maps results through toSummary', async () => {
      const createdAt = new Date('2026-01-10T10:00:00.000Z');
      const updatedAt = new Date('2026-01-11T11:00:00.000Z');
      conversationRepo.find.mockResolvedValue([
        makeConversation({
          id: 'list-general',
          type: 'general',
          title: 'Stored title ignored for general',
          pinned: true,
          createdAt,
          updatedAt,
        }),
        makeConversation({
          id: 'list-section',
          type: 'section',
          title: 'Week 1 chat',
          sectionId: 10,
          sectionNumber: 1,
          sectionName: 'Week 1',
          tag: '#week1',
          pinned: false,
          createdAt,
          updatedAt,
        }),
      ]);

      const summaries = await service.listForCourse(OWNER_ID, COURSE_ID);

      expect(summaries).toHaveLength(2);
      expect(summaries[0]).toEqual(
        expect.objectContaining({
          id: 'list-general',
          courseId: COURSE_ID,
          moodleUserId: OWNER_ID,
          type: 'general',
          title: 'Main',
          tag: '#main',
          pinned: true,
          createdAt,
          updatedAt,
        }),
      );
      expect(summaries[1]).toEqual(
        expect.objectContaining({
          id: 'list-section',
          type: 'section',
          title: 'Week 1 chat',
          sectionId: 10,
          sectionNumber: 1,
          sectionName: 'Week 1',
          tag: '#week1',
          pinned: false,
        }),
      );
    });
  });

  describe('searchForCourse', () => {
    function mockSearchQueryBuilder(results: Conversation[]) {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(results),
      };
      conversationRepo.createQueryBuilder = jest.fn().mockReturnValue(qb) as never;
      return qb;
    }

    it('returns [] immediately for empty/whitespace queries without calling the repository', async () => {
      await expect(
        service.searchForCourse(OWNER_ID, COURSE_ID, ''),
      ).resolves.toEqual([]);
      await expect(
        service.searchForCourse(OWNER_ID, COURSE_ID, '   '),
      ).resolves.toEqual([]);
      await expect(
        service.searchForCourse(OWNER_ID, COURSE_ID, '\t\n'),
      ).resolves.toEqual([]);

      expect(conversationRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns ConversationSearchResult with matchedMessage when message content matches', async () => {
      const msgCreatedAt = new Date('2026-01-15T13:00:00.000Z');
      const conversation = makeConversation({
        id: 'search-msg',
        type: 'manual',
        title: 'Lab notes',
        tag: '#lab-notes',
        messages: [
          makeMessage({
            id: 'hit-msg',
            conversationId: 'search-msg',
            role: 'user',
            content: 'Explain photosynthesis pathways',
            createdAt: msgCreatedAt,
          }),
        ],
      });
      mockSearchQueryBuilder([conversation]);

      const results = await service.searchForCourse(
        OWNER_ID,
        COURSE_ID,
        'photosynthesis',
      );

      expect(conversationRepo.createQueryBuilder).toHaveBeenCalledWith('c');
      expect(results).toHaveLength(1);
      expect(results[0].conversation).toEqual(
        expect.objectContaining({
          id: 'search-msg',
          type: 'manual',
          title: 'Lab notes',
          tag: '#lab-notes',
        }),
      );
      expect(results[0].matchedMessage).toEqual({
        id: 'hit-msg',
        role: 'user',
        content: 'Explain photosynthesis pathways',
        createdAt: msgCreatedAt,
      });
    });

    it('leaves matchedMessage undefined when the match is on title/tag/sectionName only', async () => {
      const conversation = makeConversation({
        id: 'search-title',
        type: 'section',
        title: 'Photosynthesis chat',
        sectionName: 'Week 3 Photosynthesis',
        tag: '#week3',
        sectionId: 30,
        sectionNumber: 3,
        messages: [
          makeMessage({
            id: 'unrelated',
            conversationId: 'search-title',
            role: 'assistant',
            content: 'Hello from the section chat',
          }),
        ],
      });
      mockSearchQueryBuilder([conversation]);

      const results = await service.searchForCourse(
        OWNER_ID,
        COURSE_ID,
        'Photosynthesis',
      );

      expect(results).toHaveLength(1);
      expect(results[0].conversation.id).toBe('search-title');
      expect(results[0].matchedMessage).toBeUndefined();
    });
  });
});
