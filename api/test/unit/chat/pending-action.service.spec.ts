import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FindOperator, Repository } from 'typeorm';
import { PendingActionService } from '../../../src/chat/pending-action.service';
import {
  FlashcardsPayload,
  PendingAction,
  PracticeQuizPayload,
  StudyGuidePayload,
} from '../../../src/chat/entities/pending-action.entity';

const TTL_MS = 20 * 60 * 1000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const NOW = new Date('2026-05-01T12:00:00.000Z');

const CONV_ID = 'conv-1';
const OTHER_CONV_ID = 'conv-2';
const OWNER_ID = 42;
const OTHER_USER_ID = 99;
const COURSE_ID = 7;

function quizPayload(
  overrides: Partial<PracticeQuizPayload> = {},
): PracticeQuizPayload {
  return {
    title: 'Paging and TLBs',
    scopeSummary: 'Week 3 memory management',
    questionCount: 8,
    difficulty: 'hard',
    ...overrides,
  };
}

function guidePayload(
  overrides: Partial<StudyGuidePayload> = {},
): StudyGuidePayload {
  return {
    title: 'Scheduling',
    scopeSummary: 'Week 4 CPU scheduling',
    ...overrides,
  };
}

function cardsPayload(
  overrides: Partial<FlashcardsPayload> = {},
): FlashcardsPayload {
  return {
    title: 'Syscalls',
    scopeSummary: 'Week 2 kernel interface',
    cardCount: 15,
    ...overrides,
  };
}

/** Detached copy so service mutations only land in the store via save(). */
function cloneRow(row: PendingAction): PendingAction {
  return {
    ...row,
    payload: row.payload ? { ...row.payload } : row.payload,
    createdAt: row.createdAt ? new Date(row.createdAt) : row.createdAt,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : row.expiresAt,
  };
}

/** Supports plain equality plus the In() operator used by the service. */
function matchesWhere(
  row: PendingAction,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (expected instanceof FindOperator) {
      return (expected.value as unknown[]).includes(actual);
    }
    return actual === expected;
  });
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('Expected the promise to reject, but it resolved');
}

