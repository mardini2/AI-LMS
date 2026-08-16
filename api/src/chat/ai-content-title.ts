import type { AiContentKind } from '../context/context.types';

const PREFIX_BY_KIND: Record<AiContentKind, string> = {
  study_guide: 'Study Guide: ',
  flashcards: 'Flashcards: ',
  practice_quiz: 'Quiz: ',
};

const LEADING_PREFIX_RE =
  /^(Study Guide|Flashcards|Quiz|Practice Quiz)\s*:\s*/i;

export function kindTitlePrefix(kind: AiContentKind): string {
  return PREFIX_BY_KIND[kind] ?? PREFIX_BY_KIND.study_guide;
}

/**
 * Strip kind labels from a working title so we can safely prepend
 * "Study Guide: " / "Flashcards: " / "Quiz: ".
 *
 * Handles both leading prefixes and mid-title phrases like
 * "Week 14 Study Guide: Packing…".
 */
export function stripKindTitlePrefix(name: string): string {
  let t = String(name ?? '').trim();
  // Repeat in case of stacked prefixes.
  for (let i = 0; i < 3; i++) {
    const next = t.replace(LEADING_PREFIX_RE, '').trim();
    if (next === t) {
      break;
    }
    t = next;
  }

  // Mid-title "Study Guide:" / "Flashcards:" / etc. → hyphen separator.
  t = t.replace(/\bStudy Guides?\s*:\s*/gi, ' - ');
  t = t.replace(/\bFlashcards?\s*:\s*/gi, ' - ');
  t = t.replace(/\bPractice Quizzes?\s*:\s*/gi, ' - ');
  t = t.replace(/\bQuizzes?\s*:\s*/gi, ' - ');

  // Leftover type words without a colon (e.g. "Week 14 Study Guide").
  t = t.replace(/\bStudy Guides?\b/gi, '');
  t = t.replace(/\bFlashcards?\b/gi, '');
  t = t.replace(/\bPractice Quizzes?\b/gi, '');
  t = t.replace(/\bQuizzes?\b/gi, '');

  t = t
    .replace(/\s*[-–—]\s*[-–—]+\s*/g, ' - ')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*[-–—]\s*|\s*[-–—]\s*$/g, '')
    .trim();

  return t;
}

/** Ensure the activity name uses the canonical kind prefix. */
export function withKindTitlePrefix(
  title: string,
  kind: AiContentKind,
): string {
  const bare = stripKindTitlePrefix(title) || 'Untitled';
  const prefix = kindTitlePrefix(kind);
  const maxBare = Math.max(1, 200 - prefix.length);
  const clipped =
    bare.length > maxBare ? bare.slice(0, maxBare).trim() : bare;
  return prefix + clipped;
}
