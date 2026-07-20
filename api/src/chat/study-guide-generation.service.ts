import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SchemaType } from '@google/generative-ai';
import { buildStudyGuidePrompt } from './chat.prompts';
import { GeminiClient } from './gemini.client';
import {
  normalizeStudyGuideDocument,
  renderStudyGuideHtml,
  type StudyGuideDocument,
} from './study-guide.helpers';

@Injectable()
export class StudyGuideGenerationService {
  private readonly logger = new Logger(StudyGuideGenerationService.name);

  constructor(private readonly gemini: GeminiClient) {}

  async generateStudyGuide(input: {
    title: string;
    scopeSummary: string;
    courseMaterial: string;
  }): Promise<{ document: StudyGuideDocument; html: string }> {
    const model = this.gemini.getGenerativeModel({
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING },
            introMarkdown: { type: SchemaType.STRING },
            sections: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  heading: { type: SchemaType.STRING },
                  bodyMarkdown: { type: SchemaType.STRING },
                },
                required: ['heading', 'bodyMarkdown'],
              },
            },
          },
          required: ['title', 'sections'],
        },
      },
    });

    const prompt = buildStudyGuidePrompt(input);
    const result = await model.generateContent(prompt);
    const raw = result.response.text();
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
