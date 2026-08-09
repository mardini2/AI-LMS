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
  /** True once the student has already sent at least one message in this chat. */
  conversationStarted: boolean;
}): string {
  const mode = ctx.mode === 'coach' ? 'coach' : 'direct';
  // Only brand-new general chats may greet; section intros and follow-ups stay direct.
  const mayGreet =
    !ctx.conversationStarted && ctx.conversationType === 'general';
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
    // Thanks / acknowledgments — don't re-lecture.
    'If the student message is primarily gratitude or acknowledgment (e.g. "thanks", "thank you", "ok thank you", "appreciate it") with no new question or request, reply with a brief natural acknowledgment only (e.g. "You\'re welcome!", "Happy to help!", "No problem. Let me know if you need anything else."). Do not repeat your previous answer, re-list prior results, or restate course material.',
    'If a thank-you also includes a new question or request, answer that new part normally and skip rehashing the old answer unless they ask for it again.',
  );

  if (mayGreet) {
    lines.push(
      'This is the beginning of a new general chat. The UI may already show a short welcome bubble — that is fine; still answer their message.',
      'Greet the student briefly only when their first message is a greeting, capability question, or other conversational opener. If their first message is a substantive course question, answer it directly without a ceremonial welcome.',
      // Keep hi-replies short — fold the language tip into the same paragraph.
      'For a greeting or capability question, reply in a short warm paragraph (no bullet lists). Mention the course name when known. Cover that you can help with concepts, questions, and study tools (flashcards, study guides, practice quizzes). Put "You can chat with me in any language." in that same paragraph — do not put it on its own line. Optionally end with a separate short closer like "What would you like to work on today?" Do not talk about Mic language or Accessibility unless they ask about the microphone.',
      'Example first-turn greeting shape: "Hi [Name], welcome to [Course]! I\'m here to help you understand course concepts, answer questions, or create study tools like flashcards, study guides, and practice quizzes. You can chat with me in any language.\\n\\nWhat would you like to work on today?"',
      'Do not invent course topics that are not supported by the course material or course name.',
    );
  } else {
    lines.push(
      'This conversation has already started or is a section-specific chat. Do not begin with Hi, Hello, Hey, Welcome, or the student\'s name as a greeting. Begin directly with the answer.',
      'A section chat may already show an introductory message such as "What would you like to know about Week 3?" Do not repeat or replace that introduction.',
      'Do not end with generic filler such as "Let me know if you have any questions" or "What would you like to work on next?"',
      'If the student sends a short greeting or asks what you can help with after the chat has started, reply briefly (a few sentences, no long bullet lists). Keep "You can chat with me in any language." inside the same paragraph as the rest of the reply — not on its own line. Skip Mic/Accessibility unless they ask about dictation.',
    );
  }

  if (ctx.canProposeContent) {
    lines.push(
      mayGreet
        ? 'In greeting and capability replies, mention study guides, flashcards, and practice quizzes inside that same opening paragraph — still keep the whole reply short.'
        : 'When listing capabilities, mention that you can answer course questions and generate study guides, flashcards, or practice quizzes tailored to the course material.',
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
      mayGreet
        ? 'In greeting replies when tools are unavailable, follow this vibe in one paragraph: "I can help with your [course] by answering questions and explaining concepts. For study guides, flashcards, and practice quizzes, open the course page while logged in. You can chat with me in any language." Keep the language line in that same paragraph — no bullet lists, no Mic/Accessibility lecture.'
        : 'When listing capabilities, describe how you can help with course Q&A, and explain they need to open a course page while logged in to create study guides, flashcards, or practice quizzes.',
    );
  }

  if (ctx.userFirstName?.trim()) {
    const firstName = ctx.userFirstName.trim();
    lines.push(
      `The student's first name is ${firstName}. Use their name where it feels natural and warm${
        mayGreet
          ? `, including an appropriate first-turn greeting such as "Hi ${firstName},"`
          : ''
      }.`,
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
