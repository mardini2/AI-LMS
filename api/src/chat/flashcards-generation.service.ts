import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Type } from '@google/genai';
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
    const prompt = buildFlashcardsPrompt(input);
    const response = await this.gemini.generateContent({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            cards: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  front: { type: Type.STRING },
                  back: { type: Type.STRING },
                },
                required: ['front', 'back'],
              },
            },
          },
          required: ['title', 'cards'],
        },
      },
    });
    const raw = response.text ?? '';
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
