import { BadRequestException, Logger } from '@nestjs/common';
import type {
  PracticeAttemptQuestion,
  PracticeAttemptReview,
} from '../../../src/context/context.types';
import type { PracticeQuizPayload } from '../../../src/chat/entities/pending-action.entity';
import { PracticeQuizReviewService } from '../../../src/chat/practice-quiz-review.service';

const CONVERSATION_ID = 'conv-1';
const MOODLE_USER_ID = 7;
const COURSE_ID = 42;

function question(
  overrides: Partial<PracticeAttemptQuestion> = {},
): PracticeAttemptQuestion {
  return {
    slot: 1,
    name: 'Page tables',
    questiontext: 'What does a page table map?',
    studentanswer: 'Files to directories',
    rightanswer: 'Virtual pages to physical frames',
    iscorrect: false,
    mark: 0,
    maxmark: 1,
    ...overrides,
  };
}

const CORRECT_QUESTIONS: PracticeAttemptQuestion[] = [
  question({
    slot: 2,
    name: 'TLB',
    questiontext: 'What does the TLB cache?',
    studentanswer: 'Recent address translations',
    rightanswer: 'Recent address translations',
    iscorrect: true,
    mark: 1,
  }),
  question({
    slot: 3,
    name: 'Frames',
    questiontext: 'Are frames fixed size?',
    studentanswer: 'True',
    rightanswer: 'True',
    iscorrect: true,
    mark: 1,
  }),
  question({
    slot: 4,
    name: 'Segments',
    questiontext: 'Are segments variable size?',
    studentanswer: 'True',
    rightanswer: 'True',
    iscorrect: true,
    mark: 1,
  }),
];

function attemptReview(
  overrides: Partial<PracticeAttemptReview> = {},
): PracticeAttemptReview {
  return {
    hasAttempt: true,
    attemptId: 77,
    state: 'finished',
    score: 3,
    maxScore: 4,
    questions: [question(), ...CORRECT_QUESTIONS],
    ...overrides,
  };
}

function payload(
  overrides: Partial<PracticeQuizPayload> = {},
): PracticeQuizPayload {
  return {
    title: 'Memory Practice',
    scopeSummary: 'Week 3',
    questionCount: 4,
    quizId: 900,
    sectionIds: [10],
    sectionNumbers: [3],
    explainedAttemptId: null,
    ...overrides,
  };
}

function confirmedAction(payloadOverrides: Partial<PracticeQuizPayload> = {}) {
  return {
    id: 'action-1',
    courseId: COURSE_ID,
    payload: payload(payloadOverrides),
  };
}

function buildLlm(why: unknown = { why: 'You confused mappings with files.' }) {
  return {
    id: 'mock',
    chat: jest.fn(),
    generateJson: jest.fn(async (_request: unknown) =>
      typeof why === 'string' ? why : JSON.stringify(why),
    ),
  };
}

function buildService(
  overrides: {
    context?: Record<string, unknown>;
    moodle?: Record<string, unknown>;
    conversation?: Record<string, unknown>;
    pendingAction?: Record<string, unknown>;
  } = {},
) {
  const contextService = {
    getContext: jest.fn(async () => 'Page tables map virtual pages to frames.'),
    findBestCitation: jest.fn(async () => ({
      title: 'Lecture 3 notes',
      url: 'https://course.test/l3',
      snippet: 'A page table maps pages to frames.',
    })),
    resolveSectionsFromScope: jest.fn(async () => ({
      sectionIds: [] as number[],
      sectionNumbers: [] as number[],
    })),
    ...overrides.context,
  };

  const practiceQuizMoodle = {
    getPracticeAttemptReview: jest.fn(async () => attemptReview()),
    ...overrides.moodle,
  };

  const conversationService = {
    assertOwner: jest.fn(async () => undefined),
    appendMessages: jest.fn(async () => []),
    ...overrides.conversation,
  };

  const pendingActionService = {
    getConfirmedPracticeQuizForConversation: jest.fn(async () =>
      confirmedAction(),
    ),
    markExplained: jest.fn(async () => undefined),
    ...overrides.pendingAction,
  };

  const service = new PracticeQuizReviewService(
    contextService as never,
    practiceQuizMoodle as never,
    conversationService as never,
    pendingActionService as never,
  );

  return {
    service,
    contextService,
    practiceQuizMoodle,
    conversationService,
    pendingActionService,
  };
}

