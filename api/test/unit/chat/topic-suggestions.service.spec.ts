import { Logger } from '@nestjs/common';
import { TopicSuggestionsService } from '../../../src/chat/topic-suggestions.service';
import type { LlmJsonRequest, LlmProvider } from '../../../src/chat/providers';

interface StubLlm {
  provider: LlmProvider;
  generateJson: jest.Mock;
  lastRequest: () => LlmJsonRequest;
}

/** Minimal LlmProvider double: only generateJson is exercised by this service. */
function stubLlm(
  respond: (request: LlmJsonRequest) => string | Promise<string>,
): StubLlm {
  const generateJson = jest.fn(async (request: LlmJsonRequest) =>
    respond(request),
  );
  const provider = {
    id: 'openai',
    displayName: 'Stub',
    isConfigured: () => true,
    chat: jest.fn(),
    generateJson,
  } as unknown as LlmProvider;

  return {
    provider,
    generateJson,
    lastRequest: () =>
      generateJson.mock.calls[generateJson.mock.calls.length - 1][0] as LlmJsonRequest,
  };
}

function jsonOf(topics: unknown): string {
  return JSON.stringify({ topics });
}

describe('TopicSuggestionsService', () => {
  let service: TopicSuggestionsService;
  let warnSpy: jest.SpyInstance;

  const baseInput = {
    courseName: 'Operating Systems',
    sectionName: 'Week 3 — Memory',
    recentTurns: [
      { role: 'user', content: 'How does paging work?' },
      { role: 'assistant', content: 'Paging splits memory into fixed frames.' },
    ],
  };

  beforeEach(() => {
    service = new TopicSuggestionsService();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('prompting the model', () => {
    it('asks for a topics array under the topic_suggestions schema name', async () => {
      const llm = stubLlm(() => jsonOf(['Paging', 'TLBs', 'Segmentation']));

      await service.suggestTopics(baseInput, llm.provider);

      const request = llm.lastRequest();
      expect(request.schemaName).toBe('topic_suggestions');
      expect(request.schema).toEqual({
        type: 'object',
        properties: {
          topics: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['topics'],
      });
    });

    it('includes the course, section, and recent turns in the prompt', async () => {
      const llm = stubLlm(() => jsonOf(['Paging']));

      await service.suggestTopics(baseInput, llm.provider);

      const { prompt } = llm.lastRequest();
      expect(prompt).toContain(
        'Suggest exactly 3 short study topics the student might want a study guide, flashcards, or practice quiz about next.',
      );
      expect(prompt).toContain('Course: Operating Systems');
      expect(prompt).toContain('Active section focus: Week 3 — Memory');
      expect(prompt).toContain('Student: How does paging work?');
      expect(prompt).toContain(
        'Assistant: Paging splits memory into fixed frames.',
      );
    });

    it('omits course and section lines and notes no history when nothing is known', async () => {
      const llm = stubLlm(() => jsonOf([]));

      await service.suggestTopics({ recentTurns: [] }, llm.provider);

      const { prompt } = llm.lastRequest();
      expect(prompt).not.toContain('Course:');
      expect(prompt).not.toContain('Active section focus:');
      expect(prompt).toContain('(no prior messages)');
    });
  });

  describe('normalizing the model response', () => {
    it('returns the parsed topics unchanged when they are already clean', async () => {
      const llm = stubLlm(() =>
        jsonOf(['Paging', 'TLB misses', 'Segmentation vs paging']),
      );

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual(['Paging', 'TLB misses', 'Segmentation vs paging']);
    });

    it('returns an empty array when the model returns an empty list', async () => {
      const llm = stubLlm(() => jsonOf([]));

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual([]);
    });

    it('caps the result at three topics', async () => {
      const llm = stubLlm(() =>
        jsonOf(['One', 'Two', 'Three', 'Four', 'Five']),
      );

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual(['One', 'Two', 'Three']);
    });

    it('trims and collapses internal whitespace', async () => {
      const llm = stubLlm(() =>
        jsonOf(['  Paging  ', 'TLB\n\nmisses', 'Page\t\tfaults']),
      );

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual(['Paging', 'TLB misses', 'Page faults']);
    });

    it('drops case-insensitive duplicates and keeps the first spelling', async () => {
      const llm = stubLlm(() =>
        jsonOf(['Paging', 'PAGING', '  paging ', 'TLB misses']),
      );

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual(['Paging', 'TLB misses']);
    });

    it('drops blank and whitespace-only entries', async () => {
      const llm = stubLlm(() =>
        jsonOf(['', '   ', '\n\t', 'Paging', 'TLB misses']),
      );

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual(['Paging', 'TLB misses']);
    });

    it('skips non-string entries without discarding the valid ones', async () => {
      const llm = stubLlm(() =>
        jsonOf([42, null, { topic: 'Paging' }, ['nested'], 'Paging', true, 'TLBs']),
      );

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual(['Paging', 'TLBs']);
    });

    it('truncates a topic to 80 characters', async () => {
      const long = 'a'.repeat(120);
      const llm = stubLlm(() => jsonOf([long]));

      const result = await service.suggestTopics(baseInput, llm.provider);

      expect(result).toEqual(['a'.repeat(80)]);
      expect(result[0]).toHaveLength(80);
    });

    it('deduplicates topics that only differ past the 80 character cut', async () => {
      const prefix = 'b'.repeat(80);
      const llm = stubLlm(() =>
        jsonOf([`${prefix}first`, `${prefix}second`, 'Paging']),
      );

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual([prefix, 'Paging']);
    });

    it('still fills three slots when duplicates appear before valid topics', async () => {
      const llm = stubLlm(() =>
        jsonOf([' Paging ', 'paging', '', 'TLBs', 'tlbs', 'Segmentation', 'Extra']),
      );

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual(['Paging', 'TLBs', 'Segmentation']);
    });

    it('returns an empty array when topics is not an array', async () => {
      const llm = stubLlm(() => jsonOf('Paging, TLBs'));

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual([]);
    });

    it('returns an empty array when the topics key is missing', async () => {
      const llm = stubLlm(() => JSON.stringify({ suggestions: ['Paging'] }));

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual([]);
    });
  });

  describe('failure handling', () => {
    it('returns an empty array and logs a warning for malformed JSON', async () => {
      const llm = stubLlm(() => 'Sure! Here are some topics: Paging, TLBs');

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain(
        'Topic suggestions failed:',
      );
    });

    it('returns an empty array and reports the provider error message', async () => {
      const llm = stubLlm(() => {
        throw new Error('provider quota exceeded');
      });

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual([]);
      expect(String(warnSpy.mock.calls[0][0])).toBe(
        'Topic suggestions failed: provider quota exceeded',
      );
    });

    it('returns an empty array when the provider rejects with a non-Error value', async () => {
      const llm = stubLlm(() => Promise.reject('socket hang up'));

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual([]);
      expect(String(warnSpy.mock.calls[0][0])).toBe(
        'Topic suggestions failed: socket hang up',
      );
    });

    it('returns an empty array when the response is valid JSON but not an object', async () => {
      const llm = stubLlm(() => 'null');

      await expect(
        service.suggestTopics(baseInput, llm.provider),
      ).resolves.toEqual([]);
    });
  });
});
