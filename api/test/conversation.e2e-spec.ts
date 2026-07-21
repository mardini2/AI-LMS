import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import request = require('supertest');
import { Conversation } from '../src/conversation/entities/conversation.entity';
import { Message } from '../src/conversation/entities/message.entity';
import { cleanDatabase, createTestApp } from './utils/create-test-app';

describe('ConversationController (e2e)', () => {
  let app: INestApplication;
  let conversationRepo: Repository<Conversation>;
  let messageRepo: Repository<Message>;

  const OWNER_ID = 1;
  const OTHER_USER_ID = 2;
  const COURSE_ID = 7;

  beforeAll(async () => {
    app = await createTestApp();
    conversationRepo = app.get(getRepositoryToken(Conversation));
    messageRepo = app.get(getRepositoryToken(Message));
  });

  afterEach(async () => {
    await cleanDatabase(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedConversation(
    overrides: Partial<Conversation> = {},
  ): Promise<Conversation> {
    return conversationRepo.save(
      conversationRepo.create({
        courseId: COURSE_ID,
        moodleUserId: OWNER_ID,
        type: 'manual',
        title: 'Chat',
        tag: '#chat',
        pinned: false,
        ...overrides,
      }),
    );
  }

  async function seedMessage(
    conversationId: string,
    overrides: Partial<Message> = {},
  ): Promise<Message> {
    return messageRepo.save(
      messageRepo.create({
        conversationId,
        role: 'user',
        content: 'hello',
        ...overrides,
      }),
    );
  }

  describe('GET /conversations/search', () => {
    it('returns title matches and message-content matches with matchedMessage only for the latter', async () => {
      const bonding = await seedConversation({ title: 'Bonding Basics' });
      const unrelated = await seedConversation({ title: 'Unrelated Chat' });
      const covalentMessage = await seedMessage(unrelated.id, {
        content: 'Can you explain a covalent bond?',
        role: 'user',
      });

      const res = await request(app.getHttpServer())
        .get('/conversations/search')
        .query({
          moodleUserId: String(OWNER_ID),
          courseId: String(COURSE_ID),
          q: 'bond',
        })
        .expect(200);

      expect(res.body).toHaveLength(2);

      const byTitle = res.body.find(
        (row: { conversation: { id: string } }) =>
          row.conversation.id === bonding.id,
      );
      const byMessage = res.body.find(
        (row: { conversation: { id: string } }) =>
          row.conversation.id === unrelated.id,
      );

      expect(byTitle).toBeDefined();
      expect(byTitle.conversation.title).toBe('Bonding Basics');
      expect(byTitle.matchedMessage).toBeUndefined();

      expect(byMessage).toBeDefined();
      expect(byMessage.conversation.title).toBe('Unrelated Chat');
      expect(byMessage.matchedMessage).toEqual(
        expect.objectContaining({
          id: covalentMessage.id,
          role: 'user',
          content: 'Can you explain a covalent bond?',
        }),
      );
    });

    it('returns an empty array when nothing matches', async () => {
      await seedConversation({ title: 'Bonding Basics' });
      await seedConversation({ title: 'Unrelated Chat' });

      const res = await request(app.getHttpServer())
        .get('/conversations/search')
        .query({
          moodleUserId: String(OWNER_ID),
          courseId: String(COURSE_ID),
          q: 'photosynthesis',
        })
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('returns nothing when searching a different moodleUserId (scoped correctly)', async () => {
      await seedConversation({
        title: 'Bonding Basics',
        moodleUserId: OWNER_ID,
      });
      const unrelated = await seedConversation({
        title: 'Unrelated Chat',
        moodleUserId: OWNER_ID,
      });
      await seedMessage(unrelated.id, {
        content: 'Can you explain a covalent bond?',
      });

      const res = await request(app.getHttpServer())
        .get('/conversations/search')
        .query({
          moodleUserId: String(OTHER_USER_ID),
          courseId: String(COURSE_ID),
          q: 'bond',
        })
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  describe('DELETE /conversations/:id', () => {
    it('cascades delete to messages in the real database', async () => {
      const conversation = await seedConversation({ title: 'Delete me' });
      const m1 = await seedMessage(conversation.id, { content: 'first' });
      const m2 = await seedMessage(conversation.id, {
        content: 'second',
        role: 'assistant',
      });

      await request(app.getHttpServer())
        .delete(`/conversations/${conversation.id}`)
        .query({ moodleUserId: String(OWNER_ID) })
        .expect(200)
        .expect({ deleted: true });

      expect(await conversationRepo.findOne({ where: { id: conversation.id } })).toBeNull();
      expect(await messageRepo.findOne({ where: { id: m1.id } })).toBeNull();
      expect(await messageRepo.findOne({ where: { id: m2.id } })).toBeNull();
      expect(
        await messageRepo.count({ where: { conversationId: conversation.id } }),
      ).toBe(0);
    });
  });

  describe('ParseUUIDPipe validation', () => {
    it('returns 400 for a non-UUID conversation id', async () => {
      await request(app.getHttpServer())
        .get('/conversations/not-a-valid-uuid/messages')
        .query({ moodleUserId: '1' })
        .expect(400);
    });

    it('returns 404 for a well-formed but nonexistent UUID', async () => {
      const missingId = '550e8400-e29b-41d4-a716-446655440000';

      await request(app.getHttpServer())
        .get(`/conversations/${missingId}/messages`)
        .query({ moodleUserId: String(OWNER_ID) })
        .expect(404);
    });
  });

  describe('ownership at the HTTP layer', () => {
    it('returns 403 when moodleUserId does not own the conversation', async () => {
      const conversation = await seedConversation({
        moodleUserId: OWNER_ID,
        title: 'Owned by user 1',
      });

      await request(app.getHttpServer())
        .get(`/conversations/${conversation.id}`)
        .query({ moodleUserId: String(OTHER_USER_ID) })
        .expect(403);
    });
  });
});
