import { BadRequestException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FlashcardsGenerationService } from '../../../src/chat/flashcards-generation.service';

interface JsonRequest {
  prompt: string;
  schema?: { required?: string[] };
  schemaName?: string;
}

function makeLlm(respond: () => Promise<string>) {
  return {
    id: 'gemini',
    displayName: 'Mock provider',
    isConfigured: () => true,
    chat: jest.fn(),
    generateJson: jest.fn(async (_request: JsonRequest) => respond()),
  };
}

function llmReturning(raw: string) {
  return makeLlm(() => Promise.resolve(raw));
}

const INPUT = {
  title: 'Key terms',
  scopeSummary: 'Week 3 readings',
  courseMaterial: 'A TLB caches address translations.',
  cardCount: 12,
};

function cardsJson(count: number, title = 'Deck title') {
  return JSON.stringify({
    title,
    cards: Array.from({ length: count }, (_, i) => ({
      front: `Q${i}`,
      back: `A${i}`,
    })),
  });
}

describe('FlashcardsGenerationService', () => {
  let service: FlashcardsGenerationService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new FlashcardsGenerationService();
  });

  describe('the request sent to the provider', () => {
    it('asks for the flashcards schema with title and cards required', async () => {
      const llm = llmReturning(cardsJson(12));

      await service.generateFlashcards(INPUT, llm as never);

      expect(llm.generateJson).toHaveBeenCalledTimes(1);
      const request = llm.generateJson.mock.calls[0][0];
      expect(request.schemaName).toBe('flashcards');
      expect(request.schema?.required).toEqual(['title', 'cards']);
    });

    it('asks for exactly the requested number of cards and passes the scope', async () => {
      const llm = llmReturning(cardsJson(12));

      await service.generateFlashcards(INPUT, llm as never);

      const prompt = llm.generateJson.mock.calls[0][0].prompt;
      expect(prompt).toContain('Create exactly 12 flashcards for: Key terms');
      expect(prompt).toContain('Scope: Week 3 readings');
      expect(prompt).toContain('A TLB caches address translations.');
    });

    it('truncates very long course material before prompting', async () => {
      const llm = llmReturning(cardsJson(2));

      await service.generateFlashcards(
        {
          ...INPUT,
          cardCount: 2,
          courseMaterial: 'B'.repeat(60000) + 'TAIL_SHOULD_BE_CUT',
        },
        llm as never,
      );

      const prompt = llm.generateJson.mock.calls[0][0].prompt;
      expect(prompt).toContain('B'.repeat(60000));
      expect(prompt).not.toContain('TAIL_SHOULD_BE_CUT');
    });
  });

  describe('successful generation', () => {
    it('returns the normalized deck and rendered HTML', async () => {
      const llm = llmReturning(
        JSON.stringify({
          title: 'Memory terms',
          cards: [
            { front: 'What is a TLB?', back: 'A translation cache' },
            { front: 'What is a frame?', back: 'A physical page' },
          ],
        }),
      );

      const result = await service.generateFlashcards(
        { ...INPUT, cardCount: 2 },
        llm as never,
      );

      expect(result.document).toEqual({
        title: 'Memory terms',
        cards: [
          { front: 'What is a TLB?', back: 'A translation cache' },
          { front: 'What is a frame?', back: 'A physical page' },
        ],
      });
      expect(result.html).toContain(
        '<div class="syll-fc" data-syll-fc-study="1">',
      );
      expect(result.html).toContain('Card: 1 / 2');
      expect(result.html).toContain(
        '<span class="syll-fc-prompt">What is a TLB?</span>',
      );
      expect(result.html).toContain(
        '<span class="syll-fc-answer"><p>A physical page</p></span>',
      );
    });

    it('trims the deck to the requested card count when the model overshoots', async () => {
      const llm = llmReturning(cardsJson(20));

      const result = await service.generateFlashcards(
        { ...INPUT, cardCount: 9 },
        llm as never,
      );

      expect(result.document.cards).toHaveLength(9);
      expect(result.document.cards[8]).toEqual({ front: 'Q8', back: 'A8' });
      expect(result.html).toContain('Card: 1 / 9');
      expect(result.html).not.toContain('Q9');
    });

    it('accepts an under-sized deck without padding it', async () => {
      const llm = llmReturning(cardsJson(3));

      const result = await service.generateFlashcards(INPUT, llm as never);

      expect(result.document.cards).toHaveLength(3);
      expect(result.html).toContain('Card: 1 / 3');
    });

    it('falls back to the requested title when the model returns a blank one', async () => {
      const llm = llmReturning(cardsJson(2, '  '));

      const result = await service.generateFlashcards(
        { ...INPUT, cardCount: 2 },
        llm as never,
      );

      expect(result.document.title).toBe('Key terms');
    });

    it('drops half-filled cards from the model output', async () => {
      const llm = llmReturning(
        JSON.stringify({
          title: 'Partial',
          cards: [
            { front: 'Good', back: 'Answer' },
            { front: 'No back', back: '' },
            { back: 'No front' },
          ],
        }),
      );

      const result = await service.generateFlashcards(INPUT, llm as never);

      expect(result.document.cards).toEqual([
        { front: 'Good', back: 'Answer' },
      ]);
      expect(result.html).not.toContain('No front');
    });

    it('scrubs links out of card text before rendering', async () => {
      const llm = llmReturning(
        JSON.stringify({
          title: 'Links',
          cards: [{ front: 'Where?', back: 'At https://evil.com/x always' }],
        }),
      );

      const result = await service.generateFlashcards(INPUT, llm as never);

      expect(result.document.cards[0].back).toBe('At always');
      expect(result.html).not.toContain('evil.com');
    });
  });

  describe('failure paths', () => {
    it('rejects non-JSON output with a BadRequestException', async () => {
      const llm = llmReturning('Here are your flashcards!');

      await expect(
        service.generateFlashcards(INPUT, llm as never),
      ).rejects.toThrow(new BadRequestException('Failed to generate flashcards'));
    });

    it('rejects markdown-fenced JSON because fences are not stripped', async () => {
      const llm = llmReturning('```json\n' + cardsJson(10) + '\n```');

      await expect(
        service.generateFlashcards(INPUT, llm as never),
      ).rejects.toThrow('Failed to generate flashcards');
    });

    it('rejects empty output', async () => {
      const llm = llmReturning('');

      await expect(
        service.generateFlashcards(INPUT, llm as never),
      ).rejects.toThrow('Failed to generate flashcards');
    });

    it('rejects an object with no cards key', async () => {
      const llm = llmReturning(JSON.stringify({ title: 'Only a title' }));

      await expect(
        service.generateFlashcards(INPUT, llm as never),
      ).rejects.toThrow('Failed to generate usable flashcards');
    });

    it('surfaces a TypeError for JSON null, which is not guarded', async () => {
      const llm = llmReturning('null');

      await expect(
        service.generateFlashcards(INPUT, llm as never),
      ).rejects.toBeInstanceOf(TypeError);
    });

    it('rejects an empty cards array', async () => {
      const llm = llmReturning(JSON.stringify({ title: 'T', cards: [] }));

      await expect(
        service.generateFlashcards(INPUT, llm as never),
      ).rejects.toThrow('Failed to generate usable flashcards');
    });

    it('rejects cards with the wrong shape', async () => {
      const llm = llmReturning(
        JSON.stringify({ title: 'T', cards: [{ question: 'q', answer: 'a' }] }),
      );

      await expect(
        service.generateFlashcards(INPUT, llm as never),
      ).rejects.toThrow('Failed to generate usable flashcards');
    });

    it('rejects when the requested card count leaves no cards', async () => {
      const llm = llmReturning(cardsJson(5));

      await expect(
        service.generateFlashcards({ ...INPUT, cardCount: 0 }, llm as never),
      ).rejects.toThrow('Failed to generate usable flashcards');
    });

    it('propagates provider errors untouched', async () => {
      const llm = makeLlm(() => Promise.reject(new Error('quota exceeded')));

      await expect(
        service.generateFlashcards(INPUT, llm as never),
      ).rejects.toThrow('quota exceeded');
      await expect(
        service.generateFlashcards(INPUT, llm as never),
      ).rejects.not.toBeInstanceOf(BadRequestException);
    });
  });
});
