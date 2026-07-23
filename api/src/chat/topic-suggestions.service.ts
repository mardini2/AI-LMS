import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import { buildTopicSuggestionsPrompt } from './chat.prompts';
import { GeminiClient } from './gemini.client';

@Injectable()
export class TopicSuggestionsService {
  private readonly logger = new Logger(TopicSuggestionsService.name);

  constructor(private readonly gemini: GeminiClient) {}

  async suggestTopics(input: {
    courseName?: string;
    sectionName?: string;
    recentTurns: Array<{ role: string; content: string }>;
  }): Promise<string[]> {
    try {
      const response = await this.gemini.generateContent({
        contents: buildTopicSuggestionsPrompt(input),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              topics: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['topics'],
          },
        },
      });

      const raw = response.text ?? '';
      const parsed = JSON.parse(raw) as { topics?: unknown };
      return normalizeTopics(parsed.topics);
    } catch (err) {
      this.logger.warn(
        `Topic suggestions failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }
}

function normalizeTopics(topics: unknown): string[] {
  if (!Array.isArray(topics)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of topics) {
    if (typeof raw !== 'string') continue;
    const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 3) break;
  }
  return out;
}
