import type { CourseContextFilter } from '../context/context.types';
import type { FlashcardsPayload } from './entities/pending-action.entity';
import { scrubQuizGenerationContext } from './practice-quiz.helpers';
import {
  escapeHtml,
  markdownToSafeHtml,
  stripUnsafeText,
} from './study-guide.helpers';

export { scrubQuizGenerationContext as scrubFlashcardsContext };

export const FLASHCARD_COUNT_MIN = 8;
export const FLASHCARD_COUNT_AUTO_MAX = 30;
export const FLASHCARD_COUNT_EXPLICIT_MAX = 40;
export const FLASHCARD_COUNT_DEFAULT = 15;

export interface Flashcard {
  front: string;
  back: string;
}

export interface FlashcardsDocument {
  title: string;
  cards: Flashcard[];
}

export function clampCardCount(
  value: unknown,
  countSpecifiedByStudent: boolean,
): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return FLASHCARD_COUNT_DEFAULT;
  }
  const max = countSpecifiedByStudent
    ? FLASHCARD_COUNT_EXPLICIT_MAX
    : FLASHCARD_COUNT_AUTO_MAX;
  return Math.min(max, Math.max(FLASHCARD_COUNT_MIN, Math.round(n)));
}

export function buildFlashcardsContextFilter(
  payload: Pick<
    FlashcardsPayload,
    | 'sectionId'
    | 'sectionNumber'
    | 'sectionName'
    | 'sectionIds'
    | 'sectionNumbers'
  >,
): CourseContextFilter {
  const sectionIds = payload.sectionIds?.filter((id) => id > 0) ?? [];
  const sectionNumbers = payload.sectionNumbers ?? [];
  const hardScoped = sectionIds.length > 0 || sectionNumbers.length > 0;

  if (hardScoped) {
    return {
      sectionIds,
      sectionNumbers,
      hardSectionScope: true,
    };
  }

  return {
    sectionId: payload.sectionId,
    sectionNumber: payload.sectionNumber,
    sectionName: payload.sectionName,
  };
}

export function buildFlashcardsProposalMessage(input: {
  title: string;
  scopeSummary: string;
  cardCount: number;
  requestedCount?: number;
}): string {
  const lines = [
    `I can create a **private flashcards** Page in Moodle for you.`,
    '',
    `**${input.title}**`,
    `- **${input.cardCount} flashcards** (flip each card, then mark Got it / Missed it)`,
    `- Covers: ${input.scopeSummary}`,
    `- Practice aid only — not graded`,
    `- Placed under **AI Content** (only you and instructors can see it)`,
  ];

  if (input.requestedCount != null) {
    lines.push(
      '',
      `You asked for **${input.requestedCount}** flashcards, but I can only create decks with up to **${FLASHCARD_COUNT_EXPLICIT_MAX}** cards. This plan uses ${input.cardCount}.`,
    );
  }

  lines.push(
    '',
    'Nothing will be created until you press **Confirm**. Use **Cancel** to discard this plan.',
  );

  return lines.join('\n');
}

export function normalizeFlashcardsDocument(
  raw: Partial<FlashcardsDocument> | null | undefined,
  maxCards: number,
): FlashcardsDocument | null {
  if (!raw) {
    return null;
  }
  const title = stripUnsafeText(String(raw.title ?? '')).trim();
  const cards = (raw.cards ?? [])
    .map((c) => ({
      front: stripUnsafeText(String(c?.front ?? '')).trim(),
      back: stripUnsafeText(String(c?.back ?? '')).trim(),
    }))
    .filter((c) => c.front.length > 0 && c.back.length > 0)
    .slice(0, maxCards);

  if (!title || cards.length < 1) {
    return null;
  }

  return {
    title: title.slice(0, 200),
    cards,
  };
}

export function renderFlashcardsHtml(doc: FlashcardsDocument): string {
  const total = doc.cards.length;
  const parts: string[] = [
    '<div class="syll-fc" data-syll-fc-study="1">',
    '<p class="syll-fc-intro">Flip the card, then mark whether you got it right.</p>',
    '<div class="syll-fc-toolbar" hidden>',
    `<span class="syll-fc-progress" aria-live="polite">1 / ${total}</span>`,
    '<button type="button" class="syll-fc-btn syll-fc-btn-restart">Shuffle &amp; try again</button>',
    '</div>',
    '<div class="syll-fc-stage">',
    '<div class="syll-fc-grid">',
  ];

  doc.cards.forEach((card, index) => {
    const id = `syll-fc-${index}`;
    const indexLabel = `${index + 1} / ${total}`;
    const backHtml = markdownToSafeHtml(card.back) || escapeHtml(card.back);
    parts.push(
      `<div class="syll-fc-card" data-card-index="${index}">`,
      `<input type="checkbox" id="${id}" class="syll-fc-toggle" />`,
      `<label for="${id}" class="syll-fc-face">`,
      '<span class="syll-fc-inner">',
      '<span class="syll-fc-front">',
      `<span class="syll-fc-index">${escapeHtml(indexLabel)}</span>`,
      `<span class="syll-fc-prompt">${escapeHtml(card.front)}</span>`,
      '</span>',
      '<span class="syll-fc-back">',
      `<span class="syll-fc-index">${escapeHtml(indexLabel)}</span>`,
      `<span class="syll-fc-answer">${backHtml}</span>`,
      '</span>',
      '</span>',
      '</label>',
      '</div>',
    );
  });

  parts.push(
    '</div>',
    '</div>',
    '<div class="syll-fc-actions" hidden>',
    '<button type="button" class="syll-fc-btn syll-fc-btn-correct">Got it</button>',
    '<button type="button" class="syll-fc-btn syll-fc-btn-incorrect">Missed it</button>',
    '</div>',
    '<div class="syll-fc-results" hidden>',
    '<p class="syll-fc-score" aria-live="polite"></p>',
    '</div>',
    '<p class="syll-fc-footer"><em>Private flashcards created by Syllentras AI. This is a practice aid and is not graded.</em></p>',
    '</div>',
  );

  return parts.filter(Boolean).join('\n');
}
