import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Type } from '@google/genai';
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
    const prompt = buildStudyGuidePrompt(input);
    const response = await this.gemini.generateContent({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            introMarkdown: { type: Type.STRING },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  heading: { type: Type.STRING },
                  bodyMarkdown: { type: Type.STRING },
                },
                required: ['heading', 'bodyMarkdown'],
              },
            },
          },
          required: ['title', 'sections'],
        },
      },
    });
    const raw = response.text ?? '';
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
