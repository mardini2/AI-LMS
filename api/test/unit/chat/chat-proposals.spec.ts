import { BadRequestException, Logger } from '@nestjs/common';
import { ChatService } from '../../../src/chat/chat.service';
import type { LlmChatRequest, LlmToolCall } from '../../../src/chat/providers/provider.types';

/**
 * Covers the tool-call half of completeMessageTurn — turning propose_* calls into
 * pending proposals — plus the empty-reply fallbacks, topic refresh, and the
 * attachment guards in startMessageTurn.
 */

type Deps = ReturnType<typeof buildDeps>;

function buildDeps() {
  const chat: jest.Mock = jest.fn(async () => ({
    text: 'Paging maps pages to frames.',
  }));

  return {
    chat,
    providers: {
      resolve: jest.fn(() => ({ id: 'gemini', chat, generateJson: jest.fn() })),
      listProviders: jest.fn(() => []),
      getDefaultProviderId: jest.fn(() => 'gemini'),
      isStubMode: jest.fn(() => false),
    },
    contextService: {
      getContext: jest.fn().mockResolvedValue('### Week 3\nPaging basics'),
      resolveCourseName: jest.fn().mockResolvedValue('Operating Systems'),
      getEnrolledCourseNames: jest.fn().mockResolvedValue(['Operating Systems']),
      resolveSectionsFromScope: jest.fn(),
    },
    practiceQuizMoodle: { createPracticeQuiz: jest.fn() },
    studyGuideMoodle: { createStudyGuide: jest.fn(), createPrivatePage: jest.fn() },
    conversationService: {
      assertOwner: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue({
        id: 'conv-1',
        type: 'general',
        title: 'Main',
        sectionId: 100,
        sectionNumber: 3,
        sectionName: 'Week 3',
        topicSuggestions: null,
      }),
      findMessage: jest.fn().mockResolvedValue({
        id: 'user-msg-1',
        role: 'user',
        content: 'Make me a quiz',
      }),
      countUserMessages: jest.fn().mockResolvedValue(2),
      getRecentHistory: jest.fn().mockResolvedValue([]),
      appendMessages: jest.fn(async (_id: string, rows: Array<{ role: string }>) =>
        rows.map((row, i) => ({ id: `msg-${i}`, ...row })),
      ),
      setGeneratingStartedAt: jest.fn().mockResolvedValue(undefined),
      updateTopicSuggestions: jest.fn(async (_id: string, topics: string[]) => topics),
      openConversation: jest.fn(),
      create: jest.fn(),
    },
    pendingActionService: {
      createPracticeQuizProposal: jest.fn().mockResolvedValue({ id: 'pa-quiz' }),
      createStudyGuideProposal: jest.fn().mockResolvedValue({ id: 'pa-guide' }),
      createFlashcardsProposal: jest.fn().mockResolvedValue({ id: 'pa-cards' }),
    },
    practiceQuizGeneration: { generatePracticeQuestions: jest.fn() },
    practiceQuizReview: { getReviewOffer: jest.fn(), explainWrongAnswers: jest.fn() },
    studyGuideGeneration: { generateStudyGuide: jest.fn() },
    flashcardsGeneration: { generateFlashcards: jest.fn() },
    topicSuggestions: { suggestTopics: jest.fn().mockResolvedValue([]) },
    chatAttachments: {
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
    },
  };
}

function buildService(deps: Deps): ChatService {
  return new ChatService(
    deps.providers as never,
    deps.contextService as never,
    deps.practiceQuizMoodle as never,
    deps.studyGuideMoodle as never,
    deps.conversationService as never,
    deps.pendingActionService as never,
    deps.practiceQuizGeneration as never,
    deps.practiceQuizReview as never,
    deps.studyGuideGeneration as never,
    deps.flashcardsGeneration as never,
    deps.topicSuggestions as never,
    deps.chatAttachments as never,
  );
}

