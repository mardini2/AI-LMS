import type { CourseContextFilter, PracticeQuizQuestion } from '../context/context.types';
import type { ReviewBlockDto } from './chat.types';
import type {
  PracticeQuizPayload,
  QuizDifficulty,
} from './entities/pending-action.entity';
import { escapeHtml } from './study-guide.helpers';

export type { QuizDifficulty };

export const QUIZ_QUESTION_COUNT_MIN = 5;
export const QUIZ_QUESTION_COUNT_AUTO_MAX = 15; // when AI chooses
export const QUIZ_QUESTION_COUNT_EXPLICIT_MAX = 40; // when student specifies
export const QUIZ_QUESTION_COUNT_DEFAULT = 10; // fallback if invalid

export const QUIZ_DIFFICULTY_DEFAULT: QuizDifficulty = 'medium';
export const QUIZ_DIFFICULTIES: readonly QuizDifficulty[] = [
  'easy',
  'medium',
  'hard',
  'expert',
] as const;

export function normalizeQuizDifficulty(value: unknown): QuizDifficulty {
  if (typeof value !== 'string') {
    return QUIZ_DIFFICULTY_DEFAULT;
  }
  const normalized = value.trim().toLowerCase();
  if ((QUIZ_DIFFICULTIES as readonly string[]).includes(normalized)) {
    return normalized as QuizDifficulty;
  }
  return QUIZ_DIFFICULTY_DEFAULT;
}

export function formatQuizDifficultyLabel(difficulty: QuizDifficulty): string {
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

export function buildPracticeQuizContextFilter(
  payload: Pick<
    PracticeQuizPayload,
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

  // General topic — soft / course-wide (conversation section only as a soft boost).
  return {
    sectionId: payload.sectionId,
    sectionNumber: payload.sectionNumber,
    sectionName: payload.sectionName,
  };
}

export function clampQuestionCount(
  value: unknown,
  countSpecifiedByStudent: boolean,
): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return QUIZ_QUESTION_COUNT_DEFAULT;
  }
  const max = countSpecifiedByStudent
    ? QUIZ_QUESTION_COUNT_EXPLICIT_MAX
    : QUIZ_QUESTION_COUNT_AUTO_MAX;
  return Math.min(max, Math.max(QUIZ_QUESTION_COUNT_MIN, Math.round(n)));
}

