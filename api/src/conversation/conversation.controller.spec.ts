import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { Conversation } from './entities/conversation.entity';

describe('ConversationController', () => {
  let controller: ConversationController;
  let conversationService: {
    findLatestForUserCourse: jest.Mock;
    getMessagesPage: jest.Mock;
    deleteConversation: jest.Mock;
  };

  const CONV_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const OWNER_ID = 42;
  const COURSE_ID = 7;

  beforeEach(() => {
    conversationService = {
      findLatestForUserCourse: jest.fn(),
      getMessagesPage: jest.fn(),
      deleteConversation: jest.fn().mockResolvedValue(undefined),
    };

    controller = new ConversationController(
      conversationService as unknown as ConversationService,
    );
  });

  describe('findActive', () => {
    it('returns { conversationId } when the service finds a conversation', async () => {
      conversationService.findLatestForUserCourse.mockResolvedValue({
        id: CONV_ID,
      } as Conversation);

      await expect(
        controller.findActive({
          moodleUserId: OWNER_ID,
          courseId: COURSE_ID,
        }),
      ).resolves.toEqual({ conversationId: CONV_ID });

      expect(conversationService.findLatestForUserCourse).toHaveBeenCalledWith(
        OWNER_ID,
        COURSE_ID,
      );
    });

    it('returns { conversationId: null } when the service returns null', async () => {
      conversationService.findLatestForUserCourse.mockResolvedValue(null);

      await expect(
        controller.findActive({
          moodleUserId: OWNER_ID,
          courseId: COURSE_ID,
        }),
      ).resolves.toEqual({ conversationId: null });
    });

    it('returns { conversationId: null } when the service returns undefined', async () => {
      conversationService.findLatestForUserCourse.mockResolvedValue(undefined);

      await expect(
        controller.findActive({
          moodleUserId: OWNER_ID,
          courseId: COURSE_ID,
        }),
      ).resolves.toEqual({ conversationId: null });
    });
  });

  describe('getMessages', () => {
    beforeEach(() => {
      conversationService.getMessagesPage.mockResolvedValue({
        messages: [],
        hasMore: false,
      });
    });

    it('converts query.before ISO string to a Date for getMessagesPage', async () => {
      const before = '2026-01-15T12:00:00.000Z';

      await controller.getMessages(CONV_ID, {
        moodleUserId: OWNER_ID,
        limit: 10,
        before,
      });

      expect(conversationService.getMessagesPage).toHaveBeenCalledWith(
        CONV_ID,
        OWNER_ID,
        10,
        new Date(before),
      );
      const passedBefore =
        conversationService.getMessagesPage.mock.calls[0][3];
      expect(passedBefore).toBeInstanceOf(Date);
      expect(passedBefore.toISOString()).toBe(before);
    });

    it('passes undefined for before when query.before is omitted', async () => {
      await controller.getMessages(CONV_ID, {
        moodleUserId: OWNER_ID,
        limit: 10,
      });

      expect(conversationService.getMessagesPage).toHaveBeenCalledWith(
        CONV_ID,
        OWNER_ID,
        10,
        undefined,
      );
    });

    it('defaults limit to 30 when query.limit is omitted', async () => {
      await controller.getMessages(CONV_ID, {
        moodleUserId: OWNER_ID,
      });

      expect(conversationService.getMessagesPage).toHaveBeenCalledWith(
        CONV_ID,
        OWNER_ID,
        30,
        undefined,
      );
    });
  });

  describe('delete', () => {
    it('calls deleteConversation and returns { deleted: true }', async () => {
      await expect(
        controller.delete(CONV_ID, { moodleUserId: OWNER_ID }),
      ).resolves.toEqual({ deleted: true });

      expect(conversationService.deleteConversation).toHaveBeenCalledWith(
        CONV_ID,
        OWNER_ID,
      );
    });
  });
});
