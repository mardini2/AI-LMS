import { Type, type FunctionDeclaration } from '@google/genai';
import type { PracticeQuizQuestion } from '../context/context.types';
import {
  QUIZ_DIFFICULTIES,
  QUIZ_DIFFICULTY_DEFAULT,
  QUIZ_QUESTION_COUNT_AUTO_MAX,
  QUIZ_QUESTION_COUNT_EXPLICIT_MAX,
  QUIZ_QUESTION_COUNT_MIN,
  normalizeQuizDifficulty,
  type QuizDifficulty,
} from './practice-quiz.helpers';
import {
  FLASHCARD_COUNT_AUTO_MAX,
  FLASHCARD_COUNT_EXPLICIT_MAX,
  FLASHCARD_COUNT_MIN,
} from './flashcards.helpers';

export const PROPOSE_PRACTICE_QUIZ_TOOL: FunctionDeclaration = {
  name: 'propose_practice_quiz',
  description:
    'Propose creating a private Moodle practice quiz for the student. Call only when they clearly ask to create/make/generate a practice quiz in Moodle. Do not call for ordinary study questions, study guides, or flashcards.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'Short working title for the practice quiz',
      },
      scopeSummary: {
        type: Type.STRING,
        description:
          'What the quiz covers, e.g. "Weeks 1–4: variables, loops, and arrays"',
      },
      questionCount: {
        type: Type.INTEGER,
        description: `Number of questions to generate. If the student did not specify a count, choose a sensible number between ${QUIZ_QUESTION_COUNT_MIN} and ${QUIZ_QUESTION_COUNT_AUTO_MAX}. If they explicitly asked for a count, pass their requested number even if it exceeds ${QUIZ_QUESTION_COUNT_EXPLICIT_MAX} (the system will cap it).`,
      },
      countSpecifiedByStudent: {
        type: Type.BOOLEAN,
        description:
          'True only when the student explicitly stated how many questions they want. False when you are choosing the count yourself.',
      },
      difficulty: {
        type: Type.STRING,
        format: 'enum',
        enum: [...QUIZ_DIFFICULTIES],
        description: `Whole-quiz difficulty. Use the student's stated level when clear (easy/medium/hard/expert). Otherwise use ${QUIZ_DIFFICULTY_DEFAULT}.`,
      },
    },
    required: [
      'title',
      'scopeSummary',
      'questionCount',
      'countSpecifiedByStudent',
      'difficulty',
    ],
  },
};

export const PROPOSE_STUDY_GUIDE_TOOL: FunctionDeclaration = {
  name: 'propose_study_guide',
  description:
    'Propose creating a private Moodle study guide Page for the student. Call only when they clearly ask to create/make/generate a study guide, study notes, or review sheet in Moodle. Do not call for flashcards, practice quizzes, or ordinary Q&A.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'Short working title for the study guide',
      },
      scopeSummary: {
        type: Type.STRING,
        description:
          'What the guide covers, e.g. "Weeks 13–14: packing and rootkits"',
      },
    },
    required: ['title', 'scopeSummary'],
  },
};

export const PROPOSE_FLASHCARDS_TOOL: FunctionDeclaration = {
  name: 'propose_flashcards',
  description:
    'Propose creating a private Moodle flashcards Page for the student. Call only when they clearly ask to create/make/generate flashcards or a flashcard deck in Moodle. Do not call for study guides, practice quizzes, or ordinary Q&A.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'Short working title for the flashcard set',
      },
      scopeSummary: {
        type: Type.STRING,
        description:
          'What the flashcards cover, e.g. "Weeks 13–14: packing and rootkits"',
      },
      cardCount: {
        type: Type.INTEGER,
        description: `Number of flashcards to generate. If the student did not specify a count, choose a sensible number between ${FLASHCARD_COUNT_MIN} and ${FLASHCARD_COUNT_AUTO_MAX}. If they explicitly asked for a count, pass their requested number even if it exceeds ${FLASHCARD_COUNT_EXPLICIT_MAX} (the system will cap it).`,
      },
      countSpecifiedByStudent: {
        type: Type.BOOLEAN,
        description:
          'True only when the student explicitly stated how many flashcards they want. False when you are choosing the count yourself.',
      },
    },
    required: [
      'title',
      'scopeSummary',
      'cardCount',
      'countSpecifiedByStudent',
    ],
  },
};

