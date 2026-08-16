import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { buildFlashcardsPrompt } from './chat.prompts';
import {
  normalizeFlashcardsDocument,
  renderFlashcardsHtml,
  type FlashcardsDocument,
} from './flashcards.helpers';
import type { LlmProvider, LlmJsonSchema } from './providers';

const FLASHCARDS_SCHEMA: LlmJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          front: { type: 'string' },
          back: { type: 'string' },
        },
        required: ['front', 'back'],
      },
    },
  },
  required: ['title', 'cards'],
};

@Injectable()
export class FlashcardsGenerationService {
  private readonly logger = new Logger(FlashcardsGenerationService.name);

  async generateFlashcards(
    input: {
      title: string;
      scopeSummary: string;
      courseMaterial: string;
      cardCount: number;
    },
    llm: LlmProvider,
  ): Promise<{ document: FlashcardsDocument; html: string }> {
    const prompt = buildFlashcardsPrompt(input);
    const raw = await llm.generateJson({
      prompt,
      schema: FLASHCARDS_SCHEMA,
      schemaName: 'flashcards',
    });
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
