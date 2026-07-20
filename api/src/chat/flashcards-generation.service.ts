import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SchemaType } from '@google/generative-ai';
import { buildFlashcardsPrompt } from './chat.prompts';
import { GeminiClient } from './gemini.client';
import {
  normalizeFlashcardsDocument,
  renderFlashcardsHtml,
  type FlashcardsDocument,
} from './flashcards.helpers';

@Injectable()
export class FlashcardsGenerationService {
  private readonly logger = new Logger(FlashcardsGenerationService.name);

  constructor(private readonly gemini: GeminiClient) {}

  async generateFlashcards(input: {
    title: string;
    scopeSummary: string;
    courseMaterial: string;
    cardCount: number;
  }): Promise<{ document: FlashcardsDocument; html: string }> {
    const model = this.gemini.getGenerativeModel({
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING },
            cards: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  front: { type: SchemaType.STRING },
                  back: { type: SchemaType.STRING },
                },
                required: ['front', 'back'],
              },
            },
          },
          required: ['title', 'cards'],
        },
      },
    });

    const prompt = buildFlashcardsPrompt(input);
    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    let parsed: Partial<FlashcardsDocument>;
    try {
      parsed = JSON.parse(raw) as Partial<FlashcardsDocument>;
    } catch {
      this.logger.warn('Flashcards generation returned non-JSON');
      throw new BadRequestException('Failed to generate flashcards');
    }

    const document = normalizeFlashcardsDocument(
      {
        ...parsed,
        title: parsed.title?.trim() || input.title,
      },
      input.cardCount,
    );
    if (!document) {
      throw new BadRequestException('Failed to generate usable flashcards');
    }

    const html = renderFlashcardsHtml(document);
    if (!html.trim()) {
      throw new BadRequestException('Failed to render flashcards HTML');
    }

    return { document, html };
  }
}