describe('PendingActionService', () => {
  let service: PendingActionService;
  let rows: PendingAction[];
  let repo: jest.Mocked<Repository<PendingAction>>;
  let nextId: number;

  function seed(overrides: Partial<PendingAction> = {}): PendingAction {
    const row: PendingAction = {
      id: overrides.id ?? `seed-${++nextId}`,
      conversationId: overrides.conversationId ?? CONV_ID,
      courseId: overrides.courseId ?? COURSE_ID,
      moodleUserId: overrides.moodleUserId ?? OWNER_ID,
      type: overrides.type ?? 'practice_quiz',
      payload: overrides.payload ?? quizPayload(),
      status: overrides.status ?? 'pending',
      createdAt: overrides.createdAt ?? new Date(),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + TTL_MS),
    };
    rows.push(row);
    return row;
  }

  function storedById(id: string): PendingAction {
    const row = rows.find((r) => r.id === id);
    if (!row) {
      throw new Error(`No stored row with id ${id}`);
    }
    return row;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    rows = [];
    nextId = 0;

    repo = {
      create: jest.fn(
        (data: Partial<PendingAction>) => ({ ...data }) as PendingAction,
      ),
      save: jest.fn(async (entity: PendingAction) => {
        const incoming = cloneRow(entity);
        if (!incoming.id) {
          incoming.id = `pa-${++nextId}`;
          incoming.createdAt = new Date();
        }
        const idx = rows.findIndex((r) => r.id === incoming.id);
        if (idx >= 0) {
          rows[idx] = { ...rows[idx], ...incoming };
        } else {
          rows.push(incoming);
        }
        return cloneRow(storedById(incoming.id));
      }),
      findOne: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const found = rows.find((r) => matchesWhere(r, where));
          return found ? cloneRow(found) : null;
        },
      ),
      find: jest.fn(
        async (options: {
          where: Record<string, unknown>;
          order?: { createdAt?: 'ASC' | 'DESC' };
          take?: number;
        }) => {
          const matched = rows
            .filter((r) => matchesWhere(r, options.where))
            .sort((a, b) =>
              options.order?.createdAt === 'DESC'
                ? b.createdAt.getTime() - a.createdAt.getTime()
                : a.createdAt.getTime() - b.createdAt.getTime(),
            );
          const limited =
            options.take === undefined ? matched : matched.slice(0, options.take);
          return limited.map(cloneRow);
        },
      ),
      update: jest.fn(
        async (
          criteria: Record<string, unknown>,
          partial: Partial<PendingAction>,
        ) => {
          let affected = 0;
          rows.forEach((row, idx) => {
            if (matchesWhere(row, criteria)) {
              rows[idx] = { ...row, ...partial };
              affected += 1;
            }
          });
          return { affected };
        },
      ),
      delete: jest.fn(async (criteria: Record<string, unknown>) => {
        const before = rows.length;
        rows = rows.filter((row) => !matchesWhere(row, criteria));
        return { affected: before - rows.length };
      }),
    } as unknown as jest.Mocked<Repository<PendingAction>>;

    service = new PendingActionService(repo);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('creating proposals', () => {
    it('persists a practice-quiz proposal as pending with a 20-minute TTL', async () => {
      const payload = quizPayload();

      const created = await service.createPracticeQuizProposal({
        conversationId: CONV_ID,
        courseId: COURSE_ID,
        moodleUserId: OWNER_ID,
        payload,
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          conversationId: CONV_ID,
          courseId: COURSE_ID,
          moodleUserId: OWNER_ID,
          type: 'practice_quiz',
          status: 'pending',
          payload,
        }),
      );
      expect(rows[0].expiresAt.getTime()).toBe(NOW.getTime() + TTL_MS);
      expect(created.type).toBe('practice_quiz');
      expect(created.status).toBe('pending');
      expect(created.payload).toEqual(payload);
    });

    it('persists a study-guide proposal with the study_guide type and its payload', async () => {
      const payload = guidePayload({ sectionId: 31, sectionName: 'Week 4' });

      const created = await service.createStudyGuideProposal({
        conversationId: CONV_ID,
        courseId: COURSE_ID,
        moodleUserId: OWNER_ID,
        payload,
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('study_guide');
      expect(rows[0].payload).toEqual(payload);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].expiresAt.getTime()).toBe(NOW.getTime() + TTL_MS);
      expect(created.payload).toEqual(payload);
    });

    it('persists a flashcards proposal with the flashcards type and card count', async () => {
      const payload = cardsPayload({ cardCount: 22 });

      const created = await service.createFlashcardsProposal({
        conversationId: CONV_ID,
        courseId: COURSE_ID,
        moodleUserId: OWNER_ID,
        payload,
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe('flashcards');
      expect(rows[0].payload).toEqual(
        expect.objectContaining({ cardCount: 22, title: 'Syscalls' }),
      );
      expect(rows[0].expiresAt.getTime()).toBe(NOW.getTime() + TTL_MS);
      expect(created.type).toBe('flashcards');
    });

    it('cancels other pending actions in the same conversation only', async () => {
      seed({ id: 'same-conv-pending', status: 'pending' });
      seed({
        id: 'other-conv-pending',
        conversationId: OTHER_CONV_ID,
        status: 'pending',
      });
      seed({ id: 'already-confirmed', status: 'confirmed' });

      await service.createStudyGuideProposal({
        conversationId: CONV_ID,
        courseId: COURSE_ID,
        moodleUserId: OWNER_ID,
        payload: guidePayload(),
      });

      expect(storedById('same-conv-pending').status).toBe('cancelled');
      expect(storedById('other-conv-pending').status).toBe('pending');
      expect(storedById('already-confirmed').status).toBe('confirmed');
      expect(repo.update).toHaveBeenCalledWith(
        { conversationId: CONV_ID, status: 'pending' },
        { status: 'cancelled' },
      );
    });

    it('leaves only the newest proposal pending when several are created in a row', async () => {
      await service.createPracticeQuizProposal({
        conversationId: CONV_ID,
        courseId: COURSE_ID,
        moodleUserId: OWNER_ID,
        payload: quizPayload(),
      });
      jest.setSystemTime(new Date(NOW.getTime() + 1000));
      await service.createFlashcardsProposal({
        conversationId: CONV_ID,
        courseId: COURSE_ID,
        moodleUserId: OWNER_ID,
        payload: cardsPayload(),
      });

      const statuses = rows.map((r) => ({ type: r.type, status: r.status }));
      expect(statuses).toEqual([
        { type: 'practice_quiz', status: 'cancelled' },
        { type: 'flashcards', status: 'pending' },
      ]);
    });
  });

  describe('getPendingForConversation', () => {
    it('returns null when the conversation has no pending action', async () => {
      seed({ id: 'cancelled-one', status: 'cancelled' });
      seed({ id: 'confirmed-one', status: 'confirmed' });

      await expect(
        service.getPendingForConversation(CONV_ID, OWNER_ID),
      ).resolves.toBeNull();
    });

    it('returns the most recent pending action for the owner', async () => {
      seed({ id: 'older', createdAt: new Date(NOW.getTime() - 5000) });
      seed({
        id: 'newest',
        type: 'flashcards',
        payload: cardsPayload(),
        createdAt: new Date(NOW.getTime() - 1000),
      });

      const found = await service.getPendingForConversation(CONV_ID, OWNER_ID);

      expect(found?.id).toBe('newest');
      expect(found?.type).toBe('flashcards');
    });

    it('does not return a pending action belonging to another user', async () => {
      seed({ id: 'someone-elses', moodleUserId: OTHER_USER_ID });

      await expect(
        service.getPendingForConversation(CONV_ID, OWNER_ID),
      ).resolves.toBeNull();
    });

    it('still returns the action one millisecond before the TTL boundary', async () => {
      seed({ id: 'ttl-inside', expiresAt: new Date(NOW.getTime() + TTL_MS) });
      jest.setSystemTime(new Date(NOW.getTime() + TTL_MS - 1));

      const found = await service.getPendingForConversation(CONV_ID, OWNER_ID);

      expect(found?.id).toBe('ttl-inside');
      expect(storedById('ttl-inside').status).toBe('pending');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('marks the action expired and returns null exactly at the TTL boundary', async () => {
      seed({ id: 'ttl-edge', expiresAt: new Date(NOW.getTime() + TTL_MS) });
      jest.setSystemTime(new Date(NOW.getTime() + TTL_MS));

      const found = await service.getPendingForConversation(CONV_ID, OWNER_ID);

      expect(found).toBeNull();
      expect(storedById('ttl-edge').status).toBe('expired');
    });

    it('marks the action expired and returns null past the TTL boundary', async () => {
      seed({ id: 'ttl-outside', expiresAt: new Date(NOW.getTime() + TTL_MS) });
      jest.setSystemTime(new Date(NOW.getTime() + TTL_MS + 1));

      const found = await service.getPendingForConversation(CONV_ID, OWNER_ID);

      expect(found).toBeNull();
      expect(storedById('ttl-outside').status).toBe('expired');
    });
  });

  describe('assertPendingOwned', () => {
    it('returns the action for the owner while it is still pending', async () => {
      seed({ id: 'owned' });

      const action = await service.assertPendingOwned('owned', OWNER_ID);

      expect(action.id).toBe('owned');
      expect(action.status).toBe('pending');
    });

    it('throws NotFoundException when the action does not exist', async () => {
      const error = await captureError(
        service.assertPendingOwned('missing', OWNER_ID),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Pending action not found');
    });

    it('throws BadRequestException when the action belongs to another user', async () => {
      seed({ id: 'not-mine', moodleUserId: OTHER_USER_ID });

      const error = await captureError(
        service.assertPendingOwned('not-mine', OWNER_ID),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(
        'Pending action does not belong to this user',
      );
      expect(storedById('not-mine').status).toBe('pending');
    });

    it('reports the existing status when the action was already confirmed', async () => {
      seed({ id: 'done', status: 'confirmed' });

      const error = await captureError(
        service.assertPendingOwned('done', OWNER_ID),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Action is already confirmed');
    });

    it('reports the existing status when the action was already cancelled', async () => {
      seed({ id: 'dropped', status: 'cancelled' });

      const error = await captureError(
        service.assertPendingOwned('dropped', OWNER_ID),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Action is already cancelled');
    });

    it('accepts an action one millisecond before it expires', async () => {
      seed({ id: 'barely-alive', expiresAt: new Date(NOW.getTime() + TTL_MS) });
      jest.setSystemTime(new Date(NOW.getTime() + TTL_MS - 1));

      const action = await service.assertPendingOwned('barely-alive', OWNER_ID);

      expect(action.id).toBe('barely-alive');
      expect(storedById('barely-alive').status).toBe('pending');
    });

    it('expires and rejects an action exactly at the TTL boundary', async () => {
      seed({ id: 'just-expired', expiresAt: new Date(NOW.getTime() + TTL_MS) });
      jest.setSystemTime(new Date(NOW.getTime() + TTL_MS));

      const error = await captureError(
        service.assertPendingOwned('just-expired', OWNER_ID),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Pending action has expired');
      expect(storedById('just-expired').status).toBe('expired');
    });
  });

  describe('updatePendingPayload', () => {
    it('replaces the payload of a pending action and persists it', async () => {
      seed({ id: 'editable', payload: quizPayload({ questionCount: 8 }) });
      const nextPayload = quizPayload({
        questionCount: 20,
        difficulty: 'easy',
        title: 'Paging only',
      });

      const updated = await service.updatePendingPayload(
        'editable',
        nextPayload,
      );

      expect(updated.payload).toEqual(nextPayload);
      expect(storedById('editable').payload).toEqual(nextPayload);
      expect(storedById('editable').status).toBe('pending');
    });

    it('throws NotFoundException for an unknown action id', async () => {
      const error = await captureError(
        service.updatePendingPayload('nope', quizPayload()),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Pending action not found');
    });

    it('refuses to edit an action that is no longer pending', async () => {
      const original = quizPayload();
      seed({ id: 'locked', status: 'confirmed', payload: original });

      const error = await captureError(
        service.updatePendingPayload('locked', quizPayload({ title: 'New' })),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Action is already confirmed');
      expect(storedById('locked').payload).toEqual(original);
    });
  });

  describe('markConfirmed / markCancelled', () => {
    it('flips only the targeted action to confirmed', async () => {
      seed({ id: 'target' });
      seed({ id: 'bystander', conversationId: OTHER_CONV_ID });

      await service.markConfirmed('target');

      expect(storedById('target').status).toBe('confirmed');
      expect(storedById('bystander').status).toBe('pending');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'target' },
        { status: 'confirmed' },
      );
    });

    it('flips only the targeted action to cancelled', async () => {
      seed({ id: 'target' });
      seed({ id: 'bystander', conversationId: OTHER_CONV_ID });

      await service.markCancelled('target');

      expect(storedById('target').status).toBe('cancelled');
      expect(storedById('bystander').status).toBe('pending');
    });

    it('makes a cancelled action invisible to getPendingForConversation', async () => {
      seed({ id: 'to-cancel' });

      await service.markCancelled('to-cancel');

      await expect(
        service.getPendingForConversation(CONV_ID, OWNER_ID),
      ).resolves.toBeNull();
    });
  });

  describe('markConfirmedWithQuiz', () => {
    it('merges Moodle quiz ids into the payload and extends expiry to a year', async () => {
      seed({ id: 'quiz-1', payload: quizPayload() });

      const result = await service.markConfirmedWithQuiz('quiz-1', {
        quizId: 55,
        cmId: 900,
        viewUrl: 'https://moodle.test/mod/quiz/view.php?id=900',
      });

      expect(result.status).toBe('confirmed');
      expect(result.payload).toEqual({
        title: 'Paging and TLBs',
        scopeSummary: 'Week 3 memory management',
        questionCount: 8,
        difficulty: 'hard',
        quizId: 55,
        cmId: 900,
        viewUrl: 'https://moodle.test/mod/quiz/view.php?id=900',
        explainedAt: null,
        explainedAttemptId: null,
      });

      const stored = storedById('quiz-1');
      expect(stored.status).toBe('confirmed');
      expect(stored.payload).toEqual(result.payload);
      expect(stored.expiresAt.getTime()).toBe(NOW.getTime() + YEAR_MS);
    });

    it('omits sectionIds and sectionNumbers when the caller does not supply them', async () => {
      seed({ id: 'quiz-2', payload: quizPayload() });

      const result = await service.markConfirmedWithQuiz('quiz-2', {
        quizId: 1,
        cmId: 2,
        viewUrl: 'https://moodle.test/q',
      });

      expect(Object.keys(result.payload)).not.toContain('sectionIds');
      expect(Object.keys(result.payload)).not.toContain('sectionNumbers');
    });

    it('stores supplied section scoping alongside the quiz ids', async () => {
      seed({ id: 'quiz-3', payload: quizPayload() });

      const result = await service.markConfirmedWithQuiz('quiz-3', {
        quizId: 5,
        cmId: 6,
        viewUrl: 'https://moodle.test/q',
        sectionIds: [11, 12],
        sectionNumbers: [3, 4],
      });

      expect(result.payload).toEqual(
        expect.objectContaining({ sectionIds: [11, 12], sectionNumbers: [3, 4] }),
      );
      expect(storedById('quiz-3').payload).toEqual(
        expect.objectContaining({ sectionIds: [11, 12], sectionNumbers: [3, 4] }),
      );
    });

    it('keeps section scoping already on the payload when the caller omits it', async () => {
      seed({
        id: 'quiz-4',
        payload: quizPayload({ sectionIds: [77], sectionNumbers: [9] }),
      });

      const result = await service.markConfirmedWithQuiz('quiz-4', {
        quizId: 5,
        cmId: 6,
        viewUrl: 'https://moodle.test/q',
      });

      expect(result.payload).toEqual(
        expect.objectContaining({ sectionIds: [77], sectionNumbers: [9] }),
      );
    });

    it('throws NotFoundException for an unknown action id', async () => {
      const error = await captureError(
        service.markConfirmedWithQuiz('ghost', {
          quizId: 1,
          cmId: 2,
          viewUrl: 'https://moodle.test/q',
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Pending action not found');
    });

    it('rejects an action that is not a practice quiz and leaves it untouched', async () => {
      seed({ id: 'guide-1', type: 'study_guide', payload: guidePayload() });

      const error = await captureError(
        service.markConfirmedWithQuiz('guide-1', {
          quizId: 1,
          cmId: 2,
          viewUrl: 'https://moodle.test/q',
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Action is not a practice quiz');
      expect(storedById('guide-1').status).toBe('pending');
    });
  });

  describe('markConfirmedWithPage', () => {
    it('confirms a study guide with page ids and a one-year expiry', async () => {
      seed({ id: 'guide-1', type: 'study_guide', payload: guidePayload() });

      const result = await service.markConfirmedWithPage('guide-1', {
        pageId: 31,
        cmId: 410,
        viewUrl: 'https://moodle.test/mod/page/view.php?id=410',
      });

      expect(result.status).toBe('confirmed');
      expect(result.payload).toEqual({
        title: 'Scheduling',
        scopeSummary: 'Week 4 CPU scheduling',
        pageId: 31,
        cmId: 410,
        viewUrl: 'https://moodle.test/mod/page/view.php?id=410',
      });
      expect(storedById('guide-1').expiresAt.getTime()).toBe(
        NOW.getTime() + YEAR_MS,
      );
    });

    it('confirms flashcards with page ids and preserves the card count', async () => {
      seed({
        id: 'cards-1',
        type: 'flashcards',
        payload: cardsPayload({ cardCount: 18 }),
      });

      const result = await service.markConfirmedWithPage('cards-1', {
        pageId: 32,
        cmId: 411,
        viewUrl: 'https://moodle.test/mod/page/view.php?id=411',
        sectionIds: [5],
        sectionNumbers: [2],
      });

      expect(result.payload).toEqual({
        title: 'Syscalls',
        scopeSummary: 'Week 2 kernel interface',
        cardCount: 18,
        pageId: 32,
        cmId: 411,
        viewUrl: 'https://moodle.test/mod/page/view.php?id=411',
        sectionIds: [5],
        sectionNumbers: [2],
      });
      expect(storedById('cards-1').status).toBe('confirmed');
    });

    it('omits section keys entirely when the caller does not supply them', async () => {
      seed({ id: 'guide-2', type: 'study_guide', payload: guidePayload() });

      const result = await service.markConfirmedWithPage('guide-2', {
        pageId: 1,
        cmId: 2,
        viewUrl: 'https://moodle.test/p',
      });

      expect(Object.keys(result.payload)).not.toContain('sectionIds');
      expect(Object.keys(result.payload)).not.toContain('sectionNumbers');
    });

    it('rejects a practice quiz as not a private page content type', async () => {
      seed({ id: 'quiz-1', type: 'practice_quiz', payload: quizPayload() });

      const error = await captureError(
        service.markConfirmedWithPage('quiz-1', {
          pageId: 1,
          cmId: 2,
          viewUrl: 'https://moodle.test/p',
        }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Action is not a private page content type');
      expect(storedById('quiz-1').status).toBe('pending');
    });

    it('throws NotFoundException for an unknown action id', async () => {
      const error = await captureError(
        service.markConfirmedWithPage('ghost', {
          pageId: 1,
          cmId: 2,
          viewUrl: 'https://moodle.test/p',
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Pending action not found');
    });
  });

  describe('getConfirmedPracticeQuizForConversation', () => {
    it('returns the newest confirmed quiz that actually has a Moodle quiz id', async () => {
      seed({
        id: 'no-quiz-id',
        status: 'confirmed',
        payload: quizPayload(),
        createdAt: new Date(NOW.getTime() - 1000),
      });
      seed({
        id: 'zero-quiz-id',
        status: 'confirmed',
        payload: quizPayload({ quizId: 0 }),
        createdAt: new Date(NOW.getTime() - 2000),
      });
      seed({
        id: 'real-quiz',
        status: 'confirmed',
        payload: quizPayload({ quizId: 77 }),
        createdAt: new Date(NOW.getTime() - 3000),
      });
      seed({
        id: 'older-real-quiz',
        status: 'confirmed',
        payload: quizPayload({ quizId: 12 }),
        createdAt: new Date(NOW.getTime() - 4000),
      });

      const found = await service.getConfirmedPracticeQuizForConversation(
        CONV_ID,
        OWNER_ID,
      );

      expect(found?.id).toBe('real-quiz');
      expect((found?.payload as PracticeQuizPayload).quizId).toBe(77);
    });

    it('returns null when the conversation has no confirmed quiz with an id', async () => {
      seed({ id: 'pending-quiz', status: 'pending', payload: quizPayload() });
      seed({
        id: 'confirmed-no-id',
        status: 'confirmed',
        payload: quizPayload(),
      });

      await expect(
        service.getConfirmedPracticeQuizForConversation(CONV_ID, OWNER_ID),
      ).resolves.toBeNull();
    });

    it('ignores confirmed quizzes belonging to another user', async () => {
      seed({
        id: 'other-users-quiz',
        status: 'confirmed',
        moodleUserId: OTHER_USER_ID,
        payload: quizPayload({ quizId: 500 }),
      });

      await expect(
        service.getConfirmedPracticeQuizForConversation(CONV_ID, OWNER_ID),
      ).resolves.toBeNull();
    });
  });

  describe('markExplained', () => {
    it('records the attempt id and an ISO timestamp without changing status', async () => {
      seed({
        id: 'quiz-1',
        status: 'confirmed',
        payload: quizPayload({ quizId: 5, cmId: 6 }),
      });

      await service.markExplained('quiz-1', 321);

      const stored = storedById('quiz-1');
      expect(stored.payload).toEqual(
        expect.objectContaining({
          quizId: 5,
          cmId: 6,
          explainedAttemptId: 321,
          explainedAt: NOW.toISOString(),
        }),
      );
      expect(stored.status).toBe('confirmed');
    });

    it('throws NotFoundException for an unknown action id', async () => {
      const error = await captureError(service.markExplained('ghost', 1));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Pending action not found');
    });

    it('rejects a non-quiz action and leaves its payload untouched', async () => {
      const original = cardsPayload();
      seed({ id: 'cards-1', type: 'flashcards', payload: original });

      const error = await captureError(service.markExplained('cards-1', 9));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Action is not a practice quiz');
      expect(storedById('cards-1').payload).toEqual(original);
    });
  });

  describe('full lifecycle', () => {
    it('walks create -> lookup -> confirm and stops returning the action as pending', async () => {
      const created = await service.createPracticeQuizProposal({
        conversationId: CONV_ID,
        courseId: COURSE_ID,
        moodleUserId: OWNER_ID,
        payload: quizPayload(),
      });

      const pending = await service.getPendingForConversation(
        CONV_ID,
        OWNER_ID,
      );
      expect(pending?.id).toBe(created.id);

      const owned = await service.assertPendingOwned(created.id, OWNER_ID);
      expect(owned.id).toBe(created.id);

      await service.markConfirmedWithQuiz(created.id, {
        quizId: 90,
        cmId: 91,
        viewUrl: 'https://moodle.test/mod/quiz/view.php?id=91',
      });

      await expect(
        service.getPendingForConversation(CONV_ID, OWNER_ID),
      ).resolves.toBeNull();

      const confirmed = await service.getConfirmedPracticeQuizForConversation(
        CONV_ID,
        OWNER_ID,
      );
      expect(confirmed?.id).toBe(created.id);

      const error = await captureError(
        service.assertPendingOwned(created.id, OWNER_ID),
      );
      expect(error.message).toBe('Action is already confirmed');
    });

    it('walks create -> expire and rejects a late confirmation attempt', async () => {
      const created = await service.createPracticeQuizProposal({
        conversationId: CONV_ID,
        courseId: COURSE_ID,
        moodleUserId: OWNER_ID,
        payload: quizPayload(),
      });

      jest.setSystemTime(new Date(NOW.getTime() + TTL_MS));

      const error = await captureError(
        service.assertPendingOwned(created.id, OWNER_ID),
      );
      expect(error.message).toBe('Pending action has expired');
      expect(storedById(created.id).status).toBe('expired');

      // A second attempt now reports the persisted expired status instead.
      const second = await captureError(
        service.assertPendingOwned(created.id, OWNER_ID),
      );
      expect(second.message).toBe('Action is already expired');
    });
  });
});
