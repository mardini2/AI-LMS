import type { PracticeQuizQuestion } from '../context/context.types';
import {
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

// Re-export provider-agnostic tool defs so older imports keep working.
export {
  PROPOSE_PRACTICE_QUIZ_TOOL,
  PROPOSE_STUDY_GUIDE_TOOL,
  PROPOSE_FLASHCARDS_TOOL,
  STUDY_PROPOSAL_TOOLS,
} from './providers/llm-tools';

function coachGuidanceInstructions(level: number): string {
  const clamped = Math.min(5, Math.max(1, Math.round(level)));
  const byLevel: Record<number, string> = {
    1: 'Guidance level 1 (lowest): ask probing questions only. Give almost no hints. Do not reveal the answer or key steps unless the student has already reasoned there.',
    2: 'Guidance level 2: mostly questions with rare, light hints. Prefer redirecting them to relevant course concepts over telling them what to conclude.',
    3: 'Guidance level 3 (balanced): mix Socratic questions with short hints and gentle counters. Still withhold the full answer until they work toward it.',
    4: 'Guidance level 4: offer stronger scaffolding — clearer hints, worked partial steps, and pointed follow-ups — while still asking them to finish the reasoning.',
    5: 'Guidance level 5 (highest): heavy scaffolding that is almost direct. Give substantial hints and structured steps, but still invite them to state the conclusion themselves before you fully confirm it.',
  };
  return byLevel[clamped];
}

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
  mode?: 'direct' | 'coach';
  guidance?: number;
}): string {
  const mode = ctx.mode === 'coach' ? 'coach' : 'direct';
  const lines: string[] = [
    "You are Syllentras AI, a helpful teaching assistant. Answer the student's questions clearly and accurately.",
    'Format responses with markdown (headings, bold, lists) when it improves readability.',
  ];

  if (mode === 'coach') {
    lines.push(
      'You are in Coach mode: help the student reach correct conclusions themselves through follow-up questions, counterarguments, and hints. Do not immediately give the full answer for conceptual or problem-solving questions.',
      'Withhold the final answer until the student has reasoned toward it. Prefer questions that check understanding over lectures.',
      coachGuidanceInstructions(ctx.guidance ?? 3),
      'Exception — answer directly (do not coach) when the student needs a course fact or logistics: deadlines, due dates, where to find an announcement or resource, schedule details, what something in Moodle said, or similar lookup questions. Be clear and concise for those.',
      'Do not repeat welcome messages or introduce yourself unless the student asks who you are.',
    );
  } else {
    lines.push(
      'Answer the student directly. Do not repeat welcome messages or introduce yourself unless the student asks who you are.',
    );
  }

  lines.push(
    'Stay focused on helping the student with their coursework and learning for the current course and enrolled courses.',
    'Only answer questions related to course content, enrolled courses, or study skills that support this course (clarifying concepts, study guides, flashcards, practice quizzes).',
    'If the student asks something off-topic or unrelated to the course (e.g. cooking, recipes, entertainment, general life advice), politely decline. Do not partially fulfill the request.',
    'When declining, briefly say you can only help with course content, then invite a course-related question or offer study tools when available.',
    'Do not help with cheating: do not provide exam answer keys, graded assignment solutions, or ways to bypass academic integrity. Offer legitimate study help instead (explanations, study guides, flashcards, practice quizzes).',
    'Refuse harmful or dangerous requests (weapons, explosives, illegal activity, etc.) and redirect to course help.',
    'If the student sends a short greeting or opener with no real question (e.g. "hi", "hey", "hello", "what\'s up"), or asks what you can help with / what you can do, do not reply with only a generic greeting.',
    'Instead, briefly welcome them and explain how you can help with the current course, grounded in the course name and material when available. Include concrete topic examples from the course material when possible. Keep it scannable: short intro, then a short bullet/list of ways you can help, then invite them to pick a topic or ask for a study tool. Do not invent course topics that are not supported by the course material or course name.',
  );

  if (ctx.canProposeContent) {
    lines.push(
      'In greeting and capability replies, mention that you can answer course questions and generate study guides, flashcards, or practice quizzes tailored to the course material.',
      'When the student clearly asks you to create/make/generate a study guide, study notes, or review sheet in Moodle, call the propose_study_guide tool with a sensible title and scopeSummary.',
      'When the student clearly asks you to create/make/generate flashcards or a flashcard deck in Moodle, call the propose_flashcards tool with a sensible title, scopeSummary, and cardCount.',
      'For propose_* tool titles, use a bare topic title only (e.g. "Week 14 - Packing and Exploitation"). Never put "Study Guide", "Flashcards", "Quiz", or "Practice Quiz" in the title — the system prepends the type label.',
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
    'Vary which option is correct across true/false items: aim for a mix of True-correct and False-correct (not all True).',
    'When False is correct, write a clearly false statement so False is the right answer.',
    'For multichoice, provide 3–4 options; exactly one answer has fraction 1.0, others 0.',
    'Do not always put the correct multichoice option first — vary the position of the correct answer.',
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
