import { Injectable, Logger } from '@nestjs/common';
import { buildTopicSuggestionsPrompt } from './chat.prompts';
import type { LlmProvider, LlmJsonSchema } from './providers';

const TOPICS_SCHEMA: LlmJsonSchema = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['topics'],
};

@Injectable()
export class TopicSuggestionsService {
  private readonly logger = new Logger(TopicSuggestionsService.name);

  async suggestTopics(
    input: {
      courseName?: string;
      sectionName?: string;
      recentTurns: Array<{ role: string; content: string }>;
    },
    llm: LlmProvider,
  ): Promise<string[]> {
    try {
      const raw = await llm.generateJson({
        prompt: buildTopicSuggestionsPrompt(input),
        schema: TOPICS_SCHEMA,
        schemaName: 'topic_suggestions',
      });
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