export function buildSystemPrompt(ctx: {
  courseId: number;
  courseName?: string;
  userFirstName?: string;
  enrolledCourses: string[];
  conversationTitle?: string;
  conversationType?: string;
  sectionName?: string;
  courseMaterial: string;
  canProposeContent: boolean;
}): string {
  const lines: string[] = [
    "You are Syllentras AI, a helpful teaching assistant. Answer the student's questions clearly and accurately.",
    'Format responses with markdown (headings, bold, lists) when it improves readability.',
    'Answer the student directly. Do not repeat welcome messages or introduce yourself unless the student asks who you are.',
    'Stay focused on helping the student with their coursework and learning for the current course and enrolled courses.',
    'Only answer questions related to course content, enrolled courses, or study skills that support this course (clarifying concepts, study guides, flashcards, practice quizzes).',
    'If the student asks something off-topic or unrelated to the course (e.g. cooking, recipes, entertainment, general life advice), politely decline. Do not partially fulfill the request.',
    'When declining, briefly say you can only help with course content, then invite a course-related question or offer study tools when available.',
    'Do not help with cheating: do not provide exam answer keys, graded assignment solutions, or ways to bypass academic integrity. Offer legitimate study help instead (explanations, study guides, flashcards, practice quizzes).',
    'Refuse harmful or dangerous requests (weapons, explosives, illegal activity, etc.) and redirect to course help.',
    'If the student sends a short greeting or opener with no real question (e.g. "hi", "hey", "hello", "what\'s up"), or asks what you can help with / what you can do, do not reply with only a generic greeting.',
    'Instead, briefly welcome them and explain how you can help with the current course, grounded in the course name and material when available. Include concrete topic examples from the course material when possible. Keep it scannable: short intro, then a short bullet/list of ways you can help, then invite them to pick a topic or ask for a study tool. Do not invent course topics that are not supported by the course material or course name.',
  ];

  if (ctx.canProposeContent) {
    lines.push(
      'In greeting and capability replies, mention that you can answer course questions and generate study guides, flashcards, or practice quizzes tailored to the course material.',
      'When the student clearly asks you to create/make/generate a study guide, study notes, or review sheet in Moodle, call the propose_study_guide tool with a sensible title and scopeSummary.',
      'When the student clearly asks you to create/make/generate flashcards or a flashcard deck in Moodle, call the propose_flashcards tool with a sensible title, scopeSummary, and cardCount.',
      `If the student did not say how many flashcards they want, choose a good count between ${FLASHCARD_COUNT_MIN} and ${FLASHCARD_COUNT_AUTO_MAX} and set countSpecifiedByStudent to false.`,
      `If the student explicitly stated a flashcard count, pass their requested number (even if above ${FLASHCARD_COUNT_EXPLICIT_MAX}) and set countSpecifiedByStudent to true.`,
      'When the student clearly asks you to create/make/generate a practice quiz in Moodle, call the propose_practice_quiz tool with a sensible title, scopeSummary, questionCount, and difficulty.',
      `If the student did not say how many questions they want, choose a good count between ${QUIZ_QUESTION_COUNT_MIN} and ${QUIZ_QUESTION_COUNT_AUTO_MAX} and set countSpecifiedByStudent to false.`,
      `If the student explicitly stated a question count, pass their requested number (even if above ${QUIZ_QUESTION_COUNT_EXPLICIT_MAX}) and set countSpecifiedByStudent to true. Still call the tool — the system will cap the count and explain the limit in the proposal.`,
      `For difficulty, use easy, medium, hard, or expert when the student clearly asks for a level; otherwise use ${QUIZ_DIFFICULTY_DEFAULT}.`,
      'Do not call more than one create tool in one turn. Pick study guide vs flashcards vs quiz based on the request.',
      'Do not claim a study guide, flashcards, or quiz already exist. Creation happens only after the student confirms in the UI.',
      'For normal Q&A that is not a create request, answer normally without calling a tool.',
    );
  } else {
    lines.push(
      'You cannot create Moodle content from this context (missing course, user, or material). If asked, explain they need to open a course page while logged in.',
      'In greeting and capability replies, describe how you can help with course Q&A, and explain they need to open a course page while logged in to create study guides, flashcards, or practice quizzes.',
    );
  }

  if (ctx.userFirstName?.trim()) {
    const firstName = ctx.userFirstName.trim();
    lines.push(
      `The student's first name is ${firstName}. Use their name where it feels natural and warm — especially in greetings, capability overviews, off-topic redirects, and closing invites (e.g. "Hi ${firstName}," or "What would you like to work on, ${firstName}?").`,
      `Do not force their name into every reply. For ordinary course Q&A and tool proposals, answer directly without repeating ${firstName} unless it adds a genuine personal touch.`,
    );
  }

  if (ctx.enrolledCourses.length > 0) {
    lines.push(
      `The student is enrolled in: ${ctx.enrolledCourses.join(', ')}.`,
    );
  }

  if (ctx.courseId > 1 && ctx.courseName) {
    lines.push(
      `The student is currently viewing the course: ${ctx.courseName}.`,
    );
    lines.push(
      'Use the course material below as your primary source. If the answer is not in the material but the question is still on-topic for this course, say so honestly and give limited course-topic help or ask which week/section to focus on. Never pivot to unrelated topics.',
    );
  } else if (ctx.courseId > 1) {
    lines.push(`The student is currently viewing course ID ${ctx.courseId}.`);
  } else {
    lines.push(
      'The student is on the dashboard or site home, not a specific course page. Help with enrolled courses or getting into a course page. Do not answer unrelated general-knowledge questions.',
    );
  }

  if (ctx.conversationType === 'section' && ctx.sectionName) {
    lines.push(
      `The active conversation is specifically for the course section: ${ctx.sectionName}. Keep the answer focused on that section when possible, but use other course material when it helps.`,
    );
  } else if (ctx.conversationTitle) {
    lines.push(`The active conversation is: ${ctx.conversationTitle}.`);
  }

  if (ctx.courseMaterial) {
    lines.push('', 'Course Material:', '---', ctx.courseMaterial, '---');
  }

  return lines.join('\n');
}

