import { BadRequestException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { StudyGuideGenerationService } from '../../../src/chat/study-guide-generation.service';

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
  title: 'Paging and TLBs',
  scopeSummary: 'Week 5 lecture notes',
  courseMaterial: 'Pages map virtual addresses to frames.',
};

const GOOD_JSON = JSON.stringify({
  title: 'Paging Deep Dive',
  introMarkdown: 'Read this before the exam.',
  sections: [
    { heading: 'Address translation', bodyMarkdown: 'Virtual to physical.' },
    { heading: 'TLB', bodyMarkdown: 'Caches recent translations.' },
  ],
});

describe('StudyGuideGenerationService', () => {
  let service: StudyGuideGenerationService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new StudyGuideGenerationService();
  });

  describe('the request sent to the provider', () => {
    it('asks for the study_guide schema with title and sections required', async () => {
      const llm = llmReturning(GOOD_JSON);

      await service.generateStudyGuide(INPUT, llm as never);

      expect(llm.generateJson).toHaveBeenCalledTimes(1);
      const request = llm.generateJson.mock.calls[0][0];
      expect(request.schemaName).toBe('study_guide');
      expect(request.schema?.required).toEqual(['title', 'sections']);
    });

    it('builds a prompt carrying the title, scope and course material', async () => {
      const llm = llmReturning(GOOD_JSON);

      await service.generateStudyGuide(INPUT, llm as never);

      const prompt = llm.generateJson.mock.calls[0][0].prompt;
      expect(prompt).toContain(
        'Create a structured study guide for: Paging and TLBs',
      );
      expect(prompt).toContain('Scope: Week 5 lecture notes');
      expect(prompt).toContain('Pages map virtual addresses to frames.');
      expect(prompt).toContain('Course material:');
    });

    it('truncates very long course material before prompting', async () => {
      const llm = llmReturning(GOOD_JSON);

      await service.generateStudyGuide(
        {
          ...INPUT,
          courseMaterial: 'A'.repeat(60000) + 'TAIL_SHOULD_BE_CUT',
        },
        llm as never,
      );

      const prompt = llm.generateJson.mock.calls[0][0].prompt;
      expect(prompt).toContain('A'.repeat(60000));
      expect(prompt).not.toContain('TAIL_SHOULD_BE_CUT');
    });
  });

  describe('successful generation', () => {
    it('returns the normalized document and rendered HTML', async () => {
      const llm = llmReturning(GOOD_JSON);

      const result = await service.generateStudyGuide(INPUT, llm as never);

      expect(result.document).toEqual({
        title: 'Paging Deep Dive',
        introMarkdown: 'Read this before the exam.',
        sections: [
          {
            heading: 'Address translation',
            bodyMarkdown: 'Virtual to physical.',
          },
          { heading: 'TLB', bodyMarkdown: 'Caches recent translations.' },
        ],
      });
      expect(result.html).toContain('<div class="syll-sg" data-syll-sg="1">');
      expect(result.html).toContain('<h2>Address translation</h2>');
      expect(result.html).toContain('<p>Caches recent translations.</p>');
      expect(result.html).toContain(
        '<em>Private study guide created by Syllentras AI.',
      );
    });

    it('falls back to the requested title when the model returns a blank one', async () => {
      const llm = llmReturning(
        JSON.stringify({
          title: '   ',
          sections: [{ heading: 'H', bodyMarkdown: 'B' }],
        }),
      );

      const result = await service.generateStudyGuide(INPUT, llm as never);

      expect(result.document.title).toBe('Paging and TLBs');
    });

    it('falls back to the requested title when the model omits it', async () => {
      const llm = llmReturning(
        JSON.stringify({ sections: [{ heading: 'H', bodyMarkdown: 'B' }] }),
      );

      const result = await service.generateStudyGuide(INPUT, llm as never);

      expect(result.document.title).toBe('Paging and TLBs');
    });

    it('keeps only the sections that have both a heading and a body', async () => {
      const llm = llmReturning(
        JSON.stringify({
          title: 'Mixed',
          sections: [
            { heading: 'Keep', bodyMarkdown: 'Body' },
            { heading: 'Drop' },
            { bodyMarkdown: 'Orphan' },
          ],
        }),
      );

      const result = await service.generateStudyGuide(INPUT, llm as never);

      expect(result.document.sections).toEqual([
        { heading: 'Keep', bodyMarkdown: 'Body' },
      ]);
      expect(result.html).not.toContain('Orphan');
    });

    it('scrubs links out of model text before rendering', async () => {
      const llm = llmReturning(
        JSON.stringify({
          title: 'Links',
          sections: [
            {
              heading: 'Sources',
              bodyMarkdown: 'Read https://evil.com/x for more',
            },
          ],
        }),
      );

      const result = await service.generateStudyGuide(INPUT, llm as never);

      expect(result.document.sections[0].bodyMarkdown).toBe('Read for more');
      expect(result.html).not.toContain('evil.com');
    });
  });

  describe('failure paths', () => {
    it('rejects non-JSON output with a BadRequestException', async () => {
      const llm = llmReturning('Sure! Here is your study guide.');

      await expect(
        service.generateStudyGuide(INPUT, llm as never),
      ).rejects.toThrow(
        new BadRequestException('Failed to generate study guide'),
      );
    });

    it('rejects markdown-fenced JSON because fences are not stripped', async () => {
      const llm = llmReturning('```json\n' + GOOD_JSON + '\n```');

      await expect(
        service.generateStudyGuide(INPUT, llm as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.generateStudyGuide(INPUT, llm as never),
      ).rejects.toThrow('Failed to generate study guide');
    });

    it('rejects empty output', async () => {
      const llm = llmReturning('');

      await expect(
        service.generateStudyGuide(INPUT, llm as never),
      ).rejects.toThrow('Failed to generate study guide');
    });

    it('rejects an object with no sections key', async () => {
      const llm = llmReturning(JSON.stringify({ title: 'Only a title' }));

      await expect(
        service.generateStudyGuide(INPUT, llm as never),
      ).rejects.toThrow('Failed to generate a usable study guide');
    });

    it('surfaces a TypeError for JSON null, which is not guarded', async () => {
      const llm = llmReturning('null');

      await expect(
        service.generateStudyGuide(INPUT, llm as never),
      ).rejects.toBeInstanceOf(TypeError);
    });

    it('rejects JSON with an empty sections array', async () => {
      const llm = llmReturning(JSON.stringify({ title: 'T', sections: [] }));

      await expect(
        service.generateStudyGuide(INPUT, llm as never),
      ).rejects.toThrow('Failed to generate a usable study guide');
    });

    it('rejects JSON whose sections have the wrong shape', async () => {
      const llm = llmReturning(
        JSON.stringify({ title: 'T', sections: [{ foo: 'bar' }, {}] }),
      );

      await expect(
        service.generateStudyGuide(INPUT, llm as never),
      ).rejects.toThrow('Failed to generate a usable study guide');
    });

    it('propagates provider errors untouched', async () => {
      const llm = makeLlm(() => Promise.reject(new Error('provider down')));

      await expect(
        service.generateStudyGuide(INPUT, llm as never),
      ).rejects.toThrow('provider down');
      await expect(
        service.generateStudyGuide(INPUT, llm as never),
      ).rejects.not.toBeInstanceOf(BadRequestException);
    });
  });
});
