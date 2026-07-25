import { createHash } from 'node:crypto';

export interface RagSourceDocument {
  text: string;
  metadata: Record<string, unknown>;
}

export interface RagChunk {
  fingerprint: string;
  text: string;
  metadata: Record<string, unknown>;
}

export interface RankedRagItem<T> {
  item: T;
  score: number;
}

export function chunkDocuments(
  documents: RagSourceDocument[],
  maxCharacters = 1_400,
  overlapCharacters = 180,
): RagChunk[] {
  const chunks: RagChunk[] = [];

  for (const document of documents) {
    const text = normalizeText(document.text);
    if (!text) {
      continue;
    }

    const parts = splitText(text, maxCharacters, overlapCharacters);
    parts.forEach((part, chunkIndex) => {
      const metadata = { ...document.metadata, chunkIndex };
      chunks.push({
        fingerprint: fingerprint(part, metadata),
        text: part,
        metadata,
      });
    });
  }

  return chunks;
}

export function rankHybrid<T>(
  items: T[],
  question: string,
  queryEmbedding: number[] | null,
  getText: (item: T) => string,
  getEmbedding: (item: T) => number[] | null | undefined,
  getBoost: (item: T) => number = () => 0,
): RankedRagItem<T>[] {
  const terms = queryTerms(question);

  return items
    .map((item) => {
      const text = getText(item);
      const lexical = lexicalScore(text, terms);
      const boost = getBoost(item);
      const embedding = getEmbedding(item);
      // Unembedded chunks stay on pure lexical scoring so short announcements are
      // not wiped out by lecture PDFs that already have vectors.
      if (!queryEmbedding || !embedding?.length) {
        return { item, score: lexical + boost };
      }
      const semantic = Math.max(0, cosineSimilarity(queryEmbedding, embedding));
      const hybrid = semantic * 0.75 + lexical * 0.25;
      // Take the better of hybrid and lexical so keyword-strong short posts still win.
      return { item, score: Math.max(hybrid, lexical) + boost };
    })
    .sort((a, b) => b.score - a.score);
}

export function selectWithinBudget<T>(
  ranked: RankedRagItem<T>[],
  maxItems: number,
  maxCharacters: number,
  getText: (item: T) => string,
): RankedRagItem<T>[] {
  const selected: RankedRagItem<T>[] = [];
  let characters = 0;

  for (const candidate of ranked) {
    if (selected.length >= maxItems) {
      break;
    }
    const length = getText(candidate.item).length;
    if (selected.length > 0 && characters + length > maxCharacters) {
      continue;
    }
    selected.push(candidate);
    characters += length;
  }

  return selected;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

function splitText(
  text: string,
  maxCharacters: number,
  overlapCharacters: number,
): string[] {
  if (text.length <= maxCharacters) {
    return [text];
  }

  const result: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxCharacters, text.length);
    if (end < text.length) {
      const breakAt = Math.max(
        text.lastIndexOf('\n\n', end),
        text.lastIndexOf('. ', end),
        text.lastIndexOf(' ', end),
      );
      if (breakAt > start + Math.floor(maxCharacters * 0.55)) {
        end = breakAt + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) {
      result.push(chunk);
    }
    if (end >= text.length) {
      break;
    }
    start = Math.max(end - overlapCharacters, start + 1);
  }
  return result;
}

export function queryTerms(question: string): string[] {
  return [
    ...new Set(
      question
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        // Keep short numbers so "Week 3" can match Week 3 announcements.
        .filter((term) => term.length > 2 || /^\d+$/.test(term)),
    ),
  ];
}

function lexicalScore(text: string, terms: string[]): number {
  if (!terms.length) {
    return 0;
  }
  const haystack = text.toLowerCase();
  const matched = terms.filter((term) => haystack.includes(term)).length;
  return matched / terms.length;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function fingerprint(text: string, metadata: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(metadata))
    .update('\0')
    .update(text)
    .digest('hex');
}
