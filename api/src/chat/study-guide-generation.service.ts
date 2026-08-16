import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { buildStudyGuidePrompt } from './chat.prompts';
import {
  normalizeStudyGuideDocument,
  renderStudyGuideHtml,
  type StudyGuideDocument,
} from './study-guide.helpers';
import type { LlmProvider } from './providers';
import type { LlmJsonSchema } from './providers';

const STUDY_GUIDE_SCHEMA: LlmJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    introMarkdown: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          bodyMarkdown: { type: 'string' },
        },
        required: ['heading', 'bodyMarkdown'],
      },
    },
  },
  required: ['title', 'sections'],
};

@Injectable()
export class StudyGuideGenerationService {
  private readonly logger = new Logger(StudyGuideGenerationService.name);

  async generateStudyGuide(
    input: {
      title: string;
      scopeSummary: string;
      courseMaterial: string;
    },
    llm: LlmProvider,
  ): Promise<{ document: StudyGuideDocument; html: string }> {
    const prompt = buildStudyGuidePrompt(input);
    const raw = await llm.generateJson({
      prompt,
      schema: STUDY_GUIDE_SCHEMA,
      schemaName: 'study_guide',
    });
    let parsed: Partial<StudyGuideDocument>;
    try {
      parsed = JSON.parse(raw) as Partial<StudyGuideDocument>;
    } catch {
      this.logger.warn('Study guide generation returned non-JSON');
      throw new BadRequestException('Failed to generate study guide');
    }

    const document = normalizeStudyGuideDocument({
      ...parsed,
      title: parsed.title?.trim() || input.title,
    });
    if (!document) {
      throw new BadRequestException('Failed to generate a usable study guide');
    }

    const html = renderStudyGuideHtml(document);
    if (!html.trim()) {
      throw new BadRequestException('Failed to render study guide HTML');
    }

    return { document, html };
  }
}
