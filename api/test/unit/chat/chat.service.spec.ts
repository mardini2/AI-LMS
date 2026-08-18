import { NotFoundException } from '@nestjs/common';
import { ChatService } from '../../../src/chat/chat.service';
import { ContextService } from '../../../src/context/context.service';
import { ConversationService } from '../../../src/conversation/conversation.service';
import { Conversation } from '../../../src/conversation/entities/conversation.entity';
import { SendMessageDto } from '../../../src/chat/dto/send-message.dto';
import type { AiProviderRegistry } from '../../../src/chat/providers';
import type { LlmChatRequest } from '../../../src/chat/providers/provider.types';

describe('ChatService.sendMessage', () => {
  let service: ChatService;
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
    setGeneratingStartedAt: jest.Mock;
    findMessage: jest.Mock;
    countUserMessages: jest.Mock;
    updateTopicSuggestions: jest.Mock;
  };
  let chatAttachments: {
    resolveByIds: jest.Mock;
    buildLlmMessage: jest.Mock;
    buildStorageMessage: jest.Mock;
    linkToMessage: jest.Mock;
  };
  let providers: {
    resolve: jest.Mock;
    listProviders: jest.Mock;
    getDefaultProviderId: jest.Mock;
    isStubMode: jest.Mock;
  };

  /** The resolved provider's chat() — the LLM seam ChatService now talks to. */
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

    sendMessage = jest.fn().mockImplementation(async (request: LlmChatRequest) => {
      capturedSystemInstruction = request?.systemInstruction;
      capturedHistory = request?.history;
      return {
        text: 'A covalent bond shares electrons.',
        toolCalls: [],
      };
    });

    providers = {
      resolve: jest.fn(() => ({
        id: 'gemini',
        displayName: 'Google Gemini',
        isConfigured: () => true,
        chat: sendMessage,
        generateJson: jest.fn(),
      })),
      listProviders: jest.fn(() => []),
      getDefaultProviderId: jest.fn(() => 'gemini'),
      isStubMode: jest.fn(() => false),
    };

    chatAttachments = {
      resolveByIds: jest.fn().mockResolvedValue({
        promptBlock: '',
        storagePrefix: '',
        usableFilenames: [] as string[],
        errors: [] as string[],
        attachmentIds: [] as string[],
      }),
      buildLlmMessage: jest.fn((message: string) => message),
      buildStorageMessage: jest.fn((message: string) => message),
      linkToMessage: jest.fn().mockResolvedValue(undefined),
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
      // startMessageTurn destructures the created user message off this result.
      appendMessages: jest.fn(
        async (_conversationId: string, messages: Array<{ role: string }>) =>
          messages.map((message, index) => ({
            id: message.role === 'user' ? 'user-msg-1' : `assistant-msg-${index}`,
            ...message,
          })),
      ),
      setGeneratingStartedAt: jest.fn().mockResolvedValue(undefined),
      findMessage: jest.fn().mockResolvedValue({
        id: 'user-msg-1',
        role: 'user',
        content: 'What is a covalent bond?',
      }),
      countUserMessages: jest.fn().mockResolvedValue(1),
      updateTopicSuggestions: jest.fn().mockResolvedValue([]),
    };

    service = new ChatService(
      providers as unknown as AiProviderRegistry,
      contextService as unknown as ContextService,
      {} as never,
      {} as never,
      conversationService as unknown as ConversationService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { suggestTopics: jest.fn().mockResolvedValue([]) } as never,
      chatAttachments as never,
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
      // Only the start-turn ownership check sees the stale id; the retry after
      // fallback resolves against the newly opened conversation.
      conversationService.assertOwner.mockRejectedValueOnce(
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
      // The start turn has no id to verify; the complete turn checks the opened one.
      expect(conversationService.assertOwner).toHaveBeenCalledWith(
        NEW_CONV_ID,
        42,
      );
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

  // Provider-shaped conversion (Gemini 'model' parts, same-role merging, seeding a
  // leading user turn) now lives in each provider adapter. ChatService only
  // normalizes greetings and hands over role/content pairs.
  describe('provider history normalization', () => {
    it('keeps a leading assistant turn for the provider to reshape', async () => {
      conversationService.getRecentHistory.mockResolvedValue([
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello there' },
      ]);

      await service.sendMessage(baseDto());

      expect(capturedHistory).toEqual([
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello there' },
      ]);
    });

    it('leaves consecutive same-role messages unmerged', async () => {
      conversationService.getRecentHistory.mockResolvedValue([
        { role: 'user', content: 'First question' },
        { role: 'user', content: 'Follow-up' },
        { role: 'assistant', content: 'Answer part 1' },
        { role: 'assistant', content: 'Answer part 2' },
      ]);

      await service.sendMessage(baseDto());

      expect(capturedHistory).toEqual([
        { role: 'user', content: 'First question' },
        { role: 'user', content: 'Follow-up' },
        { role: 'assistant', content: 'Answer part 1' },
        { role: 'assistant', content: 'Answer part 2' },
      ]);
    });

    it('keeps the assistant role instead of mapping it per provider', async () => {
      conversationService.getRecentHistory.mockResolvedValue([
        { role: 'user', content: 'Explain isomerism' },
        { role: 'assistant', content: 'Isomers share a formula…' },
      ]);

      await service.sendMessage(baseDto());

      expect(capturedHistory).toEqual([
        { role: 'user', content: 'Explain isomerism' },
        { role: 'assistant', content: 'Isomers share a formula…' },
      ]);
    });

    it('strips a leading greeting from assistant turns before sending', async () => {
      conversationService.getRecentHistory.mockResolvedValue([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hi Alex, isomers share a formula…' },
      ]);

      await service.sendMessage(baseDto());

      expect(capturedHistory).toEqual([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'isomers share a formula…' },
      ]);
    });
  });

  describe('message persistence', () => {
    it('appends the user message on start and the assistant message on complete', async () => {
      const result = await service.sendMessage(baseDto());

      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'What is a covalent bond?' }),
      );
      expect(conversationService.appendMessages).toHaveBeenCalledTimes(2);
      expect(conversationService.appendMessages).toHaveBeenNthCalledWith(
        1,
        CONV_ID,
        [
          {
            role: 'user',
            content: 'What is a covalent bond?',
            mode: 'direct',
            guidance: null,
          },
        ],
      );
      expect(conversationService.appendMessages).toHaveBeenNthCalledWith(
        2,
        CONV_ID,
        [
          {
            role: 'assistant',
            content: 'A covalent bond shares electrons.',
            mode: 'direct',
            guidance: null,
          },
        ],
      );
      expect(result).toEqual({
        response: 'A covalent bond shares electrons.',
        conversationId: CONV_ID,
        provider: 'gemini',
        mode: 'direct',
      });
    });
  });

  // Persist-first: the user message is saved before the LLM runs, so a failed turn
  // keeps the question in the transcript and only skips the assistant reply.
  describe('error propagation', () => {
    it('propagates context fetch errors and never appends an assistant message', async () => {
      contextService.getContext.mockRejectedValue(
        new Error('Moodle context unavailable'),
      );

      await expect(service.sendMessage(baseDto())).rejects.toThrow(
        'Moodle context unavailable',
      );

      expect(sendMessage).not.toHaveBeenCalled();
      expect(conversationService.appendMessages).toHaveBeenCalledTimes(1);
      expect(conversationService.appendMessages).toHaveBeenCalledWith(CONV_ID, [
        expect.objectContaining({ role: 'user' }),
      ]);
    });

    it('treats a failed context fetch as empty material only when STUB_LLM is on', async () => {
      providers.isStubMode.mockReturnValue(true);
      contextService.getContext.mockRejectedValue(
        new Error('Moodle context unavailable'),
      );

      const result = await service.sendMessage(baseDto());

      expect(sendMessage).toHaveBeenCalled();
      expect(result.response).toBe('A covalent bond shares electrons.');
      expect(conversationService.appendMessages).toHaveBeenCalledTimes(2);
    });

    it('propagates provider chat errors and never appends an assistant message', async () => {
      sendMessage.mockRejectedValue(new Error('Gemini rate limited'));

      await expect(service.sendMessage(baseDto())).rejects.toThrow(
        'Gemini rate limited',
      );

      expect(conversationService.appendMessages).toHaveBeenCalledTimes(1);
      expect(conversationService.appendMessages).not.toHaveBeenCalledWith(
        CONV_ID,
        [expect.objectContaining({ role: 'assistant' })],
      );
    });

    it('clears the generating marker even when the turn fails', async () => {
      sendMessage.mockRejectedValue(new Error('Gemini rate limited'));

      await expect(service.sendMessage(baseDto())).rejects.toThrow(
        'Gemini rate limited',
      );

      expect(conversationService.setGeneratingStartedAt).toHaveBeenCalledWith(
        CONV_ID,
        null,
      );
    });
  });
});
