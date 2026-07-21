jest.mock('@google/generative-ai', () => {
  const getGenerativeModel = jest.fn();
  const GoogleGenerativeAI = jest.fn().mockImplementation(() => ({
    getGenerativeModel,
  }));

  return {
    GoogleGenerativeAI,
    HarmCategory: {
      HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    },
    HarmBlockThreshold: {
      BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE',
    },
    __mocks: { getGenerativeModel },
  };
});

import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ChatService } from './chat.service';
import { ContextService } from '../context/context.service';
import { ConversationService } from '../conversation/conversation.service';
import { Conversation } from '../conversation/entities/conversation.entity';
import { SendMessageDto } from './dto/send-message.dto';

const { __mocks: geminiMocks } = jest.requireMock('@google/generative-ai') as {
  __mocks: { getGenerativeModel: jest.Mock };
};

describe('ChatService.sendMessage', () => {
  let service: ChatService;
  let config: { get: jest.Mock };
  let contextService: {
    getContext: jest.Mock;
    resolveCourseName: jest.Mock;
    getEnrolledCourseNames: jest.Mock;
  };
  let conversationService: {
    assertOwner: jest.Mock;
    findById: jest.Mock;
    openConversation: jest.Mock;
    create: jest.Mock;
    getRecentHistory: jest.Mock;
    appendMessages: jest.Mock;
  };

  let startChat: jest.Mock;
  let sendMessage: jest.Mock;
  let capturedSystemInstruction: string | undefined;
  let capturedHistory: unknown;

  const CONV_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const NEW_CONV_ID = '11111111-2222-3333-4444-555555555555';

  function makeConversation(
    overrides: Partial<Conversation> = {},
  ): Conversation {
    const now = new Date('2026-01-15T12:00:00.000Z');
    return {
      id: overrides.id ?? CONV_ID,
      courseId: overrides.courseId ?? 12,
      moodleUserId: overrides.moodleUserId ?? 42,
      type: overrides.type ?? 'general',
      title: overrides.title ?? 'Main',
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

  function baseDto(overrides: Partial<SendMessageDto> = {}): SendMessageDto {
    return {
      courseId: 12,
      courseName: 'Organic Chemistry',
      moodleUserId: 42,
      userFirstName: 'Alex',
      message: 'What is a covalent bond?',
      conversationId: CONV_ID,
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    capturedSystemInstruction = undefined;
    capturedHistory = undefined;

    sendMessage = jest.fn().mockResolvedValue({
      response: { text: () => 'A covalent bond shares electrons.' },
    });
    startChat = jest.fn().mockImplementation((opts: { history?: unknown }) => {
      capturedHistory = opts?.history;
      return { sendMessage };
    });

    geminiMocks.getGenerativeModel.mockImplementation(
      (opts: { systemInstruction?: string }) => {
        capturedSystemInstruction = opts?.systemInstruction;
        return { startChat };
      },
    );

    config = {
      get: jest.fn((key: string) =>
        key === 'GEMINI_API_KEY' ? 'test-gemini-key' : undefined,
      ),
    };

    contextService = {
      getContext: jest.fn().mockResolvedValue('### Week 1\nBonding basics'),
      resolveCourseName: jest
        .fn()
        .mockResolvedValue('Organic Chemistry'),
      getEnrolledCourseNames: jest
        .fn()
        .mockResolvedValue(['Organic Chemistry', 'Biology 101']),
    };

    const conversation = makeConversation();
    conversationService = {
      assertOwner: jest.fn().mockResolvedValue(conversation),
      findById: jest.fn().mockResolvedValue(conversation),
      openConversation: jest
        .fn()
        .mockResolvedValue(makeConversation({ id: NEW_CONV_ID })),
      create: jest
        .fn()
        .mockResolvedValue(makeConversation({ id: NEW_CONV_ID, moodleUserId: undefined })),
      getRecentHistory: jest.fn().mockResolvedValue([]),
      appendMessages: jest.fn().mockResolvedValue(undefined),
    };

    service = new ChatService(
      config as unknown as ConfigService,
      contextService as unknown as ContextService,
      conversationService as unknown as ConversationService,
    );
  });

  describe('conversation resolution', () => {
    it('checks ownership via assertOwner when conversationId and moodleUserId are present', async () => {
      await service.sendMessage(baseDto());

      expect(conversationService.assertOwner).toHaveBeenCalledWith(
        CONV_ID,
        42,
      );
      expect(conversationService.openConversation).not.toHaveBeenCalled();
      expect(conversationService.create).not.toHaveBeenCalled();
    });

    it('calls findById directly when conversationId is present but moodleUserId is not', async () => {
      await service.sendMessage(
        baseDto({ moodleUserId: undefined, conversationId: CONV_ID }),
      );

      expect(conversationService.assertOwner).not.toHaveBeenCalled();
      // once in the ownership/stale guard, once to load the conversation
      expect(conversationService.findById).toHaveBeenCalledWith(CONV_ID);
      expect(conversationService.findById.mock.calls.length).toBeGreaterThanOrEqual(
        1,
      );
      expect(conversationService.openConversation).not.toHaveBeenCalled();
      expect(conversationService.create).not.toHaveBeenCalled();
    });

    it('falls back when assertOwner throws for a stale conversationId', async () => {
      conversationService.assertOwner.mockRejectedValue(
        new NotFoundException('gone'),
      );
      conversationService.findById.mockImplementation(async (id: string) =>
        makeConversation({ id }),
      );

      const result = await service.sendMessage(baseDto());

      expect(conversationService.openConversation).toHaveBeenCalledWith(
        12,
        42,
        { type: 'general', title: 'Main' },
      );
      expect(conversationService.create).not.toHaveBeenCalled();
      expect(result.conversationId).toBe(NEW_CONV_ID);
    });

    it('falls back when findById throws for a stale conversationId without moodleUserId', async () => {
      conversationService.findById
        .mockRejectedValueOnce(new NotFoundException('gone'))
        .mockResolvedValue(makeConversation({ id: NEW_CONV_ID }));

      const result = await service.sendMessage(
        baseDto({ moodleUserId: undefined, conversationId: CONV_ID }),
      );

      expect(conversationService.create).toHaveBeenCalledWith(12, undefined);
      expect(conversationService.openConversation).not.toHaveBeenCalled();
      expect(result.conversationId).toBe(NEW_CONV_ID);
    });

    it('opens a general conversation when no conversationId and moodleUserId is present', async () => {
      conversationService.findById.mockResolvedValue(
        makeConversation({ id: NEW_CONV_ID }),
      );

      const result = await service.sendMessage(
        baseDto({ conversationId: undefined }),
      );

      expect(conversationService.openConversation).toHaveBeenCalledWith(
        12,
        42,
        { type: 'general', title: 'Main' },
      );
      expect(conversationService.create).not.toHaveBeenCalled();
      expect(conversationService.assertOwner).not.toHaveBeenCalled();
      expect(result.conversationId).toBe(NEW_CONV_ID);
    });

    it('creates a conversation when no conversationId and no moodleUserId', async () => {
      conversationService.findById.mockResolvedValue(
        makeConversation({ id: NEW_CONV_ID }),
      );

      const result = await service.sendMessage(
        baseDto({ conversationId: undefined, moodleUserId: undefined }),
      );

      expect(conversationService.create).toHaveBeenCalledWith(12, undefined);
      expect(conversationService.openConversation).not.toHaveBeenCalled();
      expect(result.conversationId).toBe(NEW_CONV_ID);
    });
  });

  describe('system prompt construction', () => {
    it('includes the student first-name instruction only when userFirstName is provided', async () => {
      await service.sendMessage(baseDto({ userFirstName: '  Jordan  ' }));
      expect(capturedSystemInstruction).toContain(
        "The student's first name is Jordan.",
      );

      await service.sendMessage(baseDto({ userFirstName: undefined }));
      expect(capturedSystemInstruction).not.toContain(
        "The student's first name is",
      );

      await service.sendMessage(baseDto({ userFirstName: '   ' }));
      expect(capturedSystemInstruction).not.toContain(
        "The student's first name is",
      );
    });

    it('includes enrolled courses line only when enrolledCourses is non-empty', async () => {
      contextService.getEnrolledCourseNames.mockResolvedValue([
        'Organic Chemistry',
        'Biology 101',
      ]);
      await service.sendMessage(baseDto());
      expect(capturedSystemInstruction).toContain(
        'The student is enrolled in: Organic Chemistry, Biology 101.',
      );

      contextService.getEnrolledCourseNames.mockResolvedValue([]);
      await service.sendMessage(baseDto());
      expect(capturedSystemInstruction).not.toContain(
        'The student is enrolled in:',
      );

      // no moodleUserId → enrolled courses resolved to [] without calling Moodle helper
      contextService.getEnrolledCourseNames.mockClear();
      await service.sendMessage(baseDto({ moodleUserId: undefined }));
      expect(contextService.getEnrolledCourseNames).not.toHaveBeenCalled();
      expect(capturedSystemInstruction).not.toContain(
        'The student is enrolled in:',
      );
    });

    it('includes course-specific instructions when courseId > 1 and courseName resolves', async () => {
      contextService.resolveCourseName.mockResolvedValue('Organic Chemistry');

      await service.sendMessage(baseDto({ courseId: 12 }));

      expect(capturedSystemInstruction).toContain(
        'The student is currently viewing the course: Organic Chemistry.',
      );
      expect(capturedSystemInstruction).toContain(
        'Use the course material below as your primary source.',
      );
      expect(capturedSystemInstruction).not.toContain(
        'dashboard or site home',
      );
    });

    it('includes dashboard/site-home instruction when courseId <= 1', async () => {
      await service.sendMessage(baseDto({ courseId: 1 }));

      expect(capturedSystemInstruction).toContain(
        'The student is on the dashboard or site home, not a specific course page.',
      );
      expect(capturedSystemInstruction).not.toContain(
        'The student is currently viewing the course:',
      );
    });

    it('includes section-focused instruction for section conversations with a sectionName', async () => {
      conversationService.findById.mockResolvedValue(
        makeConversation({
          type: 'section',
          title: 'Week 1 chat',
          sectionName: 'Week 1',
        }),
      );

      await service.sendMessage(baseDto());

      expect(capturedSystemInstruction).toContain(
        'The active conversation is specifically for the course section: Week 1.',
      );
      expect(capturedSystemInstruction).not.toContain(
        'The active conversation is: Week 1 chat.',
      );
    });

    it('falls back to conversationTitle instruction when type is not section', async () => {
      conversationService.findById.mockResolvedValue(
        makeConversation({
          type: 'manual',
          title: 'My bonding questions',
          sectionName: undefined,
        }),
      );

      await service.sendMessage(baseDto());

      expect(capturedSystemInstruction).toContain(
        'The active conversation is: My bonding questions.',
      );
      expect(capturedSystemInstruction).not.toContain(
        'specifically for the course section',
      );
    });

    it('appends Course Material when present and omits it when absent', async () => {
      contextService.getContext.mockResolvedValue('### Week 1\nBonding basics');
      await service.sendMessage(baseDto());
      expect(capturedSystemInstruction).toContain('Course Material:');
      expect(capturedSystemInstruction).toContain('### Week 1\nBonding basics');

      contextService.getContext.mockResolvedValue('');
      await service.sendMessage(baseDto());
      expect(capturedSystemInstruction).not.toContain('Course Material:');
    });
  });

  describe('Gemini history conversion', () => {
    it('drops a leading assistant-only message so history starts with user', async () => {
      conversationService.getRecentHistory.mockResolvedValue([
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello there' },
      ]);

      await service.sendMessage(baseDto());

      expect(capturedHistory).toEqual([
        { role: 'user', parts: [{ text: 'Hi' }] },
        { role: 'model', parts: [{ text: 'Hello there' }] },
      ]);
    });

    it('merges consecutive same-role messages with newline-joined text', async () => {
      conversationService.getRecentHistory.mockResolvedValue([
        { role: 'user', content: 'First question' },
        { role: 'user', content: 'Follow-up' },
        { role: 'assistant', content: 'Answer part 1' },
        { role: 'assistant', content: 'Answer part 2' },
      ]);

      await service.sendMessage(baseDto());

      expect(capturedHistory).toEqual([
        { role: 'user', parts: [{ text: 'First question\nFollow-up' }] },
        {
          role: 'model',
          parts: [{ text: 'Answer part 1\nAnswer part 2' }],
        },
      ]);
    });

    it("maps assistant role to Gemini 'model' role", async () => {
      conversationService.getRecentHistory.mockResolvedValue([
        { role: 'user', content: 'Explain isomerism' },
        { role: 'assistant', content: 'Isomers share a formula…' },
      ]);

      await service.sendMessage(baseDto());

      expect(capturedHistory).toEqual([
        { role: 'user', parts: [{ text: 'Explain isomerism' }] },
        { role: 'model', parts: [{ text: 'Isomers share a formula…' }] },
      ]);
    });
  });

  describe('message persistence', () => {
    it('appends user then assistant messages only after a successful Gemini response', async () => {
      const result = await service.sendMessage(baseDto());

      expect(sendMessage).toHaveBeenCalledWith('What is a covalent bond?');
      expect(conversationService.appendMessages).toHaveBeenCalledTimes(1);
      expect(conversationService.appendMessages).toHaveBeenCalledWith(
        CONV_ID,
        [
          { role: 'user', content: 'What is a covalent bond?' },
          {
            role: 'assistant',
            content: 'A covalent bond shares electrons.',
          },
        ],
      );
      expect(result).toEqual({
        response: 'A covalent bond shares electrons.',
        conversationId: CONV_ID,
      });
    });
  });

  describe('error propagation', () => {
    it('propagates context fetch errors and never appends messages', async () => {
      contextService.getContext.mockRejectedValue(
        new Error('Moodle context unavailable'),
      );

      await expect(service.sendMessage(baseDto())).rejects.toThrow(
        'Moodle context unavailable',
      );

      expect(sendMessage).not.toHaveBeenCalled();
      expect(conversationService.appendMessages).not.toHaveBeenCalled();
    });

    it('propagates Gemini sendMessage errors and never appends messages', async () => {
      sendMessage.mockRejectedValue(new Error('Gemini rate limited'));

      await expect(service.sendMessage(baseDto())).rejects.toThrow(
        'Gemini rate limited',
      );

      expect(conversationService.appendMessages).not.toHaveBeenCalled();
    });
  });

  it('constructs GoogleGenerativeAI with the configured API key', () => {
    expect(GoogleGenerativeAI).toHaveBeenCalledWith('test-gemini-key');
  });
});