export function buildProposalMessage(input: {
  title: string;
  questionCount: number;
  scopeSummary: string;
  difficulty?: QuizDifficulty;
  requestedCount?: number;
}): string {
  const difficulty = normalizeQuizDifficulty(input.difficulty);
  const lines = [
    `I can create a **private practice quiz** in Moodle for you.`,
    '',
    `**${input.title}**`,
    `- **${input.questionCount} questions** (multiple choice and true/false)`,
    `- Difficulty: **${formatQuizDifficultyLabel(difficulty)}**`,
    `- Covers: ${input.scopeSummary}`,
    `- Practice only — will **not** count toward your course grade`,
    `- Placed under **AI Content** (only you and instructors can see it)`,
  ];

  if (input.requestedCount != null) {
    lines.push(
      '',
      `You asked for **${input.requestedCount}** questions, but I can only create quizzes with up to **${QUIZ_QUESTION_COUNT_EXPLICIT_MAX}** questions. This plan uses ${input.questionCount}.`,
    );
  }

  lines.push(
    '',
    'Nothing will be created until you press **Confirm**. Use **Cancel** to discard this plan.',
  );

  return lines.join('\n');
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildReviewMessage(input: {
  title: string;
  score: number;
  maxScore: number;
  blocks: ReviewBlockDto[];
}): string {
  const lines = [
    `### Practice quiz review — ${input.title}`,
    `**Score:** ${input.score}/${input.maxScore} · Walking through **${input.blocks.length}** wrong answer(s)`,
    '',
  ];

  input.blocks.forEach((block) => {
    const summary = escapeHtml(`${block.slot}. ❌ ${block.question}`);
    const studentAnswer = escapeHtml(block.studentAnswer);
    const rightAnswer = escapeHtml(block.rightAnswer);
    const why = escapeHtml(block.why);
    const citationTitle = escapeHtml(block.citationTitle);

    let citationHtml: string;
    if (block.citationUrl && isSafeHttpUrl(block.citationUrl)) {
      citationHtml = `<a href="${escapeHtml(block.citationUrl)}">${citationTitle}</a>`;
    } else {
      citationHtml = citationTitle;
    }

    const bodyParts = [
      `<p>You answered: <em>${studentAnswer}</em></p>`,
      `<p>Correct: <em>${rightAnswer}</em></p>`,
      `<p><strong>Why:</strong> ${why}</p>`,
      `<p><strong>From your course:</strong> ${citationHtml}</p>`,
    ];
    if (block.citationSnippet) {
      bodyParts.push(`<blockquote>${escapeHtml(block.citationSnippet)}</blockquote>`);
    }

    lines.push(
      `<details class="syllentras-review-item">`,
      `<summary class="syllentras-review-summary"><strong>${summary}</strong></summary>`,
      `<div class="syllentras-review-body">`,
      ...bodyParts,
      `</div>`,
      `</details>`,
      '',
    );
  });

  return lines.join('\n').trim();
}

export function scrubQuizGenerationContext(material: string): string {
  return material
    .replace(/(?:^|;\s*)source=https?:\/\/[^\s;]+/gi, '')
    .replace(/https?:\/\/[^\s)\]>"']+/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripLinksAndHtml(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\((https?:\/\/[^)]+|mailto:[^)]+)\)/gi, '$1')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/[^\s)\]>"']+/gi, '')
    .replace(/www\.[^\s)\]>"']+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function containsUrl(text: string): boolean {
  return /https?:\/\/|www\./i.test(text);
}

export const META_QUESTION_PATTERNS: RegExp[] = [
  /\bwhich\s+week\b/i,
  /\bwhat\s+week\b/i,
  /\bweek\s+\d+\s+of\s+the\s+course\b/i,
  /\bweek\s+\d+\s+(?:focuses|covers|introduces|is\s+about)\b/i,
  /\bcourse\s+focuses\s+on\b/i,
  /\bfinal\s+exam\s+topics?\b/i,
  /\bfinal\s+exam\b/i,
  /\bmidterm\b/i,
  /\blisted\s+as\s+a\s+topic\b/i,
  /\bunder\s+the\s+['"]?.{0,40}section\s+of\s+the\s+final\b/i,
  /\baccording\s+to\s+the\s+course\s+outline\b/i,
  /\bsyllabus\b/i,
  /\btopic[- ]list\b/i,
  /\bwhich\s+section\s+(?:covers|of\s+the\s+course)\b/i,
  /\bworth\s+\d+\s+points?\b/i,
  /\bwritten\s+response\b/i,
  /\b\(\s*WR\s*\)/i,
  /\bexam\s+includes\b/i,
  /\bmultiple\s+choice\s+section\b/i,
  /\bgrading\b/i,
  /\bhow\s+(?:is|are)\s+the\s+exam\b/i,
  /\bexam\s+(?:format|duration|weight|scoring)\b/i,
];

export function isMetaPracticeQuestion(
  questiontext: string,
  name: string,
): boolean {
  const haystack = `${name}\n${questiontext}`;
  return META_QUESTION_PATTERNS.some((re) => re.test(haystack));
}

export function questionDedupeKey(questiontext: string): string {
  return questiontext.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Fisher–Yates shuffle (mutates and returns the same array). */
export function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

function isTrueAnswerText(text: string): boolean {
  return /^true$/i.test(text.trim());
}

function isFalseAnswerText(text: string): boolean {
  return /^false$/i.test(text.trim());
}

export function normalizeQuestion(
  q: PracticeQuizQuestion,
): PracticeQuizQuestion | null {
  if (!q || (q.type !== 'multichoice' && q.type !== 'truefalse')) {
    return null;
  }

  const name = stripLinksAndHtml(q.name || 'Practice question').slice(0, 200);
  const questiontext = stripLinksAndHtml(q.questiontext || '');
  if (!questiontext) {
    return null;
  }
  if (containsUrl(name) || containsUrl(questiontext)) {
    return null;
  }
  if (isMetaPracticeQuestion(questiontext, name)) {
    return null;
  }

  const answers = (q.answers ?? [])
    .map((a) => ({
      text: stripLinksAndHtml(String(a.text ?? '')),
      fraction: Number(a.fraction) > 0 ? 1 : 0,
    }))
    .filter((a) => a.text.length > 0);

  if (answers.some((a) => containsUrl(a.text))) {
    return null;
  }

  if (q.type === 'truefalse') {
    const hasTrue = answers.some((a) => isTrueAnswerText(a.text));
    const hasFalse = answers.some((a) => isFalseAnswerText(a.text));
    if (!hasTrue || !hasFalse) {
      return null;
    }
  } else if (answers.length < 2 || !answers.some((a) => a.fraction === 1)) {
    return null;
  }

  if (q.type === 'multichoice') {
    shuffleInPlace(answers);
  }

  return {
    type: q.type,
    name: name || 'Practice question',
    questiontext,
    answers,
  };
}
