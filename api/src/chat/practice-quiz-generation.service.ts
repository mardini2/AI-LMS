import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { PracticeQuizQuestion } from '../context/context.types';
import { buildPracticeQuestionsPrompt } from './chat.prompts';
import {
  normalizeQuestion,
  questionDedupeKey,
  type QuizDifficulty,
} from './practice-quiz.helpers';
import type { LlmProvider, LlmJsonSchema } from './providers';

const PRACTICE_QUESTIONS_SCHEMA: LlmJsonSchema = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['multichoice', 'truefalse'],
          },
          name: { type: 'string' },
          questiontext: { type: 'string' },
          answers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                fraction: { type: 'number' },
              },
              required: ['text', 'fraction'],
            },
          },
        },
        required: ['type', 'name', 'questiontext', 'answers'],
      },
    },
  },
  required: ['questions'],
};

@Injectable()
export class PracticeQuizGenerationService {
  private readonly logger = new Logger(PracticeQuizGenerationService.name);

  async generatePracticeQuestions(
    input: {
      title: string;
      scopeSummary: string;
      questionCount: number;
      difficulty?: QuizDifficulty;
      courseMaterial: string;
    },
    llm: LlmProvider,
  ): Promise<PracticeQuizQuestion[]> {
    const parseAndNormalize = (raw: string): PracticeQuizQuestion[] => {
      const parsed = JSON.parse(raw) as { questions?: PracticeQuizQuestion[] };
      return (parsed.questions ?? [])
        .map(normalizeQuestion)
        .filter((q): q is PracticeQuizQuestion => q !== null);
    };

    const accepted: PracticeQuizQuestion[] = [];
    const seenKeys = new Set<string>();
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const needed = input.questionCount - accepted.length;
      if (needed <= 0) {
        break;
      }

      const raw = await llm.generateJson({
        prompt: buildPracticeQuestionsPrompt(input, needed, accepted),
        schema: PRACTICE_QUESTIONS_SCHEMA,
        schemaName: 'practice_questions',
      });

      let batch: PracticeQuizQuestion[] = [];
      try {
        batch = parseAndNormalize(raw);
      } catch {
        this.logger.warn(
          `Practice quiz gen attempt ${attempt + 1} returned non-JSON`,
        );
        continue;
      }

      let added = 0;
      for (const q of batch) {
        if (accepted.length >= input.questionCount) {
          break;
        }
        const key = questionDedupeKey(q.questiontext);
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        accepted.push(q);
        added += 1;
      }

      this.logger.log(
        `Practice quiz gen attempt ${attempt + 1}: +${added} unique ` +
          `(${accepted.length}/${input.questionCount} total)`,
      );

      if (accepted.length >= input.questionCount) {
        break;
      }
    }

    if (accepted.length < 1) {
      throw new BadRequestException('Failed to generate quiz questions');
    }
    if (accepted.length < input.questionCount) {
      throw new BadRequestException(
        `Could only produce ${accepted.length} of ${input.questionCount} valid concept questions. ` +
          'Try again, or ask for fewer questions.',
      );
    }

    return accepted.slice(0, input.questionCount);
  }
}
