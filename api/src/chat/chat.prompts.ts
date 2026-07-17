import {
  SchemaType,
  type FunctionDeclaration,
} from '@google/generative-ai';
import type { PracticeQuizQuestion } from '../context/context.types';
import {
  QUIZ_QUESTION_COUNT_AUTO_MAX,
  QUIZ_QUESTION_COUNT_EXPLICIT_MAX,
  QUIZ_QUESTION_COUNT_MIN,
} from './practice-quiz.helpers';

export const PROPOSE_PRACTICE_QUIZ_TOOL: FunctionDeclaration = {
  name: 'propose_practice_quiz',
  description:
    'Propose creating a private Moodle practice quiz for the student. Call only when they clearly ask to create/make/generate a practice quiz in Moodle. Do not call for ordinary study questions.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      title: {
        type: SchemaType.STRING,
        description: 'Short working title for the practice quiz',
      },
      scopeSummary: {
        type: SchemaType.STRING,
        description:
          'What the quiz covers, e.g. "Weeks 1–4: variables, loops, and arrays"',
      },
      questionCount: {
        type: SchemaType.INTEGER,
        description: `Number of questions to generate. If the student did not specify a count, choose a sensible number between ${QUIZ_QUESTION_COUNT_MIN} and ${QUIZ_QUESTION_COUNT_AUTO_MAX}. If they explicitly asked for a count, pass their requested number even if it exceeds ${QUIZ_QUESTION_COUNT_EXPLICIT_MAX} (the system will cap it).`,
      },
      countSpecifiedByStudent: {
        type: SchemaType.BOOLEAN,
        description:
          'True only when the student explicitly stated how many questions they want. False when you are choosing the count yourself.',
      },
    },
    required: [
      'title',
      'scopeSummary',
      'questionCount',
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
  canProposeQuiz: boolean;
}): string {
  const lines: string[] = [
    "You are Syllentras AI, a helpful teaching assistant. Answer the student's questions clearly and accurately.",
    'Format responses with markdown (headings, bold, lists) when it improves readability.',
    'Answer the student directly. Do not repeat welcome messages or introduce yourself unless the student asks who you are.',
  ];

  if (ctx.canProposeQuiz) {
    lines.push(
      'When the student clearly asks you to create/make/generate a practice quiz in Moodle, call the propose_practice_quiz tool with a sensible title, scopeSummary, and questionCount.',
      `If the student did not say how many questions they want, choose a good count between ${QUIZ_QUESTION_COUNT_MIN} and ${QUIZ_QUESTION_COUNT_AUTO_MAX} and set countSpecifiedByStudent to false.`,
      `If the student explicitly stated a question count, pass their requested number (even if above ${QUIZ_QUESTION_COUNT_EXPLICIT_MAX}) and set countSpecifiedByStudent to true. Still call the tool — the system will cap the count and explain the limit in the proposal.`,
      'Do not claim a quiz already exists. Creation happens only after the student confirms in the UI.',
      'For normal Q&A that is not a create-quiz request, answer normally without calling the tool.',
    );
  } else {
    lines.push(
      'You cannot create Moodle quizzes from this context (missing course, user, or material). If asked, explain they need to open a course page while logged in.',
    );
  }

  if (ctx.userFirstName?.trim()) {
    lines.push(
      `The student's first name is ${ctx.userFirstName.trim()}. Do not start answers with a greeting or the student's name unless the student explicitly asks for one.`,
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
      'Use the course material below as your primary source. If the answer is not in the material, say so honestly and offer general guidance.',
    );
  } else if (ctx.courseId > 1) {
    lines.push(`The student is currently viewing course ID ${ctx.courseId}.`);
  } else {
    lines.push(
      'The student is on the dashboard or site home, not a specific course page. Answer based on general knowledge or their enrolled courses listed above.',
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
  },
  count: number,
  alreadyAccepted: PracticeQuizQuestion[],
): string {
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
