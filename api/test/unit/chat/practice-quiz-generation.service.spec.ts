import { BadRequestException, Logger } from '@nestjs/common';
import type { PracticeQuizQuestion } from '../../../src/context/context.types';
import { PracticeQuizGenerationService } from '../../../src/chat/practice-quiz-generation.service';

type LlmDouble = {
  id: string;
  chat: jest.Mock;
  generateJson: jest.Mock;
};

function buildLlm(): LlmDouble {
  return {
    id: 'mock',
    chat: jest.fn(),
    generateJson: jest.fn(),
  };
}

/** A true/false question survives normalizeQuestion untouched (no answer shuffle). */
function tf(questiontext: string, trueIsCorrect = true): PracticeQuizQuestion {
  return {
    type: 'truefalse',
    name: 'Concept check',
    questiontext,
    answers: [
      { text: 'True', fraction: trueIsCorrect ? 1 : 0 },
      { text: 'False', fraction: trueIsCorrect ? 0 : 1 },
    ],
  };
}

function jsonOf(questions: unknown[]): string {
  return JSON.stringify({ questions });
}

const BASE_INPUT = {
  title: 'Memory Management',
  scopeSummary: 'Week 3 readings',
  questionCount: 2,
  courseMaterial: 'Frames are fixed-size blocks of physical memory.',
};

const Q1 = 'A page table maps virtual pages to physical frames.';
const Q2 = 'A TLB caches recent address translations.';
const Q3 = 'Segmentation divides memory into variable-size regions.';