describe('PracticeQuizReviewService', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getReviewOffer', () => {
    it('returns the graded offer for an attempt with wrong answers', async () => {
      const { service, conversationService, practiceQuizMoodle } =
        buildService();

      await expect(
        service.getReviewOffer(CONVERSATION_ID, MOODLE_USER_ID),
      ).resolves.toEqual({
        actionId: 'action-1',
        quizId: 900,
        title: 'Memory Practice',
        score: 3,
        maxScore: 4,
        wrongCount: 1,
        total: 4,
        scoreLabel: '3/4',
      });

      expect(conversationService.assertOwner).toHaveBeenCalledWith(
        CONVERSATION_ID,
        MOODLE_USER_ID,
      );
      expect(practiceQuizMoodle.getPracticeAttemptReview).toHaveBeenCalledWith(
        900,
        MOODLE_USER_ID,
      );
    });

    it('rounds a fractional score and falls back to the question count when maxScore is 0', async () => {
      const { service } = buildService({
        moodle: {
          getPracticeAttemptReview: jest.fn(async () =>
            attemptReview({ score: 2.5, maxScore: 0 }),
          ),
        },
      });

      await expect(
        service.getReviewOffer(CONVERSATION_ID, MOODLE_USER_ID),
      ).resolves.toMatchObject({
        score: 3,
        maxScore: 4,
        scoreLabel: '3/4',
      });
    });

    it('returns null and never touches Moodle when there is no confirmed quiz', async () => {
      const { service, practiceQuizMoodle } = buildService({
        pendingAction: {
          getConfirmedPracticeQuizForConversation: jest.fn(async () => null),
        },
      });

      await expect(
        service.getReviewOffer(CONVERSATION_ID, MOODLE_USER_ID),
      ).resolves.toBeNull();
      expect(practiceQuizMoodle.getPracticeAttemptReview).not.toHaveBeenCalled();
    });

    it('returns null when the confirmed action has no quiz id yet', async () => {
      const { service, practiceQuizMoodle } = buildService({
        pendingAction: {
          getConfirmedPracticeQuizForConversation: jest.fn(async () =>
            confirmedAction({ quizId: undefined }),
          ),
        },
      });

      await expect(
        service.getReviewOffer(CONVERSATION_ID, MOODLE_USER_ID),
      ).resolves.toBeNull();
      expect(practiceQuizMoodle.getPracticeAttemptReview).not.toHaveBeenCalled();
    });

    it('returns null when the student has not attempted the quiz', async () => {
      const { service, pendingActionService } = buildService({
        moodle: {
          getPracticeAttemptReview: jest.fn(async () =>
            attemptReview({ hasAttempt: false }),
          ),
        },
      });

      await expect(
        service.getReviewOffer(CONVERSATION_ID, MOODLE_USER_ID),
      ).resolves.toBeNull();
      expect(pendingActionService.markExplained).not.toHaveBeenCalled();
    });

    it('returns null when this attempt was already explained', async () => {
      const { service } = buildService({
        pendingAction: {
          getConfirmedPracticeQuizForConversation: jest.fn(async () =>
            confirmedAction({ explainedAttemptId: 77 }),
          ),
        },
      });

      await expect(
        service.getReviewOffer(CONVERSATION_ID, MOODLE_USER_ID),
      ).resolves.toBeNull();
    });

    it('still offers a review for a newer attempt than the explained one', async () => {
      const { service } = buildService({
        pendingAction: {
          getConfirmedPracticeQuizForConversation: jest.fn(async () =>
            confirmedAction({ explainedAttemptId: 12 }),
          ),
          markExplained: jest.fn(async () => undefined),
        },
      });

      await expect(
        service.getReviewOffer(CONVERSATION_ID, MOODLE_USER_ID),
      ).resolves.toMatchObject({ wrongCount: 1 });
    });

    it('records a perfect attempt as explained and offers nothing', async () => {
      const { service, pendingActionService } = buildService({
        moodle: {
          getPracticeAttemptReview: jest.fn(async () =>
            attemptReview({ score: 4, questions: CORRECT_QUESTIONS }),
          ),
        },
      });

      await expect(
        service.getReviewOffer(CONVERSATION_ID, MOODLE_USER_ID),
      ).resolves.toBeNull();
      expect(pendingActionService.markExplained).toHaveBeenCalledWith(
        'action-1',
        77,
      );
    });

    it('swallows a Moodle failure, warns, and returns null', async () => {
      const { service } = buildService({
        moodle: {
          getPracticeAttemptReview: jest.fn(async () => {
            throw new Error('moodle 500');
          }),
        },
      });

      await expect(
        service.getReviewOffer(CONVERSATION_ID, MOODLE_USER_ID),
      ).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        `Failed to load review offer for conversation ${CONVERSATION_ID}: Error: moodle 500`,
      );
    });

    it('propagates an ownership failure instead of returning null', async () => {
      const { service, pendingActionService } = buildService({
        conversation: {
          assertOwner: jest.fn(async () => {
            throw new BadRequestException('not your conversation');
          }),
        },
      });

      await expect(
        service.getReviewOffer(CONVERSATION_ID, MOODLE_USER_ID),
      ).rejects.toThrow('not your conversation');
      expect(
        pendingActionService.getConfirmedPracticeQuizForConversation,
      ).not.toHaveBeenCalled();
    });
  });

  describe('explainWrongAnswers', () => {
    it('rejects when the conversation has no confirmed practice quiz', async () => {
      const { service } = buildService({
        pendingAction: {
          getConfirmedPracticeQuizForConversation: jest.fn(async () => null),
        },
      });

      await expect(
        service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm() as never,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'No practice quiz ready for review in this conversation',
        ),
      );
    });

    it('rejects when the confirmed action has no quiz id', async () => {
      const { service } = buildService({
        pendingAction: {
          getConfirmedPracticeQuizForConversation: jest.fn(async () =>
            confirmedAction({ quizId: undefined }),
          ),
        },
      });

      await expect(
        service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm() as never,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the quiz has not been attempted yet', async () => {
      const { service } = buildService({
        moodle: {
          getPracticeAttemptReview: jest.fn(async () =>
            attemptReview({ hasAttempt: false }),
          ),
        },
      });

      await expect(
        service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm() as never,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Finish the practice quiz in Moodle first, then ask me to explain',
        ),
      );
    });

    it('congratulates a perfect attempt without calling the LLM', async () => {
      const { service, conversationService, pendingActionService } =
        buildService({
          moodle: {
            getPracticeAttemptReview: jest.fn(async () =>
              attemptReview({ score: 4, questions: CORRECT_QUESTIONS }),
            ),
          },
        });
      const llm = buildLlm();

      const result = await service.explainWrongAnswers(
        CONVERSATION_ID,
        MOODLE_USER_ID,
        llm as never,
      );

      expect(result).toEqual({
        response:
          'Nice work — you got everything right on that practice quiz. Nothing to walk through!',
        conversationId: CONVERSATION_ID,
      });
      expect(llm.generateJson).not.toHaveBeenCalled();
      expect(pendingActionService.markExplained).toHaveBeenCalledWith(
        'action-1',
        77,
      );
      expect(conversationService.appendMessages).toHaveBeenCalledWith(
        CONVERSATION_ID,
        [
          {
            role: 'assistant',
            content:
              'Nice work — you got everything right on that practice quiz. Nothing to walk through!',
          },
        ],
      );
    });

    it('builds one graded review block per wrong answer', async () => {
      const { service, pendingActionService, conversationService } =
        buildService();
      const llm = buildLlm();

      const result = await service.explainWrongAnswers(
        CONVERSATION_ID,
        MOODLE_USER_ID,
        llm as never,
      );

      expect(result.review).toEqual([
        {
          slot: 1,
          question: 'What does a page table map?',
          studentAnswer: 'Files to directories',
          rightAnswer: 'Virtual pages to physical frames',
          why: 'You confused mappings with files.',
          citationTitle: 'Lecture 3 notes',
          citationSnippet: 'A page table maps pages to frames.',
          citationUrl: 'https://course.test/l3',
        },
      ]);
      expect(result.provider).toBe('mock');
      expect(result.conversationId).toBe(CONVERSATION_ID);
      expect(result.response).toContain(
        '### Practice quiz review — Memory Practice',
      );
      expect(result.response).toContain(
        '**Score:** 3/4 · Walking through **1** wrong answer(s)',
      );
      expect(result.response).toContain(
        '<p><strong>Why:</strong> You confused mappings with files.</p>',
      );
      expect(pendingActionService.markExplained).toHaveBeenCalledWith(
        'action-1',
        77,
      );
      expect(conversationService.appendMessages).toHaveBeenCalledWith(
        CONVERSATION_ID,
        [{ role: 'assistant', content: result.response }],
      );
    });

    it('explains every wrong answer when several are missed', async () => {
      const { service } = buildService({
        moodle: {
          getPracticeAttemptReview: jest.fn(async () =>
            attemptReview({
              score: 2,
              questions: [
                question(),
                question({
                  slot: 5,
                  name: 'Thrashing',
                  questiontext: 'What causes thrashing?',
                  studentanswer: 'Too much cache',
                  rightanswer: 'Excessive paging',
                  iscorrect: false,
                }),
                ...CORRECT_QUESTIONS,
              ],
            }),
          ),
        },
      });
      const llm = buildLlm();

      const result = await service.explainWrongAnswers(
        CONVERSATION_ID,
        MOODLE_USER_ID,
        llm as never,
      );

      expect(result.review).toHaveLength(2);
      expect(result.review?.map((b) => b.slot)).toEqual([1, 5]);
      expect(llm.generateJson).toHaveBeenCalledTimes(2);
      expect(result.response).toContain(
        '**Score:** 2/4 · Walking through **2** wrong answer(s)',
      );
    });

    it('rounds the score and falls back to the question count when maxScore is 0', async () => {
      const { service } = buildService({
        moodle: {
          getPracticeAttemptReview: jest.fn(async () =>
            attemptReview({ score: 2.5, maxScore: 0 }),
          ),
        },
      });

      const result = await service.explainWrongAnswers(
        CONVERSATION_ID,
        MOODLE_USER_ID,
        buildLlm() as never,
      );

      expect(result.response).toContain('**Score:** 3/4 ·');
    });

    describe('section scope', () => {
      it('uses the persisted hard section scope without re-resolving', async () => {
        const { service, contextService } = buildService();

        await service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm() as never,
        );

        const expectedFilter = {
          sectionIds: [10],
          sectionNumbers: [3],
          hardSectionScope: true,
        };
        const expectedQuery =
          'What does a page table map? Virtual pages to physical frames';

        expect(contextService.resolveSectionsFromScope).not.toHaveBeenCalled();
        expect(contextService.getContext).toHaveBeenCalledWith(
          COURSE_ID,
          expectedQuery,
          expectedFilter,
        );
        expect(contextService.findBestCitation).toHaveBeenCalledWith(
          COURSE_ID,
          expectedQuery,
          expectedFilter,
        );
      });

      it('re-resolves the scope for older actions that have no persisted section ids', async () => {
        const { service, contextService } = buildService({
          context: {
            resolveSectionsFromScope: jest.fn(async () => ({
              sectionIds: [21],
              sectionNumbers: [2],
            })),
          },
          pendingAction: {
            getConfirmedPracticeQuizForConversation: jest.fn(async () =>
              confirmedAction({
                scopeSummary: 'Week 2',
                sectionIds: undefined,
                sectionNumbers: undefined,
                sectionId: 5,
                sectionNumber: 2,
                sectionName: 'Week 2',
              }),
            ),
            markExplained: jest.fn(async () => undefined),
          },
        });

        await service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm() as never,
        );

        expect(contextService.resolveSectionsFromScope).toHaveBeenCalledWith(
          COURSE_ID,
          'Week 2',
          { sectionId: 5, sectionNumber: 2, sectionName: 'Week 2' },
        );
        expect(contextService.getContext).toHaveBeenCalledWith(
          COURSE_ID,
          expect.any(String),
          { sectionIds: [21], sectionNumbers: [2], hardSectionScope: true },
        );
      });

      it('falls back to the soft conversation filter when re-resolution finds no sections', async () => {
        const { service, contextService } = buildService({
          pendingAction: {
            getConfirmedPracticeQuizForConversation: jest.fn(async () =>
              confirmedAction({
                sectionIds: [],
                sectionNumbers: undefined,
                sectionId: 5,
                sectionNumber: 2,
                sectionName: 'Week 2',
              }),
            ),
            markExplained: jest.fn(async () => undefined),
          },
        });

        await service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm() as never,
        );

        expect(contextService.getContext).toHaveBeenCalledWith(
          COURSE_ID,
          expect.any(String),
          { sectionId: 5, sectionNumber: 2, sectionName: 'Week 2' },
        );
      });
    });

    describe('per-question explanation', () => {
      it('sends the wrong-answer prompt and schema to the provider', async () => {
        const { service } = buildService();
        const llm = buildLlm();

        await service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          llm as never,
        );

        const request = llm.generateJson.mock.calls[0][0] as {
          prompt: string;
          schema: { required: string[] };
          schemaName: string;
        };

        expect(request.schemaName).toBe('wrong_answer_why');
        expect(request.schema.required).toEqual(['why']);
        expect(request.prompt).toContain(
          'Question: What does a page table map?',
        );
        expect(request.prompt).toContain(
          'Student answered: Files to directories',
        );
        expect(request.prompt).toContain(
          'Correct answer: Virtual pages to physical frames',
        );
        expect(request.prompt).toContain(
          'Page tables map virtual pages to frames.',
        );
      });

      const FALLBACK_WHY =
        'The correct answer is "Virtual pages to physical frames". ' +
        'Your answer ("Files to directories") did not match. ' +
        'Review the related course section and try a similar question again.';

      it('falls back to a canned explanation when the response is not JSON', async () => {
        const { service } = buildService();

        const result = await service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm('```json\n{"why":"fenced"}\n```') as never,
        );

        expect(result.review?.[0].why).toBe(FALLBACK_WHY);
      });

      it('falls back when the response JSON has no why field', async () => {
        const { service } = buildService();

        const result = await service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm({ explanation: 'wrong key' }) as never,
        );

        expect(result.review?.[0].why).toBe(FALLBACK_WHY);
      });

      it('falls back when the why field is only whitespace', async () => {
        const { service } = buildService();

        const result = await service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm({ why: '   ' }) as never,
        );

        expect(result.review?.[0].why).toBe(FALLBACK_WHY);
      });

      it('falls back when the provider itself fails', async () => {
        const { service } = buildService();
        const llm = {
          id: 'mock',
          chat: jest.fn(),
          generateJson: jest.fn(async () => {
            throw new Error('provider down');
          }),
        };

        const result = await service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          llm as never,
        );

        expect(result.review?.[0].why).toBe(FALLBACK_WHY);
      });

      it('trims the explanation returned by the provider', async () => {
        const { service } = buildService();

        const result = await service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm({ why: '  Pages are not files.  ' }) as never,
        );

        expect(result.review?.[0].why).toBe('Pages are not files.');
      });
    });

    describe('missing block fields', () => {
      it('substitutes placeholders for a blank question, answer and right answer', async () => {
        const { service } = buildService({
          moodle: {
            getPracticeAttemptReview: jest.fn(async () =>
              attemptReview({
                questions: [
                  question({
                    name: 'Untitled slot',
                    questiontext: '',
                    studentanswer: '',
                    rightanswer: '',
                  }),
                  ...CORRECT_QUESTIONS,
                ],
              }),
            ),
          },
        });

        const result = await service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm() as never,
        );

        expect(result.review?.[0]).toMatchObject({
          question: 'Untitled slot',
          studentAnswer: '(no answer)',
          rightAnswer: '(unavailable)',
        });
      });

      it('uses a generic citation title when no citation is found', async () => {
        const { service } = buildService({
          context: { findBestCitation: jest.fn(async () => null) },
        });

        const result = await service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm() as never,
        );

        expect(result.review?.[0]).toMatchObject({
          citationTitle: 'Course material',
          citationSnippet: undefined,
          citationUrl: undefined,
        });
      });
    });

    it('asserts conversation ownership before doing any work', async () => {
      const { service, pendingActionService } = buildService({
        conversation: {
          assertOwner: jest.fn(async () => {
            throw new BadRequestException('not your conversation');
          }),
        },
      });

      await expect(
        service.explainWrongAnswers(
          CONVERSATION_ID,
          MOODLE_USER_ID,
          buildLlm() as never,
        ),
      ).rejects.toThrow('not your conversation');
      expect(
        pendingActionService.getConfirmedPracticeQuizForConversation,
      ).not.toHaveBeenCalled();
    });
  });
});
