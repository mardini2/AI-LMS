import { BadRequestException, Logger } from '@nestjs/common';
import { ChatService } from '../../../src/chat/chat.service';
import type { PendingAction } from '../../../src/chat/entities/pending-action.entity';

/**
 * Covers the confirm/cancel half of ChatService: turning a pending proposal into
 * real Moodle content, the edit-on-confirm path, and the pending/review lookups.
 */

type Deps = ReturnType<typeof buildDeps>;

function buildDeps() {
  return {
    providers: {
      resolve: jest.fn(() => ({ id: 'gemini', chat: jest.fn(), generateJson: jest.fn() })),
      listProviders: jest.fn(() => [
        { id: 'gemini', displayName: 'Google Gemini', configured: true },
        { id: 'anthropic', displayName: 'Anthropic Claude', configured: false },
      ]),
      getDefaultProviderId: jest.fn(() => 'gemini'),
      isStubMode: jest.fn(() => false),
    },
    contextService: {
      resolveSectionsFromScope: jest.fn().mockResolvedValue({
        sectionIds: [],
        sectionNumbers: [],
      }),
      getContext: jest.fn().mockResolvedValue('### Week 3\nPaging maps pages to frames.'),
      resolveCourseName: jest.fn(),
      getEnrolledCourseNames: jest.fn(),
    },
    practiceQuizMoodle: {
      createPracticeQuiz: jest.fn().mockResolvedValue({
        quizId: 55,
        cmId: 501,
        name: 'Quiz: Paging',
        viewUrl: 'https://moodle.test/mod/quiz/view.php?id=501',
      }),
    },
    studyGuideMoodle: {
      createStudyGuide: jest.fn().mockResolvedValue({
        pageId: 77,
        cmId: 701,
        name: 'Study Guide: Paging',
        viewUrl: 'https://moodle.test/mod/page/view.php?id=701',
      }),
      createPrivatePage: jest.fn().mockResolvedValue({
        pageId: 88,
        cmId: 801,
        name: 'Flashcards: Paging',
        viewUrl: 'https://moodle.test/mod/page/view.php?id=801',
      }),
    },
    conversationService: {
      appendMessages: jest.fn().mockResolvedValue([{ id: 'msg-1', role: 'assistant' }]),
      assertOwner: jest.fn().mockResolvedValue(undefined),
    },
    pendingActionService: {
      assertPendingOwned: jest.fn(),
      updatePendingPayload: jest.fn(),
      markConfirmedWithQuiz: jest.fn().mockResolvedValue(undefined),
      markConfirmedWithPage: jest.fn().mockResolvedValue(undefined),
      markCancelled: jest.fn().mockResolvedValue(undefined),
      getPendingForConversation: jest.fn().mockResolvedValue(null),
    },
    practiceQuizGeneration: {
      generatePracticeQuestions: jest.fn().mockResolvedValue([
        { type: 'multichoice', name: 'Q1', questiontext: 'What is paging?', answers: [] },
        { type: 'truefalse', name: 'Q2', questiontext: 'Paging uses frames.', answers: [] },
      ]),
    },
    practiceQuizReview: {
      getReviewOffer: jest.fn(),
      explainWrongAnswers: jest.fn(),
    },
    studyGuideGeneration: {
      generateStudyGuide: jest.fn().mockResolvedValue({
        document: {
          title: 'Paging Deep Dive',
          sections: [{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }],
        },
        html: '<h2>A</h2>',
      }),
    },
    flashcardsGeneration: {
      generateFlashcards: jest.fn().mockResolvedValue({
        document: {
          title: 'Paging Terms',
          cards: [
            { front: 'Page', back: 'Fixed-size block' },
            { front: 'Frame', back: 'Physical slot' },
          ],
        },
        html: '<details>Page</details>',
      }),
    },
    topicSuggestions: { suggestTopics: jest.fn().mockResolvedValue([]) },
    chatAttachments: {
      resolveByIds: jest.fn(),
      buildLlmMessage: jest.fn(),
      buildStorageMessage: jest.fn(),
      linkToMessage: jest.fn(),
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

const USER_ID = 42;
const CONV_ID = 'conv-1';

function quizAction(overrides: Record<string, unknown> = {}): PendingAction {
  return {
    id: 'action-quiz',
    conversationId: CONV_ID,
    courseId: 12,
    moodleUserId: USER_ID,
    type: 'practice_quiz',
    status: 'pending',
    payload: {
      title: 'Paging',
      scopeSummary: 'Week 3 material',
      questionCount: 8,
      difficulty: 'hard',
      sectionId: 100,
      sectionNumber: 3,
      sectionName: 'Week 3',
    },
    ...overrides,
  } as unknown as PendingAction;
}

function guideAction(overrides: Record<string, unknown> = {}): PendingAction {
  return {
    id: 'action-guide',
    conversationId: CONV_ID,
    courseId: 12,
    moodleUserId: USER_ID,
    type: 'study_guide',
    status: 'pending',
    payload: {
      title: 'Paging',
      scopeSummary: 'Week 3 material',
      sectionNumber: 3,
      sectionName: 'Week 3',
    },
    ...overrides,
  } as unknown as PendingAction;
}

function flashcardsAction(overrides: Record<string, unknown> = {}): PendingAction {
  return {
    id: 'action-cards',
    conversationId: CONV_ID,
    courseId: 12,
    moodleUserId: USER_ID,
    type: 'flashcards',
    status: 'pending',
    payload: {
      title: 'Paging',
      scopeSummary: 'Week 3 material',
      cardCount: 12,
      sectionNumber: 3,
      sectionName: 'Week 3',
    },
    ...overrides,
  } as unknown as PendingAction;
}

describe('ChatService content actions', () => {
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

  describe('listProviders', () => {
    it('reports the registry list alongside the default provider id', () => {
      expect(service.listProviders()).toEqual({
        providers: [
          { id: 'gemini', displayName: 'Google Gemini', configured: true },
          { id: 'anthropic', displayName: 'Anthropic Claude', configured: false },
        ],
        defaultProviderId: 'gemini',
      });
    });
  });

  describe('confirmAction: practice quiz', () => {
    beforeEach(() => {
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(quizAction());
    });

    it('generates questions from scoped material and creates the Moodle quiz', async () => {
      deps.contextService.resolveSectionsFromScope.mockResolvedValue({
        sectionIds: [100],
        sectionNumbers: [3],
      });

      const result = await service.confirmAction('action-quiz', USER_ID);

      expect(deps.contextService.resolveSectionsFromScope).toHaveBeenCalledWith(
        12,
        'Week 3 material',
        { sectionId: 100, sectionNumber: 3, sectionName: 'Week 3' },
      );
      // Resolved sections become a hard scope so questions can't drift off-week.
      expect(deps.contextService.getContext).toHaveBeenCalledWith(
        12,
        'Paging Week 3 material',
        { sectionIds: [100], sectionNumbers: [3], hardSectionScope: true },
      );
      expect(
        deps.practiceQuizGeneration.generatePracticeQuestions,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Paging',
          scopeSummary: 'Week 3 material',
          questionCount: 8,
          difficulty: 'hard',
        }),
        expect.objectContaining({ id: 'gemini' }),
      );
      expect(deps.practiceQuizMoodle.createPracticeQuiz).toHaveBeenCalledWith(
        expect.objectContaining({
          courseId: 12,
          moodleUserId: USER_ID,
          name: 'Quiz: Paging',
          questions: expect.arrayContaining([
            expect.objectContaining({ name: 'Q1' }),
          ]),
        }),
      );
      expect(deps.pendingActionService.markConfirmedWithQuiz).toHaveBeenCalledWith(
        'action-quiz',
        {
          quizId: 55,
          cmId: 501,
          viewUrl: 'https://moodle.test/mod/quiz/view.php?id=501',
          sectionIds: [100],
          sectionNumbers: [3],
        },
      );
      expect(result.quizUrl).toBe('https://moodle.test/mod/quiz/view.php?id=501');
      expect(result.provider).toBe('gemini');
      expect(result.conversationId).toBe(CONV_ID);
    });

    it('summarizes the created quiz and persists that same text as the reply', async () => {
      const result = await service.confirmAction('action-quiz', USER_ID);

      expect(result.response).toContain('Your practice quiz **Quiz: Paging** is ready.');
      expect(result.response).toContain('- 2 questions (multiple choice and true/false)');
      expect(result.response).toContain('- Difficulty: **Hard**');
      expect(result.response).toContain('does not count toward your course grade');
      expect(result.response).toContain(
        '[Open practice quiz](https://moodle.test/mod/quiz/view.php?id=501)',
      );
      expect(deps.conversationService.appendMessages).toHaveBeenCalledWith(CONV_ID, [
        { role: 'assistant', content: result.response },
      ]);
    });

    it('refuses when the scope names weeks the course does not have', async () => {
      deps.contextService.resolveSectionsFromScope.mockResolvedValue({
        sectionIds: [],
        sectionNumbers: [],
        unresolvedSpecificScope: true,
      });

      await expect(service.confirmAction('action-quiz', USER_ID)).rejects.toThrow(
        /Could not match "Week 3 material" to course week\/section names/,
      );
      await expect(
        service.confirmAction('action-quiz', USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(deps.contextService.getContext).not.toHaveBeenCalled();
      expect(deps.practiceQuizMoodle.createPracticeQuiz).not.toHaveBeenCalled();
    });

    it('blames the requested sections when scoped material comes back empty', async () => {
      deps.contextService.resolveSectionsFromScope.mockResolvedValue({
        sectionIds: [100],
        sectionNumbers: [3],
      });
      deps.contextService.getContext.mockResolvedValue('   \n  ');

      await expect(service.confirmAction('action-quiz', USER_ID)).rejects.toThrow(
        'No course material found in the requested weeks/sections to generate quiz questions',
      );
      expect(
        deps.practiceQuizGeneration.generatePracticeQuestions,
      ).not.toHaveBeenCalled();
    });

    it('reports a course-wide shortage when nothing was section-scoped', async () => {
      deps.contextService.getContext.mockResolvedValue('');

      await expect(service.confirmAction('action-quiz', USER_ID)).rejects.toThrow(
        'No course material available to generate quiz questions',
      );
    });
  });

  describe('confirmAction: study guide', () => {
    beforeEach(() => {
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(guideAction());
    });

    it('creates a Moodle page using the generated document title', async () => {
      const result = await service.confirmAction('action-guide', USER_ID);

      expect(deps.studyGuideMoodle.createStudyGuide).toHaveBeenCalledWith(
        expect.objectContaining({
          courseId: 12,
          moodleUserId: USER_ID,
          name: 'Study Guide: Paging Deep Dive',
          contentHtml: '<h2>A</h2>',
        }),
      );
      expect(deps.pendingActionService.markConfirmedWithPage).toHaveBeenCalledWith(
        'action-guide',
        expect.objectContaining({ pageId: 77, cmId: 701 }),
      );
      expect(result.response).toContain('- 3 sections of study notes');
      expect(result.studyGuideUrl).toBe(
        'https://moodle.test/mod/page/view.php?id=701',
      );
      expect(result.quizUrl).toBeUndefined();
    });

    it('falls back to the proposal title when the model returns no title', async () => {
      deps.studyGuideGeneration.generateStudyGuide.mockResolvedValue({
        document: { title: '', sections: [{ heading: 'A' }] },
        html: '<h2>A</h2>',
      });

      await service.confirmAction('action-guide', USER_ID);

      expect(deps.studyGuideMoodle.createStudyGuide).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Study Guide: Paging' }),
      );
    });

    it('suggests a general topic guide when the scope cannot be matched', async () => {
      deps.contextService.resolveSectionsFromScope.mockResolvedValue({
        sectionIds: [],
        sectionNumbers: [],
        unresolvedSpecificScope: true,
      });

      await expect(service.confirmAction('action-guide', USER_ID)).rejects.toThrow(
        /ask for a general topic study guide/,
      );
    });

    it('refuses to generate a guide with no material', async () => {
      deps.contextService.getContext.mockResolvedValue('');

      await expect(service.confirmAction('action-guide', USER_ID)).rejects.toThrow(
        'No course material available to generate a study guide',
      );
      expect(deps.studyGuideGeneration.generateStudyGuide).not.toHaveBeenCalled();
    });
  });

  describe('confirmAction: flashcards', () => {
    beforeEach(() => {
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(
        flashcardsAction(),
      );
    });

    it('creates a private page rather than a study-guide page', async () => {
      const result = await service.confirmAction('action-cards', USER_ID);

      expect(deps.flashcardsGeneration.generateFlashcards).toHaveBeenCalledWith(
        expect.objectContaining({ cardCount: 12, title: 'Paging' }),
        expect.objectContaining({ id: 'gemini' }),
      );
      expect(deps.studyGuideMoodle.createPrivatePage).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Flashcards: Paging Terms' }),
      );
      expect(deps.studyGuideMoodle.createStudyGuide).not.toHaveBeenCalled();
      expect(result.response).toContain('- 2 cards (expand to reveal answers)');
      expect(result.flashcardsUrl).toBe(
        'https://moodle.test/mod/page/view.php?id=801',
      );
    });

    it('refuses to generate cards with no material', async () => {
      deps.contextService.getContext.mockResolvedValue('');

      await expect(service.confirmAction('action-cards', USER_ID)).rejects.toThrow(
        'No course material available to generate flashcards',
      );
    });

    it('suggests a general topic deck when the scope cannot be matched', async () => {
      deps.contextService.resolveSectionsFromScope.mockResolvedValue({
        sectionIds: [],
        sectionNumbers: [],
        unresolvedSpecificScope: true,
      });

      await expect(service.confirmAction('action-cards', USER_ID)).rejects.toThrow(
        /ask for a general topic flashcard set/,
      );
      expect(deps.studyGuideMoodle.createPrivatePage).not.toHaveBeenCalled();
    });

    it('scopes card material to the resolved sections', async () => {
      deps.contextService.resolveSectionsFromScope.mockResolvedValue({
        sectionIds: [100],
        sectionNumbers: [3],
      });

      await service.confirmAction('action-cards', USER_ID);

      expect(deps.contextService.getContext).toHaveBeenCalledWith(
        12,
        'Paging Week 3 material',
        { sectionIds: [100], sectionNumbers: [3], hardSectionScope: true },
      );
    });
  });

  describe('confirmAction: edits applied before generating', () => {
    it('leaves the stored payload alone when no edits are supplied', async () => {
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(quizAction());

      await service.confirmAction('action-quiz', USER_ID);

      expect(deps.pendingActionService.updatePendingPayload).not.toHaveBeenCalled();
    });

    it('strips URLs and kind labels out of an edited title', async () => {
      const action = quizAction();
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(action);
      deps.pendingActionService.updatePendingPayload.mockImplementation(
        async (_id: string, payload: Record<string, unknown>) =>
          ({ ...action, payload }) as unknown as PendingAction,
      );

      await service.confirmAction('action-quiz', USER_ID, {
        title: 'Practice Quiz: Paging https://evil.test/x',
      });

      expect(deps.pendingActionService.updatePendingPayload).toHaveBeenCalledWith(
        'action-quiz',
        expect.objectContaining({ title: 'Paging' }),
      );
      // The edited payload, not the original, drives generation.
      expect(deps.practiceQuizMoodle.createPracticeQuiz).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Quiz: Paging' }),
      );
    });

    it('rejects a title that is empty once sanitized', async () => {
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(quizAction());

      await expect(
        service.confirmAction('action-quiz', USER_ID, {
          title: 'https://only-a-link.test',
        }),
      ).rejects.toThrow('Title cannot be empty');
      expect(deps.pendingActionService.updatePendingPayload).not.toHaveBeenCalled();
    });

    it('caps an edited title at 200 characters', async () => {
      const action = quizAction();
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(action);
      deps.pendingActionService.updatePendingPayload.mockImplementation(
        async (_id: string, payload: Record<string, unknown>) =>
          ({ ...action, payload }) as unknown as PendingAction,
      );

      await service.confirmAction('action-quiz', USER_ID, {
        title: 'x'.repeat(250),
      });

      const [, payload] =
        deps.pendingActionService.updatePendingPayload.mock.calls[0];
      expect((payload as { title: string }).title).toHaveLength(200);
    });

    it('clamps an edited quiz count to the explicit maximum', async () => {
      const action = quizAction();
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(action);
      deps.pendingActionService.updatePendingPayload.mockImplementation(
        async (_id: string, payload: Record<string, unknown>) =>
          ({ ...action, payload }) as unknown as PendingAction,
      );

      await service.confirmAction('action-quiz', USER_ID, { count: 500 });

      expect(deps.pendingActionService.updatePendingPayload).toHaveBeenCalledWith(
        'action-quiz',
        expect.objectContaining({ questionCount: 40 }),
      );
    });

    it('clamps an edited flashcard count to the explicit maximum', async () => {
      const action = flashcardsAction();
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(action);
      deps.pendingActionService.updatePendingPayload.mockImplementation(
        async (_id: string, payload: Record<string, unknown>) =>
          ({ ...action, payload }) as unknown as PendingAction,
      );

      await service.confirmAction('action-cards', USER_ID, { count: 999 });

      expect(deps.pendingActionService.updatePendingPayload).toHaveBeenCalledWith(
        'action-cards',
        expect.objectContaining({ cardCount: 40 }),
      );
    });

    it('ignores a count edit on a study guide', async () => {
      const action = guideAction();
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(action);
      deps.pendingActionService.updatePendingPayload.mockImplementation(
        async (_id: string, payload: Record<string, unknown>) =>
          ({ ...action, payload }) as unknown as PendingAction,
      );

      await service.confirmAction('action-guide', USER_ID, { count: 25 });

      const [, payload] =
        deps.pendingActionService.updatePendingPayload.mock.calls[0];
      expect(payload).not.toHaveProperty('questionCount');
      expect(payload).not.toHaveProperty('cardCount');
    });

    it('normalizes an edited difficulty and falls back on nonsense', async () => {
      const action = quizAction();
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(action);
      deps.pendingActionService.updatePendingPayload.mockImplementation(
        async (_id: string, payload: Record<string, unknown>) =>
          ({ ...action, payload }) as unknown as PendingAction,
      );

      await service.confirmAction('action-quiz', USER_ID, {
        difficulty: '  EXPERT ',
      });
      expect(deps.pendingActionService.updatePendingPayload).toHaveBeenLastCalledWith(
        'action-quiz',
        expect.objectContaining({ difficulty: 'expert' }),
      );

      await service.confirmAction('action-quiz', USER_ID, {
        difficulty: 'impossible',
      });
      expect(deps.pendingActionService.updatePendingPayload).toHaveBeenLastCalledWith(
        'action-quiz',
        expect.objectContaining({ difficulty: 'medium' }),
      );
    });

    it('ignores a difficulty edit on flashcards', async () => {
      const action = flashcardsAction();
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(action);
      deps.pendingActionService.updatePendingPayload.mockImplementation(
        async (_id: string, payload: Record<string, unknown>) =>
          ({ ...action, payload }) as unknown as PendingAction,
      );

      await service.confirmAction('action-cards', USER_ID, { difficulty: 'hard' });

      const [, payload] =
        deps.pendingActionService.updatePendingPayload.mock.calls[0];
      expect(payload).not.toHaveProperty('difficulty');
    });
  });

  describe('confirmAction: unknown type', () => {
    it('rejects an action type it cannot build', async () => {
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(
        quizAction({ type: 'mystery' }),
      );

      await expect(service.confirmAction('action-quiz', USER_ID)).rejects.toThrow(
        'Unsupported action type',
      );
    });
  });

  describe('cancelAction', () => {
    it('marks the action cancelled and records a quiz-specific reply', async () => {
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(quizAction());

      const result = await service.cancelAction('action-quiz', USER_ID);

      expect(deps.pendingActionService.markCancelled).toHaveBeenCalledWith(
        'action-quiz',
      );
      expect(result.response).toBe(
        'Okay — I cancelled that practice quiz. Nothing was created in Moodle.',
      );
      expect(result.conversationId).toBe(CONV_ID);
      expect(deps.conversationService.appendMessages).toHaveBeenCalledWith(CONV_ID, [
        { role: 'assistant', content: result.response },
      ]);
      expect(deps.practiceQuizMoodle.createPracticeQuiz).not.toHaveBeenCalled();
    });

    it('words the cancellation for a study guide', async () => {
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(guideAction());

      const result = await service.cancelAction('action-guide', USER_ID);

      expect(result.response).toBe(
        'Okay — I cancelled that study guide. Nothing was created in Moodle.',
      );
    });

    it('words the cancellation for flashcards', async () => {
      deps.pendingActionService.assertPendingOwned.mockResolvedValue(
        flashcardsAction(),
      );

      const result = await service.cancelAction('action-cards', USER_ID);

      expect(result.response).toBe(
        'Okay — I cancelled those flashcards. Nothing was created in Moodle.',
      );
    });
  });

  describe('getPendingAction', () => {
    it('checks conversation ownership before looking anything up', async () => {
      await service.getPendingAction(CONV_ID, USER_ID);

      expect(deps.conversationService.assertOwner).toHaveBeenCalledWith(
        CONV_ID,
        USER_ID,
      );
    });

    it('returns null when the conversation has no live proposal', async () => {
      await expect(service.getPendingAction(CONV_ID, USER_ID)).resolves.toBeNull();
    });

    it('maps a practice quiz with its count and normalized difficulty', async () => {
      deps.pendingActionService.getPendingForConversation.mockResolvedValue(
        quizAction({
          payload: {
            title: 'Paging',
            scopeSummary: 'Week 3',
            questionCount: 8,
            difficulty: 'BOGUS',
          },
        }),
      );

      await expect(service.getPendingAction(CONV_ID, USER_ID)).resolves.toEqual({
        id: 'action-quiz',
        type: 'practice_quiz',
        title: 'Paging',
        questionCount: 8,
        difficulty: 'medium',
        scopeSummary: 'Week 3',
      });
    });

    it('maps a study guide without count fields', async () => {
      deps.pendingActionService.getPendingForConversation.mockResolvedValue(
        guideAction(),
      );

      await expect(service.getPendingAction(CONV_ID, USER_ID)).resolves.toEqual({
        id: 'action-guide',
        type: 'study_guide',
        title: 'Paging',
        scopeSummary: 'Week 3 material',
      });
    });

    it('maps flashcards with the card count', async () => {
      deps.pendingActionService.getPendingForConversation.mockResolvedValue(
        flashcardsAction(),
      );

      await expect(service.getPendingAction(CONV_ID, USER_ID)).resolves.toEqual({
        id: 'action-cards',
        type: 'flashcards',
        title: 'Paging',
        scopeSummary: 'Week 3 material',
        cardCount: 12,
      });
    });
  });

  describe('review delegation', () => {
    it('passes the review offer lookup straight through', async () => {
      const offer = {
        actionId: 'action-quiz',
        quizId: 55,
        title: 'Quiz: Paging',
        score: 3,
        maxScore: 5,
        wrongCount: 2,
        total: 5,
        scoreLabel: '3/5',
      };
      deps.practiceQuizReview.getReviewOffer.mockResolvedValue(offer);

      await expect(service.getReviewOffer(CONV_ID, USER_ID)).resolves.toBe(offer);
      expect(deps.practiceQuizReview.getReviewOffer).toHaveBeenCalledWith(
        CONV_ID,
        USER_ID,
      );
    });

    it('explains wrong answers with the requested provider', async () => {
      const resolved = { id: 'anthropic', chat: jest.fn(), generateJson: jest.fn() };
      deps.providers.resolve.mockReturnValue(resolved);
      deps.practiceQuizReview.explainWrongAnswers.mockResolvedValue({
        response: 'Here is why',
        conversationId: CONV_ID,
      });

      const result = await service.explainWrongAnswers(
        CONV_ID,
        USER_ID,
        'anthropic',
      );

      expect(deps.providers.resolve).toHaveBeenCalledWith('anthropic');
      expect(deps.practiceQuizReview.explainWrongAnswers).toHaveBeenCalledWith(
        CONV_ID,
        USER_ID,
        resolved,
      );
      expect(result.response).toBe('Here is why');
    });
  });
});
