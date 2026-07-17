import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { PracticeQuizQuestion } from '../context/context.types';
import { buildPracticeQuestionsPrompt } from './chat.prompts';
import {
  normalizeQuestion,
  questionDedupeKey,
} from './practice-quiz.helpers';

@Injectable()
export class PracticeQuizGenerationService {
  private readonly logger = new Logger(PracticeQuizGenerationService.name);
  private readonly genAI: GoogleGenerativeAI;

  constructor(private readonly config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(
      this.config.get<string>('GEMINI_API_KEY')!,
    );
  }

  async generatePracticeQuestions(input: {
    title: string;
    scopeSummary: string;
    questionCount: number;
    courseMaterial: string;
  }): Promise<PracticeQuizQuestion[]> {
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            questions: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  type: {
                    type: SchemaType.STRING,
                    format: 'enum',
                    enum: ['multichoice', 'truefalse'],
                  },
                  name: { type: SchemaType.STRING },
                  questiontext: { type: SchemaType.STRING },
                  answers: {
                    type: SchemaType.ARRAY,
                    items: {
                      type: SchemaType.OBJECT,
                      properties: {
                        text: { type: SchemaType.STRING },
                        fraction: { type: SchemaType.NUMBER },
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
        },
      },
    });

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

      const batch = parseAndNormalize(
        (
          await model.generateContent(
            buildPracticeQuestionsPrompt(input, needed, accepted),
          )
        ).response.text(),
      );

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