describe('PracticeQuizGenerationService', () => {
  let service: PracticeQuizGenerationService;
  let llm: LlmDouble;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    service = new PracticeQuizGenerationService();
    llm = buildLlm();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('happy path', () => {
    it('returns the normalized questions from a single valid response', async () => {
      llm.generateJson.mockResolvedValue(jsonOf([tf(Q1), tf(Q2, false)]));

      const result = await service.generatePracticeQuestions(
        BASE_INPUT,
        llm as never,
      );

      expect(result).toEqual([tf(Q1), tf(Q2, false)]);
      expect(llm.generateJson).toHaveBeenCalledTimes(1);
    });

    it('truncates an over-delivering response down to the requested count', async () => {
      llm.generateJson.mockResolvedValue(
        jsonOf([tf(Q1), tf(Q2), tf(Q3), tf('Paging avoids external fragmentation.')]),
      );

      const result = await service.generatePracticeQuestions(
        BASE_INPUT,
        llm as never,
      );

      expect(result).toHaveLength(2);
      expect(result.map((q) => q.questiontext)).toEqual([Q1, Q2]);
      expect(llm.generateJson).toHaveBeenCalledTimes(1);
    });

    it('drops questions that fail validation and keeps the valid ones', async () => {
      llm.generateJson.mockResolvedValue(
        jsonOf([
          { ...tf(Q1), type: 'essay' },
          tf(Q2),
          { ...tf(Q3), answers: [{ text: 'True', fraction: 1 }] },
          tf('Frames have a fixed size.'),
        ]),
      );

      const result = await service.generatePracticeQuestions(
        BASE_INPUT,
        llm as never,
      );

      expect(result.map((q) => q.questiontext)).toEqual([
        Q2,
        'Frames have a fixed size.',
      ]);
    });
  });

  describe('prompt and request payload', () => {
    it('sends the practice-questions schema and a prompt built from the input', async () => {
      llm.generateJson.mockResolvedValue(jsonOf([tf(Q1), tf(Q2)]));

      await service.generatePracticeQuestions(
        { ...BASE_INPUT, difficulty: 'hard' },
        llm as never,
      );

      const request = llm.generateJson.mock.calls[0][0] as {
        prompt: string;
        schema: { required: string[]; properties: Record<string, unknown> };
        schemaName: string;
      };

      expect(request.schemaName).toBe('practice_questions');
      expect(request.schema.required).toEqual(['questions']);
      expect(Object.keys(request.schema.properties)).toEqual(['questions']);
      expect(request.prompt).toContain(
        'Create exactly 2 practice quiz questions for: Memory Management',
      );
      expect(request.prompt).toContain('Scope: Week 3 readings');
      expect(request.prompt).toContain('Difficulty: hard —');
      expect(request.prompt).toContain(
        'Frames are fixed-size blocks of physical memory.',
      );
      expect(request.prompt).not.toContain('already-accepted questions');
    });

    it('defaults the prompt difficulty to medium when none is supplied', async () => {
      llm.generateJson.mockResolvedValue(jsonOf([tf(Q1), tf(Q2)]));

      await service.generatePracticeQuestions(BASE_INPUT, llm as never);

      expect(llm.generateJson.mock.calls[0][0].prompt).toContain(
        'Difficulty: medium —',
      );
    });

    it('asks only for the shortfall on a retry and lists the already-accepted questions', async () => {
      llm.generateJson
        .mockResolvedValueOnce(jsonOf([tf(Q1)]))
        .mockResolvedValueOnce(jsonOf([tf(Q2), tf(Q3)]));

      const result = await service.generatePracticeQuestions(
        { ...BASE_INPUT, questionCount: 3 },
        llm as never,
      );

      expect(result).toHaveLength(3);
      expect(llm.generateJson).toHaveBeenCalledTimes(2);
      expect(llm.generateJson.mock.calls[0][0].prompt).toContain(
        'Create exactly 3 practice quiz questions',
      );

      const retryPrompt = llm.generateJson.mock.calls[1][0].prompt as string;
      expect(retryPrompt).toContain('Create exactly 2 practice quiz questions');
      expect(retryPrompt).toContain(
        'Do not repeat or paraphrase any of the following already-accepted questions:',
      );
      expect(retryPrompt).toContain(`  1. ${Q1}`);
    });
  });

  describe('parse failures', () => {
    it('retries three times and rejects when every response is malformed JSON', async () => {
      llm.generateJson.mockResolvedValue('not json at all');

      await expect(
        service.generatePracticeQuestions(BASE_INPUT, llm as never),
      ).rejects.toThrow(
        new BadRequestException('Failed to generate quiz questions'),
      );
      expect(llm.generateJson).toHaveBeenCalledTimes(3);
    });

    it('rejects JSON wrapped in markdown fences because the raw string is parsed directly', async () => {
      llm.generateJson.mockResolvedValue(
        '```json\n' + jsonOf([tf(Q1), tf(Q2)]) + '\n```',
      );

      await expect(
        service.generatePracticeQuestions(BASE_INPUT, llm as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(llm.generateJson).toHaveBeenCalledTimes(3);
    });

    it('logs a warning naming the failed attempt when a response is not JSON', async () => {
      llm.generateJson.mockResolvedValue('<html>oops</html>');

      await expect(
        service.generatePracticeQuestions(BASE_INPUT, llm as never),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(warnSpy).toHaveBeenCalledWith(
        'Practice quiz gen attempt 1 returned non-JSON',
      );
      expect(warnSpy).toHaveBeenCalledWith(
        'Practice quiz gen attempt 3 returned non-JSON',
      );
    });

    it('recovers when a later attempt returns parseable JSON', async () => {
      llm.generateJson
        .mockResolvedValueOnce('{ broken')
        .mockResolvedValueOnce(jsonOf([tf(Q1), tf(Q2)]));

      const result = await service.generatePracticeQuestions(
        BASE_INPUT,
        llm as never,
      );

      expect(result).toEqual([tf(Q1), tf(Q2)]);
      expect(llm.generateJson).toHaveBeenCalledTimes(2);
    });
  });

  describe('empty and wrong-shaped responses', () => {
    it.each([
      ['an empty questions array', JSON.stringify({ questions: [] })],
      ['a missing questions key', JSON.stringify({ items: [] })],
      ['a null questions value', JSON.stringify({ questions: null })],
      ['a bare JSON array', '[]'],
    ])('rejects after three attempts for %s', async (_label, raw) => {
      llm.generateJson.mockResolvedValue(raw);

      await expect(
        service.generatePracticeQuestions(BASE_INPUT, llm as never),
      ).rejects.toThrow(
        new BadRequestException('Failed to generate quiz questions'),
      );
      expect(llm.generateJson).toHaveBeenCalledTimes(3);
    });

    it('rejects when every returned question fails validation', async () => {
      llm.generateJson.mockResolvedValue(
        jsonOf([
          { ...tf('Which week covers paging?') },
          { ...tf(Q2), type: 'matching' },
          { ...tf(Q3), questiontext: '' },
        ]),
      );

      await expect(
        service.generatePracticeQuestions(BASE_INPUT, llm as never),
      ).rejects.toThrow(
        new BadRequestException('Failed to generate quiz questions'),
      );
    });
  });

  describe('shortfall handling', () => {
    it('rejects with a shortfall message when it produces some but not all questions', async () => {
      llm.generateJson.mockResolvedValue(jsonOf([tf(Q1)]));

      await expect(
        service.generatePracticeQuestions(
          { ...BASE_INPUT, questionCount: 4 },
          llm as never,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Could only produce 1 of 4 valid concept questions. ' +
            'Try again, or ask for fewer questions.',
        ),
      );
      expect(llm.generateJson).toHaveBeenCalledTimes(3);
    });

    it('counts a duplicate question only once', async () => {
      llm.generateJson.mockResolvedValue(
        jsonOf([tf(Q1), tf(`  ${Q1.toUpperCase()}  `)]),
      );

      await expect(
        service.generatePracticeQuestions(BASE_INPUT, llm as never),
      ).rejects.toThrow(
        new BadRequestException(
          'Could only produce 1 of 2 valid concept questions. ' +
            'Try again, or ask for fewer questions.',
        ),
      );
    });

    it('de-duplicates across attempts and keeps the first occurrence', async () => {
      llm.generateJson
        .mockResolvedValueOnce(jsonOf([tf(Q1)]))
        .mockResolvedValueOnce(jsonOf([tf(Q1.toUpperCase()), tf(Q2)]));

      const result = await service.generatePracticeQuestions(
        BASE_INPUT,
        llm as never,
      );

      expect(result.map((q) => q.questiontext)).toEqual([Q1, Q2]);
    });
  });

  describe('provider errors', () => {
    it('propagates a provider rejection instead of retrying', async () => {
      llm.generateJson.mockRejectedValue(new Error('provider down'));

      await expect(
        service.generatePracticeQuestions(BASE_INPUT, llm as never),
      ).rejects.toThrow('provider down');
      expect(llm.generateJson).toHaveBeenCalledTimes(1);
    });
  });

  describe('degenerate question counts', () => {
    it('never calls the provider when zero questions are requested', async () => {
      await expect(
        service.generatePracticeQuestions(
          { ...BASE_INPUT, questionCount: 0 },
          llm as never,
        ),
      ).rejects.toThrow(
        new BadRequestException('Failed to generate quiz questions'),
      );
      expect(llm.generateJson).not.toHaveBeenCalled();
    });
  });
});
