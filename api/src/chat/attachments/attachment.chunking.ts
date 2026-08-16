import {
  CHAT_ATTACHMENT_CHUNK_OVERLAP,
  CHAT_ATTACHMENT_CHUNK_SIZE,
  CHAT_ATTACHMENT_MAX_CHARS_TOTAL,
  CHAT_ATTACHMENT_MAX_CHUNKS_PER_PROMPT,
} from './attachment.constants';

export interface TextChunk {
  id?: string;
  attachmentId: string;
  filename: string;
  chunkIndex: number;
  content: string;
}

/**
 * Split extracted text into overlapping chunks for persistence / retrieval.
 */
export function chunkExtractedText(
  text: string,
  chunkSize = CHAT_ATTACHMENT_CHUNK_SIZE,
  overlap = CHAT_ATTACHMENT_CHUNK_OVERLAP,
): string[] {
  const cleaned = String(text || '')
    .replace(/\u0000/g, '')
    .trim();
  if (!cleaned) return [];
  if (cleaned.length <= chunkSize) return [cleaned];

  const safeOverlap = Math.max(0, Math.min(overlap, chunkSize - 1));
  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + chunkSize);
    chunks.push(cleaned.slice(start, end));
    if (end >= cleaned.length) break;
    start = end - safeOverlap;
  }
  return chunks;
}

function relevanceScore(content: string, terms: string[]): number {
  if (!terms.length) return 0;
  const hay = content.toLowerCase();
  return terms.reduce((score, term) => score + (hay.includes(term) ? 1 : 0), 0);
}

/**
 * Pick the most relevant chunks for a student question.
 * Always prefers newly attached files (passed first) when scores tie.
 */
export function selectRelevantChunks(
  chunks: TextChunk[],
  query: string,
  maxChunks = CHAT_ATTACHMENT_MAX_CHUNKS_PER_PROMPT,
  maxChars = CHAT_ATTACHMENT_MAX_CHARS_TOTAL,
): TextChunk[] {
  const terms = String(query || '')
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 3);

  const ranked = chunks
    .map((chunk, index) => ({
      chunk,
      index,
      score: relevanceScore(chunk.content, terms),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

  // If nothing matches terms, take earliest chunks (usually current attachments).
  const ordered =
    terms.length === 0 || ranked.every((r) => r.score === 0)
      ? chunks.map((chunk, index) => ({ chunk, index, score: 0 }))
      : ranked;

  const selected: TextChunk[] = [];
  let chars = 0;
  for (const row of ordered) {
    if (selected.length >= maxChunks) break;
    const next = row.chunk.content.length;
    if (chars + next > maxChars && selected.length > 0) break;
    selected.push(row.chunk);
    chars += next;
  }
  return selected;
}

export function formatChunksForPrompt(chunks: TextChunk[]): string {
  if (!chunks.length) return '';
  const parts = [
    'The student has attached file(s). Use the following extracted excerpts when answering:',
  ];
  for (const chunk of chunks) {
    parts.push(
      `\n### Attached file: ${chunk.filename} (chunk ${chunk.chunkIndex + 1})\n${chunk.content}`,
    );
  }
  return parts.join('\n').trim();
}

/**
 * Reject ZIP entry names that could escape the archive root (zip-slip).
 */
export function isSafeZipEntryName(name: string): boolean {
  const raw = String(name || '');
  if (!raw || raw.includes('\0')) return false;
  const normalized = raw.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    return false;
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..')) return false;
  return true;
}
