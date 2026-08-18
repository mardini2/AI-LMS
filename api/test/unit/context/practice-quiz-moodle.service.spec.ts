import { Logger } from '@nestjs/common';
import { PracticeQuizMoodleService } from '../../../src/context/practice-quiz-moodle.service';
import type { PracticeQuizQuestion } from '../../../src/context/context.types';

type MoodleDouble = {
  callMoodleApi: jest.Mock;
  toPublicMoodleUrl: jest.Mock;
};

function createMoodleDouble(): MoodleDouble {
  return {
    callMoodleApi: jest.fn(),
    toPublicMoodleUrl: jest.fn((raw: string) => `public:${raw}`),
  };
}

const QUESTIONS: PracticeQuizQuestion[] = [
  {
    type: 'multichoice',
    name: 'Q1',
    questiontext: 'What is 2 + 2?',
    answers: [
      { text: '4', fraction: 1 },
      { text: '5', fraction: 0 },
    ],
  },
];

describe('PracticeQuizMoodleService', () => {
  let moodle: MoodleDouble;
  let service: PracticeQuizMoodleService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    moodle = createMoodleDouble();
    service = new PracticeQuizMoodleService(moodle as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('ensureStudentPlacement', () => {
    it('calls local_syllentras_ai_ensure_student_placement over GET with courseid/userid', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        sectionid: 7,
        sectionnum: 3,
        groupid: 21,
        groupname: 'AI Content - Student 42',
        availabilityjson: '{"op":"&","c":[]}',
      });

      await service.ensureStudentPlacement(12, 42);

      // Two-arg call means the default GET method is used.
      expect(moodle.callMoodleApi).toHaveBeenCalledWith(
        'local_syllentras_ai_ensure_student_placement',
        { courseid: 12, userid: 42 },
      );
      expect(moodle.callMoodleApi).toHaveBeenCalledTimes(1);
    });

    it('maps the snake_case Moodle payload into a StudentPlacement', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        sectionid: 7,
        sectionnum: 3,
        groupid: 21,
        groupname: 'AI Content - Student 42',
        availabilityjson: '{"op":"&","c":[]}',
        extraneous: 'ignored',
      });

      await expect(service.ensureStudentPlacement(12, 42)).resolves.toEqual({
        sectionId: 7,
        sectionNum: 3,
        groupId: 21,
        groupName: 'AI Content - Student 42',
        availabilityJson: '{"op":"&","c":[]}',
      });
    });

    it('rejects courseId <= 1 without calling Moodle', async () => {
      await expect(service.ensureStudentPlacement(1, 42)).rejects.toThrow(
        'courseId must be a real course (greater than 1)',
      );
      await expect(service.ensureStudentPlacement(0, 42)).rejects.toThrow(
        'courseId must be a real course (greater than 1)',
      );
      await expect(service.ensureStudentPlacement(-3, 42)).rejects.toThrow(
        'courseId must be a real course (greater than 1)',
      );
      expect(moodle.callMoodleApi).not.toHaveBeenCalled();
    });

    it('rejects moodleUserId < 1 without calling Moodle', async () => {
      await expect(service.ensureStudentPlacement(12, 0)).rejects.toThrow(
        'moodleUserId must be a positive integer',
      );
      expect(moodle.callMoodleApi).not.toHaveBeenCalled();
    });

    it('propagates Moodle failures unchanged', async () => {
      moodle.callMoodleApi.mockRejectedValue(
        new Error('Moodle API exception: nopermissions'),
      );

      await expect(service.ensureStudentPlacement(12, 42)).rejects.toThrow(
        'Moodle API exception: nopermissions',
      );
    });
  });

  describe('createPracticeQuiz', () => {
    function mockHappyPath(
      quiz: Record<string, unknown> = {
        quizid: 55,
        cmid: 501,
        name: 'Practice: Cells',
        viewurl: 'http://webserver/mod/quiz/view.php?id=501',
      },
    ): void {
      moodle.callMoodleApi.mockImplementation(
        async (wsfunction: string): Promise<unknown> => {
          if (wsfunction === 'local_syllentras_ai_ensure_student_placement') {
            return {
              sectionid: 7,
              sectionnum: 3,
              groupid: 21,
              groupname: 'AI Content',
              availabilityjson: '{}',
            };
          }
          if (wsfunction === 'local_syllentras_ai_create_practice_quiz') {
            return quiz;
          }
          throw new Error(`Unexpected wsfunction: ${wsfunction}`);
        },
      );
    }

    it('ensures placement first, then POSTs local_syllentras_ai_create_practice_quiz', async () => {
      mockHappyPath();

      await service.createPracticeQuiz({
        courseId: 12,
        moodleUserId: 42,
        name: 'Practice: Cells',
        intro: 'Ten questions',
        questions: QUESTIONS,
      });

      expect(moodle.callMoodleApi.mock.calls.map((call) => call[0])).toEqual([
        'local_syllentras_ai_ensure_student_placement',
        'local_syllentras_ai_create_practice_quiz',
      ]);
      expect(moodle.callMoodleApi).toHaveBeenNthCalledWith(
        2,
        'local_syllentras_ai_create_practice_quiz',
        {
          courseid: 12,
          userid: 42,
          name: 'Practice: Cells',
          intro: 'Ten questions',
          questions: [
            {
              type: 'multichoice',
              name: 'Q1',
              questiontext: 'What is 2 + 2?',
              answers: [
                { text: '4', fraction: 1 },
                { text: '5', fraction: 0 },
              ],
            },
          ],
        },
        'POST',
      );
    });

    it('defaults intro to an empty string when omitted', async () => {
      mockHappyPath();

      await service.createPracticeQuiz({
        courseId: 12,
        moodleUserId: 42,
        name: 'Practice: Cells',
        questions: QUESTIONS,
      });

      expect(moodle.callMoodleApi.mock.calls[1][1]).toMatchObject({ intro: '' });
    });

    it('sends only type/name/questiontext and text/fraction per answer', async () => {
      mockHappyPath();

      await service.createPracticeQuiz({
        courseId: 12,
        moodleUserId: 42,
        name: 'Practice',
        questions: [
          {
            type: 'truefalse',
            name: 'Q1',
            questiontext: 'The sky is blue.',
            id: 'client-only',
            answers: [{ text: 'True', fraction: 1, feedback: 'nice' }],
          },
        ] as unknown as PracticeQuizQuestion[],
      });

      expect(moodle.callMoodleApi.mock.calls[1][1]).toMatchObject({
        questions: [
          {
            type: 'truefalse',
            name: 'Q1',
            questiontext: 'The sky is blue.',
            answers: [{ text: 'True', fraction: 1 }],
          },
        ],
      });
      const sentQuestion = (
        moodle.callMoodleApi.mock.calls[1][1] as {
          questions: Array<Record<string, unknown>>;
        }
      ).questions[0];
      expect(Object.keys(sentQuestion).sort()).toEqual([
        'answers',
        'name',
        'questiontext',
        'type',
      ]);
      expect(
        Object.keys(
          (sentQuestion.answers as Array<Record<string, unknown>>)[0],
        ).sort(),
      ).toEqual(['fraction', 'text']);
    });

    it('maps the response into CreatedPracticeQuiz with a public view URL', async () => {
      mockHappyPath();

      await expect(
        service.createPracticeQuiz({
          courseId: 12,
          moodleUserId: 42,
          name: 'Practice: Cells',
          questions: QUESTIONS,
        }),
      ).resolves.toEqual({
        quizId: 55,
        cmId: 501,
        name: 'Practice: Cells',
        viewUrl: 'public:http://webserver/mod/quiz/view.php?id=501',
      });
      expect(moodle.toPublicMoodleUrl).toHaveBeenCalledWith(
        'http://webserver/mod/quiz/view.php?id=501',
      );
    });

    it('rejects courseId <= 1, moodleUserId < 1, and empty question lists before any Moodle call', async () => {
      await expect(
        service.createPracticeQuiz({
          courseId: 1,
          moodleUserId: 42,
          name: 'Q',
          questions: QUESTIONS,
        }),
      ).rejects.toThrow('courseId must be a real course (greater than 1)');

      await expect(
        service.createPracticeQuiz({
          courseId: 12,
          moodleUserId: 0,
          name: 'Q',
          questions: QUESTIONS,
        }),
      ).rejects.toThrow('moodleUserId must be a positive integer');

      await expect(
        service.createPracticeQuiz({
          courseId: 12,
          moodleUserId: 42,
          name: 'Q',
          questions: [],
        }),
      ).rejects.toThrow('At least one question is required');

      expect(moodle.callMoodleApi).not.toHaveBeenCalled();
    });

    it('does not attempt quiz creation when placement fails', async () => {
      moodle.callMoodleApi.mockRejectedValue(new Error('placement blew up'));

      await expect(
        service.createPracticeQuiz({
          courseId: 12,
          moodleUserId: 42,
          name: 'Practice',
          questions: QUESTIONS,
        }),
      ).rejects.toThrow('placement blew up');

      expect(moodle.callMoodleApi).toHaveBeenCalledTimes(1);
      expect(moodle.callMoodleApi).toHaveBeenCalledWith(
        'local_syllentras_ai_ensure_student_placement',
        { courseid: 12, userid: 42 },
      );
    });

    it('propagates a failure from the quiz creation call itself', async () => {
      moodle.callMoodleApi.mockImplementation(
        async (wsfunction: string): Promise<unknown> => {
          if (wsfunction === 'local_syllentras_ai_ensure_student_placement') {
            return { sectionid: 1, sectionnum: 1, groupid: 1 };
          }
          throw new Error('Moodle API error: 500');
        },
      );

      await expect(
        service.createPracticeQuiz({
          courseId: 12,
          moodleUserId: 42,
          name: 'Practice',
          questions: QUESTIONS,
        }),
      ).rejects.toThrow('Moodle API error: 500');
      expect(moodle.toPublicMoodleUrl).not.toHaveBeenCalled();
    });
  });

  describe('getPracticeAttemptReview', () => {
    it('calls local_syllentras_ai_get_practice_attempt_review over GET with quizid/userid', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        hasattempt: 1,
        attemptid: 900,
        state: 'finished',
        score: 3,
        maxscore: 4,
        questions: [],
      });

      await service.getPracticeAttemptReview(55, 42);

      expect(moodle.callMoodleApi).toHaveBeenCalledWith(
        'local_syllentras_ai_get_practice_attempt_review',
        { quizid: 55, userid: 42 },
      );
    });

    it('coerces numeric booleans and numeric strings while mapping questions', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        hasattempt: 1,
        attemptid: 900,
        state: 'finished',
        score: '3.5',
        maxscore: '4',
        questions: [
          {
            slot: 1,
            name: 'Q1',
            questiontext: 'What is 2 + 2?',
            studentanswer: '4',
            rightanswer: '4',
            iscorrect: 1,
            mark: '1',
            maxmark: 1,
          },
          {
            slot: 2,
            name: 'Q2',
            questiontext: 'What is 3 + 3?',
            studentanswer: '5',
            rightanswer: '6',
            iscorrect: 0,
            mark: 0,
            maxmark: 1,
          },
        ],
      });

      await expect(service.getPracticeAttemptReview(55, 42)).resolves.toEqual({
        hasAttempt: true,
        attemptId: 900,
        state: 'finished',
        score: 3.5,
        maxScore: 4,
        questions: [
          {
            slot: 1,
            name: 'Q1',
            questiontext: 'What is 2 + 2?',
            studentanswer: '4',
            rightanswer: '4',
            iscorrect: true,
            mark: 1,
            maxmark: 1,
          },
          {
            slot: 2,
            name: 'Q2',
            questiontext: 'What is 3 + 3?',
            studentanswer: '5',
            rightanswer: '6',
            iscorrect: false,
            mark: 0,
            maxmark: 1,
          },
        ],
      });
    });

    it('falls back to an empty state, zero scores, and no questions when fields are missing', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        hasattempt: 0,
        attemptid: 0,
      });

      await expect(service.getPracticeAttemptReview(55, 42)).resolves.toEqual({
        hasAttempt: false,
        attemptId: 0,
        state: '',
        score: 0,
        maxScore: 0,
        questions: [],
      });
    });

    it('turns non-numeric scores into 0 rather than NaN', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        hasattempt: true,
        attemptid: 900,
        state: 'inprogress',
        score: 'not-a-number',
        maxscore: null,
        questions: [
          {
            slot: 1,
            name: 'Q1',
            questiontext: 'text',
            studentanswer: '',
            rightanswer: '',
            iscorrect: false,
            mark: 'bad',
            maxmark: undefined,
          },
        ],
      });

      const review = await service.getPracticeAttemptReview(55, 42);

      expect(review.score).toBe(0);
      expect(review.maxScore).toBe(0);
      expect(review.questions[0].mark).toBe(0);
      expect(review.questions[0].maxmark).toBe(0);
      expect(Number.isNaN(review.score)).toBe(false);
    });

    it('rejects quizId < 1 and moodleUserId < 1 without calling Moodle', async () => {
      await expect(service.getPracticeAttemptReview(0, 42)).rejects.toThrow(
        'quizId must be a positive integer',
      );
      await expect(service.getPracticeAttemptReview(55, 0)).rejects.toThrow(
        'moodleUserId must be a positive integer',
      );
      expect(moodle.callMoodleApi).not.toHaveBeenCalled();
    });

    it('propagates Moodle failures unchanged', async () => {
      moodle.callMoodleApi.mockRejectedValue(
        new Error('Moodle API exception: invalidrecord'),
      );

      await expect(service.getPracticeAttemptReview(55, 42)).rejects.toThrow(
        'Moodle API exception: invalidrecord',
      );
    });
  });
});