export type GeminiHistoryEntry = {
  role: 'user' | 'model';
  parts: [{ text: string }];
};

/** Gemini requires history to start with 'user' and alternate user/model turns. */
export function toGeminiHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): GeminiHistoryEntry[] {
  const geminiHistory: GeminiHistoryEntry[] = [];

  for (const m of history) {
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';

    if (geminiHistory.length === 0 && role === 'model') {
      continue;
    }

    const last = geminiHistory[geminiHistory.length - 1];
    if (last?.role === role) {
      last.parts[0].text += `\n${m.content}`;
      continue;
    }

    geminiHistory.push({ role, parts: [{ text: m.content }] });
  }

  return geminiHistory;
}

export function buildPracticeQuestionsPrompt(
  input: {
    title: string;
    scopeSummary: string;
    courseMaterial: string;
    difficulty?: QuizDifficulty;
  },
  count: number,
  alreadyAccepted: PracticeQuizQuestion[],
): string {
  const difficulty = normalizeQuizDifficulty(input.difficulty);
  const difficultyGuidance: Record<QuizDifficulty, string> = {
    easy: 'Easy: focus on recall and definitions; ask for direct facts clearly stated in the material. Avoid multi-step reasoning.',
    medium:
      'Medium: ask for straightforward application of one concept from the material in a simple scenario.',
    hard: 'Hard: use multi-step reasoning, compare/contrast, or common pitfalls grounded in the material.',
    expert:
      'Expert: synthesize across ideas or use edge cases from the material only. Do not invent topics or facts not present in the course material.',
  };

  const qualityRules = [
    'Question quality rules:',
    '- Test concepts, procedures, definitions, and trade-offs from the technical material.',
    '- Prefer substantive readings (notes/PDFs) over exam topic lists or syllabi when both appear.',
    '- Forbidden: which week/section covered a topic; final-exam / syllabus / topic-list membership; "according to the course outline"; calendar or admin trivia.',
    '- Forbidden: exam logistics — format (MC/WR), point values, duration, grading weights, "the exam includes…", how the exam is scored. Technical questions about subject matter are fine; questions about the exam as an assessment are not.',
    '- Forbidden: URLs, HTML, markdown links, or "click here" anywhere in question or answer text. Plain text only.',
  ];

  const lines = [
    `Create exactly ${count} practice quiz questions for: ${input.title}`,
    `Scope: ${input.scopeSummary}`,
    `Difficulty: ${difficulty} — ${difficultyGuidance[difficulty]}`,
    'Match every question to that difficulty level. Keep the whole set at that level (do not mix easy and expert in one batch).',
    'Use only multiple choice (exactly one correct answer, fraction 1.0) or true/false.',
    'For true/false, answers must be exactly two entries with text "True" and "False".',
    'For multichoice, provide 3–4 options; exactly one answer has fraction 1.0, others 0.',
    'Ground every question strictly in the course material below.',
    '',
    ...qualityRules,
  ];

  if (alreadyAccepted.length > 0) {
    lines.push(
      '- These questions are replacements for rejected ones. Do not repeat or paraphrase any of the following already-accepted questions:',
      ...alreadyAccepted.map((q, i) => `  ${i + 1}. ${q.questiontext}`),
    );
  }

  lines.push(
    '',
    'Course material:',
    '---',
    input.courseMaterial.slice(0, 60000),
    '---',
  );
  return lines.join('\n');
}