/** Make the provider answer with tool calls (and optionally text). */
function respondWith(
  deps: Deps,
  toolCalls: LlmToolCall[],
  extra: { text?: string; finishReason?: string } = {},
) {
  deps.chat.mockImplementation(async () => ({
    text: extra.text ?? '',
    toolCalls,
    finishReason: extra.finishReason,
  }));
}

function completeDto(overrides: Record<string, unknown> = {}) {
  return {
    courseId: 12,
    moodleUserId: 42,
    conversationId: 'conv-1',
    userMessageId: 'user-msg-1',
    message: 'Make me a quiz on paging',
    ...overrides,
  } as never;
}

describe('ChatService study-tool proposals', () => {
  let deps: Deps;
  let service: ChatService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    deps = buildDeps();
    service = buildService(deps);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('propose_practice_quiz', () => {
    it('stores a proposal seeded with the conversation section and returns it', async () => {
      respondWith(deps, [
        {
          name: 'propose_practice_quiz',
          args: {
            title: 'Quiz: Paging',
            scopeSummary: 'Week 3 material',
            questionCount: 12,
            countSpecifiedByStudent: true,
            difficulty: 'HARD',
          },
        },
      ]);

      const result = await service.completeMessageTurn(completeDto());

      expect(
        deps.pendingActionService.createPracticeQuizProposal,
      ).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        courseId: 12,
        moodleUserId: 42,
        payload: {
          title: 'Paging',
          scopeSummary: 'Week 3 material',
          questionCount: 12,
          difficulty: 'hard',
          sectionId: 100,
          sectionNumber: 3,
          sectionName: 'Week 3',
        },
      });
      expect(result.pendingAction).toEqual({
        id: 'pa-quiz',
        type: 'practice_quiz',
        title: 'Paging',
        questionCount: 12,
        difficulty: 'hard',
        scopeSummary: 'Week 3 material',
      });
      expect(result.response).toContain('I can create a **private practice quiz**');
      expect(result.response).toContain('- **12 questions**');
      expect(result.response).toContain('Difficulty: **Hard**');
      expect(result.response).toContain('Nothing will be created until you press');
    });

    it('clamps an explicit over-max count and explains the cap', async () => {
      respondWith(deps, [
        {
          name: 'propose_practice_quiz',
          args: {
            title: 'Paging',
            scopeSummary: 'Week 3',
            questionCount: 50,
            countSpecifiedByStudent: true,
          },
        },
      ]);

      const result = await service.completeMessageTurn(completeDto());

      expect(result.pendingAction?.questionCount).toBe(40);
      expect(result.response).toContain('You asked for **50** questions');
      expect(result.response).toContain('This plan uses 40.');
    });

    it('clamps a model-chosen count to the auto maximum without an apology', async () => {
      respondWith(deps, [
        {
          name: 'propose_practice_quiz',
          args: { title: 'Paging', scopeSummary: 'Week 3', questionCount: 30 },
        },
      ]);

      const result = await service.completeMessageTurn(completeDto());

      expect(result.pendingAction?.questionCount).toBe(15);
      expect(result.response).not.toContain('You asked for');
    });

    it('falls back to a default count when the model sends a non-number', async () => {
      respondWith(deps, [
        {
          name: 'propose_practice_quiz',
          args: { title: 'Paging', scopeSummary: 'Week 3', questionCount: 'lots' },
        },
      ]);

      const result = await service.completeMessageTurn(completeDto());

      expect(result.pendingAction?.questionCount).toBe(10);
    });

    it('substitutes default title, scope, and difficulty for empty args', async () => {
      respondWith(deps, [{ name: 'propose_practice_quiz', args: {} }]);

      const result = await service.completeMessageTurn(completeDto());

      expect(result.pendingAction).toEqual(
        expect.objectContaining({
          title: 'Practice topics',
          scopeSummary: 'Course material from the current conversation',
          difficulty: 'medium',
        }),
      );
    });
  });

  describe('propose_study_guide', () => {
    it('stores a study guide proposal and describes it', async () => {
      respondWith(deps, [
        {
          name: 'propose_study_guide',
          args: { title: 'Study Guide: Paging', scopeSummary: 'Week 3 material' },
        },
      ]);

      const result = await service.completeMessageTurn(completeDto());

      expect(deps.pendingActionService.createStudyGuideProposal).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        courseId: 12,
        moodleUserId: 42,
        payload: {
          title: 'Paging',
          scopeSummary: 'Week 3 material',
          sectionId: 100,
          sectionNumber: 3,
          sectionName: 'Week 3',
        },
      });
      expect(result.pendingAction).toEqual({
        id: 'pa-guide',
        type: 'study_guide',
        title: 'Paging',
        scopeSummary: 'Week 3 material',
      });
      expect(result.pendingAction).not.toHaveProperty('questionCount');
      expect(
        deps.pendingActionService.createPracticeQuizProposal,
      ).not.toHaveBeenCalled();
    });

    it('defaults an untitled study guide to Course review', async () => {
      respondWith(deps, [{ name: 'propose_study_guide', args: { title: '   ' } }]);

      const result = await service.completeMessageTurn(completeDto());

      expect(result.pendingAction?.title).toBe('Course review');
    });
  });

  describe('propose_flashcards', () => {
    it('stores a flashcards proposal with a clamped card count', async () => {
      respondWith(deps, [
        {
          name: 'propose_flashcards',
          args: {
            title: 'Flashcards: Paging',
            scopeSummary: 'Week 3 material',
            cardCount: 200,
            countSpecifiedByStudent: true,
          },
        },
      ]);

      const result = await service.completeMessageTurn(completeDto());

      expect(deps.pendingActionService.createFlashcardsProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ title: 'Paging', cardCount: 40 }),
        }),
      );
      expect(result.pendingAction).toEqual({
        id: 'pa-cards',
        type: 'flashcards',
        title: 'Paging',
        cardCount: 40,
        scopeSummary: 'Week 3 material',
      });
      expect(result.response).toContain('You asked for **200**');
    });

    it('defaults an untitled deck to Key terms with an auto count', async () => {
      respondWith(deps, [{ name: 'propose_flashcards', args: {} }]);

      const result = await service.completeMessageTurn(completeDto());

      expect(result.pendingAction?.title).toBe('Key terms');
      expect(result.pendingAction?.cardCount).toBe(15);
    });
  });

  describe('proposals require a signed-in student in a real course', () => {
    it('ignores a proposal tool call on the dashboard', async () => {
      respondWith(
        deps,
        [{ name: 'propose_practice_quiz', args: { title: 'Paging' } }],
        { text: 'Here is an explanation instead.' },
      );

      const result = await service.completeMessageTurn(
        completeDto({ courseId: 1 }),
      );

      expect(
        deps.pendingActionService.createPracticeQuizProposal,
      ).not.toHaveBeenCalled();
      expect(result.pendingAction).toBeUndefined();
      expect(result.response).toBe('Here is an explanation instead.');
    });

    it('ignores a proposal tool call for an anonymous visitor', async () => {
      respondWith(
        deps,
        [{ name: 'propose_study_guide', args: { title: 'Paging' } }],
        { text: 'Anonymous answer.' },
      );

      const result = await service.completeMessageTurn(
        completeDto({ moodleUserId: undefined }),
      );

      expect(deps.pendingActionService.createStudyGuideProposal).not.toHaveBeenCalled();
      expect(result.response).toBe('Anonymous answer.');
    });
  });

  describe('tool exposure', () => {
    it('offers the study proposal tools when the course has material', async () => {
      await service.completeMessageTurn(completeDto());

      const [request] = deps.chat.mock.calls[0] as unknown as [LlmChatRequest];
      expect((request.tools ?? []).map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'propose_practice_quiz',
          'propose_study_guide',
          'propose_flashcards',
        ]),
      );
    });

    it('offers no tools when there is no course material to ground them', async () => {
      deps.contextService.getContext.mockResolvedValue('');

      await service.completeMessageTurn(completeDto());

      const [request] = deps.chat.mock.calls[0] as unknown as [LlmChatRequest];
      expect(request.tools).toBeUndefined();
    });
  });

  describe('empty provider replies', () => {
    it('substitutes a retry message when the model returns nothing', async () => {
      respondWith(deps, [], { text: '   ' });

      const result = await service.completeMessageTurn(completeDto());

      expect(result.response).toBe(
        'I could not generate a reply just now. Please try again, or paste a specific article URL if you want me to read a page.',
      );
      expect(deps.conversationService.appendMessages).toHaveBeenCalledWith('conv-1', [
        expect.objectContaining({ role: 'assistant', content: result.response }),
      ]);
    });

    it('uses a shorter apology when the model stopped for safety', async () => {
      respondWith(deps, [], { text: '', finishReason: 'SAFETY' });

      const result = await service.completeMessageTurn(completeDto());

      expect(result.response).toBe(
        "I couldn't complete that reply. Please ask again.",
      );
    });
  });

  describe('topic suggestions', () => {
    it('persists freshly generated topics and returns them', async () => {
      deps.topicSuggestions.suggestTopics.mockResolvedValue([
        'Paging',
        'Segmentation',
      ]);

      const result = await service.completeMessageTurn(completeDto());

      expect(deps.conversationService.updateTopicSuggestions).toHaveBeenCalledWith(
        'conv-1',
        ['Paging', 'Segmentation'],
      );
      expect(result.topicSuggestions).toEqual(['Paging', 'Segmentation']);
    });

    it('keeps the stored topics, deduped and capped at three, when none are generated', async () => {
      deps.conversationService.findById.mockResolvedValue({
        id: 'conv-1',
        type: 'general',
        title: 'Main',
        topicSuggestions: [
          '  Paging   basics ',
          'paging basics',
          'Frames',
          'TLB',
          'Swapping',
        ],
      });

      const result = await service.completeMessageTurn(completeDto());

      expect(result.topicSuggestions).toEqual(['Paging basics', 'Frames', 'TLB']);
      expect(deps.conversationService.updateTopicSuggestions).not.toHaveBeenCalled();
    });

    it('skips topic generation on the dashboard', async () => {
      await service.completeMessageTurn(completeDto({ courseId: 1 }));

      expect(deps.topicSuggestions.suggestTopics).not.toHaveBeenCalled();
    });
  });

  describe('startMessageTurn guards', () => {
    it('requires sign-in before accepting attachments', async () => {
      await expect(
        service.startMessageTurn({
          courseId: 12,
          conversationId: 'conv-1',
          message: 'Look at this',
          attachmentIds: ['att-1'],
        } as never),
      ).rejects.toThrow('Signing in is required to use file attachments.');
      expect(deps.conversationService.appendMessages).not.toHaveBeenCalled();
    });

    it('rejects a message with no text and no attachments', async () => {
      await expect(
        service.startMessageTurn({
          courseId: 12,
          moodleUserId: 42,
          conversationId: 'conv-1',
          message: '   ',
        } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.startMessageTurn({
          courseId: 12,
          moodleUserId: 42,
          conversationId: 'conv-1',
          message: '   ',
        } as never),
      ).rejects.toThrow('Message cannot be empty.');
    });

    it('surfaces the first upload error when no attachment could be read', async () => {
      deps.chatAttachments.resolveByIds.mockResolvedValue({
        promptBlock: '',
        storagePrefix: '',
        usableFilenames: [],
        errors: ['notes.zip is not a supported file type.'],
        attachmentIds: [],
      });

      await expect(
        service.startMessageTurn({
          courseId: 12,
          moodleUserId: 42,
          conversationId: 'conv-1',
          message: '',
          attachmentIds: ['att-1'],
        } as never),
      ).rejects.toThrow('notes.zip is not a supported file type.');
    });

    it('links readable attachments to the persisted user message', async () => {
      deps.chatAttachments.resolveByIds.mockResolvedValue({
        promptBlock: '--- notes.pdf ---',
        storagePrefix: '[notes.pdf]',
        usableFilenames: ['notes.pdf'],
        errors: [],
        attachmentIds: ['att-1'],
      });
      deps.chatAttachments.buildStorageMessage.mockReturnValue('[notes.pdf] Summarize');

      const started = await service.startMessageTurn({
        courseId: 12,
        moodleUserId: 42,
        conversationId: 'conv-1',
        message: 'Summarize',
        attachmentIds: ['att-1'],
      } as never);

      expect(deps.conversationService.appendMessages).toHaveBeenCalledWith('conv-1', [
        expect.objectContaining({
          role: 'user',
          content: '[notes.pdf] Summarize',
        }),
      ]);
      expect(deps.chatAttachments.linkToMessage).toHaveBeenCalledWith(
        ['att-1'],
        'msg-0',
        'conv-1',
        42,
      );
      expect(started.generatingStartedAt).toEqual(expect.any(String));
      expect(deps.conversationService.setGeneratingStartedAt).toHaveBeenCalledWith(
        'conv-1',
        expect.any(Date),
      );
    });

    it('reports non-fatal upload warnings alongside a usable message', async () => {
      deps.chatAttachments.resolveByIds.mockResolvedValue({
        promptBlock: '--- notes.pdf ---',
        storagePrefix: '',
        usableFilenames: ['notes.pdf'],
        errors: ['big.pdf was too large to read.'],
        attachmentIds: ['att-1'],
      });

      const started = await service.startMessageTurn({
        courseId: 12,
        moodleUserId: 42,
        conversationId: 'conv-1',
        message: 'Summarize',
        attachmentIds: ['att-1', 'att-2'],
      } as never);

      expect(started.attachmentWarnings).toEqual([
        'big.pdf was too large to read.',
      ]);
    });
  });

  describe('completeMessageTurn guards', () => {
    it('refuses to answer a message id that is not a user turn', async () => {
      deps.conversationService.findMessage.mockResolvedValue({
        id: 'asst-1',
        role: 'assistant',
        content: 'hi',
      });

      await expect(service.completeMessageTurn(completeDto())).rejects.toThrow(
        'userMessageId must refer to a user message.',
      );
      expect(deps.chat).not.toHaveBeenCalled();
    });

    it('clears the generating marker even when the message id is rejected', async () => {
      deps.conversationService.findMessage.mockResolvedValue({
        id: 'asst-1',
        role: 'assistant',
        content: 'hi',
      });

      await expect(service.completeMessageTurn(completeDto())).rejects.toThrow(
        BadRequestException,
      );
      expect(deps.conversationService.setGeneratingStartedAt).toHaveBeenCalledWith(
        'conv-1',
        null,
      );
    });

    it('requires sign-in before using attachments on the completing half', async () => {
      await expect(
        service.completeMessageTurn(
          completeDto({ moodleUserId: undefined, attachmentIds: ['att-1'] }),
        ),
      ).rejects.toThrow('Signing in is required to use file attachments.');
    });
  });

  describe('coach mode', () => {
    it('records the coach mode and clamped guidance on both stored turns', async () => {
      const result = await service.completeMessageTurn(
        completeDto({ mode: 'coach', guidance: 9 }),
      );

      expect(result.mode).toBe('coach');
      expect(result.guidance).toBe(5);
      expect(deps.conversationService.appendMessages).toHaveBeenCalledWith('conv-1', [
        expect.objectContaining({ mode: 'coach', guidance: 5 }),
      ]);
    });

    it('floors guidance at 1 and ignores it outside coach mode', async () => {
      const coached = await service.completeMessageTurn(
        completeDto({ mode: 'coach', guidance: -4 }),
      );
      expect(coached.guidance).toBe(1);

      const direct = await service.completeMessageTurn(
        completeDto({ mode: 'direct', guidance: 4 }),
      );
      expect(direct.mode).toBe('direct');
      expect(direct.guidance).toBeUndefined();
    });
  });
});
