import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

export type EmbeddingTask = 'query' | 'document';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly gemini: GoogleGenAI | null;
  private readonly openai: OpenAI | null;
  private readonly geminiModel: string;
  private readonly openaiModel: string;
  private readonly queryCache = new Map<string, number[]>();

  constructor(config: ConfigService) {
    const geminiKey = (config.get<string>('GEMINI_API_KEY') ?? '').trim();
    const openaiKey = (config.get<string>('OPENAI_API_KEY') ?? '').trim();
    this.gemini = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;
    this.openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
    this.geminiModel =
      config.get<string>('RAG_GEMINI_EMBEDDING_MODEL')?.trim() ||
      'gemini-embedding-001';
    this.openaiModel =
      config.get<string>('RAG_OPENAI_EMBEDDING_MODEL')?.trim() ||
      'text-embedding-3-small';
  }

  isConfigured(): boolean {
    return Boolean(this.gemini || this.openai);
  }

  async embedQuery(text: string): Promise<number[] | null> {
    const normalized = normalizeEmbeddingText(text);
    if (!normalized || !this.isConfigured()) {
      return null;
    }

    const cached = this.queryCache.get(normalized);
    if (cached) {
      return cached;
    }

    try {
      const [embedding] = await this.embedTexts([normalized], 'query');
      if (embedding) {
        this.rememberQuery(normalized, embedding);
      }
      return embedding ?? null;
    } catch (err) {
      this.logger.warn(
        `Query embedding failed; using lexical retrieval: ${errorMessage(err)}`,
      );
      return null;
    }
  }

  async embedDocuments(texts: string[]): Promise<Array<number[] | null>> {
    const normalized = texts.map(normalizeEmbeddingText);
    if (!normalized.length || !this.isConfigured()) {
      return [];
    }
    try {
      return await this.embedTexts(normalized, 'document');
    } catch (err) {
      this.logger.warn(
        `Document embedding failed; unembedded chunks will be retried: ${errorMessage(err)}`,
      );
      return normalized.map(() => null);
    }
  }

  private async embedTexts(
    texts: string[],
    task: EmbeddingTask,
  ): Promise<number[][]> {
    if (this.gemini) {
      const vectors: number[][] = [];
      for (const batch of batches(texts, 50)) {
        const response = await this.gemini.models.embedContent({
          model: this.geminiModel,
          contents: batch.map((text) => ({ parts: [{ text }] })),
          config: { outputDimensionality: 768 },
        });
        const batchVectors = (response.embeddings ?? [])
          .map((embedding) => embedding.values ?? [])
          .filter((values) => values.length > 0);
        if (batchVectors.length !== batch.length) {
          throw new Error(
            `Gemini returned ${batchVectors.length} embeddings for ${batch.length} inputs`,
          );
        }
        vectors.push(...batchVectors);
      }
      return vectors;
    }

    if (this.openai) {
      const vectors: number[][] = [];
      for (const batch of batches(texts, 100)) {
        const response = await this.openai.embeddings.create({
          model: this.openaiModel,
          input: batch,
          encoding_format: 'float',
        });
        vectors.push(
          ...response.data
            .sort((a, b) => a.index - b.index)
            .map((item) => item.embedding),
        );
      }
      return vectors;
    }

    this.logger.debug(
      `No embedding provider configured for ${task} embeddings`,
    );
    return [];
  }

  private rememberQuery(text: string, embedding: number[]): void {
    if (this.queryCache.size >= 100) {
      const oldest = this.queryCache.keys().next().value as string | undefined;
      if (oldest) {
        this.queryCache.delete(oldest);
      }
    }
    this.queryCache.set(text, embedding);
  }
}

function normalizeEmbeddingText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 8_000);
}

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