export function buildStudyGuidePrompt(input: {
  title: string;
  scopeSummary: string;
  courseMaterial: string;
}): string {
  return [
    `Create a structured study guide for: ${input.title}`,
    `Scope: ${input.scopeSummary}`,
    'Return JSON with title, optional introMarkdown, and sections (heading + bodyMarkdown).',
    'Write clear study notes: key concepts, procedures, definitions, trade-offs, and common pitfalls.',
    'Prefer substantive readings (notes/PDFs) over exam topic lists or syllabi when both appear.',
    'Forbidden: which week/section covered a topic; exam logistics (format, points, WR/MC sections, grading); syllabus trivia.',
    'Forbidden: URLs, HTML, or markdown links in any field. Plain markdown only (headings in body are optional; section heading is separate).',
    'Aim for 4–8 focused sections. Keep each section concise and useful for studying.',
    'Ground every section strictly in the course material below.',
    '',
    'Course material:',
    '---',
    input.courseMaterial.slice(0, 60000),
    '---',
  ].join('\n');
}

export function buildFlashcardsPrompt(input: {
  title: string;
  scopeSummary: string;
  courseMaterial: string;
  cardCount: number;
}): string {
  return [
    `Create exactly ${input.cardCount} flashcards for: ${input.title}`,
    `Scope: ${input.scopeSummary}`,
    'Return JSON with title and cards array. Each card has front (prompt/term/question) and back (concise answer).',
    'Front: prefer a short term or stem under ~12–15 words (not a full exam-style sentence). Example: "Win x64: where do args 5+ go?" — not a long "Where are integer arguments passed if…". One line max; no multi-paragraph fronts.',
    'Back: a plain concise answer — one or two short sentences, or a phrase. Light emphasis is OK.',
    'Avoid bullet lists, headings, or mini-essays on the back; these cards are small and meant for quick self-check.',
    'Prefer substantive readings (notes/PDFs) over exam topic lists or syllabi when both appear.',
    'Forbidden: which week/section covered a topic; exam logistics (format, points, WR/MC sections, grading); syllabus trivia.',
    'Forbidden: URLs, HTML, or markdown links in any field. Plain text or light markdown only.',
    'Ground every card strictly in the course material below.',
    '',
    'Course material:',
    '---',
    input.courseMaterial.slice(0, 60000),
    '---',
  ].join('\n');
}

export function buildWrongAnswerExplanationPrompt(input: {
  questiontext: string;
  studentanswer: string;
  rightanswer: string;
  courseMaterial: string;
}): string {
  return [
    'Explain why the student missed this practice-quiz question.',
    'Write 2-3 short sentences, clear and encouraging.',
    'Use only the course material below. If the material is thin, still explain from the correct answer without inventing course facts.',
    '',
    `Question: ${input.questiontext}`,
    `Student answered: ${input.studentanswer}`,
    `Correct answer: ${input.rightanswer}`,
    '',
    'Course material:',
    '---',
    (input.courseMaterial || '').slice(0, 20000),
    '---',
  ].join('\n');
}

export function buildTopicSuggestionsPrompt(input: {
  courseName?: string;
  sectionName?: string;
  recentTurns: Array<{ role: string; content: string }>;
}): string {
  const lines = [
    'Suggest exactly 3 short study topics the student might want a study guide, flashcards, or practice quiz about next.',
    'Return JSON: { "topics": ["...", "...", "..."] }.',
    'Each topic: one concise phrase (max ~12 words), specific enough to study, no numbering or quotes.',
    'Stay strictly on-course. Do not suggest off-topic or personal tasks.',
    'Prefer topics grounded in the recent conversation; vary the three suggestions.',
  ];

  if (input.courseName) {
    lines.push(`Course: ${input.courseName}`);
  }
  if (input.sectionName) {
    lines.push(`Active section focus: ${input.sectionName}`);
  }

  lines.push('', 'Recent conversation:');
  const turns = input.recentTurns.slice(-8);
  if (!turns.length) {
    lines.push('(no prior messages)');
  } else {
    for (const turn of turns) {
      const role = turn.role === 'user' ? 'Student' : 'Assistant';
      const content = (turn.content || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!content) continue;
      lines.push(`${role}: ${content}`);
    }
  }

  return lines.join('\n');
}
