import type { PracticeQuizQuestion } from '../../../src/context/context.types';
import {
  buildFlashcardsPrompt,
  buildPracticeQuestionsPrompt,
  buildStudyGuidePrompt,
  buildSystemPrompt,
  buildTopicSuggestionsPrompt,
  buildWrongAnswerExplanationPrompt,
  PROPOSE_FLASHCARDS_TOOL,
  PROPOSE_PRACTICE_QUIZ_TOOL,
  PROPOSE_STUDY_GUIDE_TOOL,
  STUDY_PROPOSAL_TOOLS,
  SUGGEST_OPENABLE_LINKS_TOOL,
} from '../../../src/chat/chat.prompts';
import * as llmTools from '../../../src/chat/providers/llm-tools';
import {
  QUIZ_DIFFICULTY_DEFAULT,
  QUIZ_QUESTION_COUNT_AUTO_MAX,
  QUIZ_QUESTION_COUNT_EXPLICIT_MAX,
  QUIZ_QUESTION_COUNT_MIN,
  type QuizDifficulty,
} from '../../../src/chat/practice-quiz.helpers';
import {
  FLASHCARD_COUNT_AUTO_MAX,
  FLASHCARD_COUNT_EXPLICIT_MAX,
  FLASHCARD_COUNT_MIN,
} from '../../../src/chat/flashcards.helpers';

type SystemPromptCtx = Parameters<typeof buildSystemPrompt>[0];

function ctx(overrides: Partial<SystemPromptCtx> = {}): SystemPromptCtx {
  return {
    courseId: 12,
    courseName: 'Operating Systems',
    enrolledCourses: [],
    courseMaterial: '',
    canProposeContent: false,
    conversationType: 'general',
    conversationStarted: true,
    ...overrides,
  };
}

const COACH_MODE_LINE =
  'You are in Coach mode: help the student reach correct conclusions themselves through follow-up questions, counterarguments, and hints. Do not immediately give the full answer for conceptual or problem-solving questions.';
const DIRECT_MODE_LINE =
  'Answer the student directly. Do not repeat welcome messages or introduce yourself unless the student asks who you are.';

const GUIDANCE_LINES: Record<number, string> = {
  1: 'Guidance level 1 (lowest): ask probing questions only. Give almost no hints. Do not reveal the answer or key steps unless the student has already reasoned there.',
  2: 'Guidance level 2: mostly questions with rare, light hints. Prefer redirecting them to relevant course concepts over telling them what to conclude.',
  3: 'Guidance level 3 (balanced): mix Socratic questions with short hints and gentle counters. Still withhold the full answer until they work toward it.',
  4: 'Guidance level 4: offer stronger scaffolding — clearer hints, worked partial steps, and pointed follow-ups — while still asking them to finish the reasoning.',
  5: 'Guidance level 5 (highest): heavy scaffolding that is almost direct. Give substantial hints and structured steps, but still invite them to state the conclusion themselves before you fully confirm it.',
};

describe('re-exported tool definitions', () => {
  it('forwards the same tool objects that live in providers/llm-tools', () => {
    expect(PROPOSE_PRACTICE_QUIZ_TOOL).toBe(llmTools.PROPOSE_PRACTICE_QUIZ_TOOL);
    expect(PROPOSE_STUDY_GUIDE_TOOL).toBe(llmTools.PROPOSE_STUDY_GUIDE_TOOL);
    expect(PROPOSE_FLASHCARDS_TOOL).toBe(llmTools.PROPOSE_FLASHCARDS_TOOL);
    expect(SUGGEST_OPENABLE_LINKS_TOOL).toBe(
      llmTools.SUGGEST_OPENABLE_LINKS_TOOL,
    );
  });

  it('exposes the tool names the system prompt tells the model to call', () => {
    expect(PROPOSE_PRACTICE_QUIZ_TOOL.name).toBe('propose_practice_quiz');
    expect(PROPOSE_STUDY_GUIDE_TOOL.name).toBe('propose_study_guide');
    expect(PROPOSE_FLASHCARDS_TOOL.name).toBe('propose_flashcards');
    expect(SUGGEST_OPENABLE_LINKS_TOOL.name).toBe('suggest_openable_links');
    expect(STUDY_PROPOSAL_TOOLS.map((tool) => tool.name)).toEqual([
      'propose_study_guide',
      'propose_flashcards',
      'propose_practice_quiz',
    ]);
  });
});

describe('buildSystemPrompt', () => {
  describe('coach vs direct mode', () => {
    it('adds the coaching instructions and withholds the direct-answer line in coach mode', () => {
      const prompt = buildSystemPrompt(ctx({ mode: 'coach' }));

      expect(prompt).toContain(COACH_MODE_LINE);
      expect(prompt).toContain(
        'Withhold the final answer until the student has reasoned toward it. Prefer questions that check understanding over lectures.',
      );
      expect(prompt).toContain(
        'Exception — answer directly (do not coach) when the student needs a course fact or logistics: deadlines, due dates, where to find an announcement or resource, schedule details, what something in Moodle said, or similar lookup questions. Be clear and concise for those.',
      );
      expect(prompt).not.toContain(DIRECT_MODE_LINE);
    });

    it('uses the direct-answer instruction and no coaching text in direct mode', () => {
      const prompt = buildSystemPrompt(ctx({ mode: 'direct' }));

      expect(prompt).toContain(DIRECT_MODE_LINE);
      expect(prompt).not.toContain(COACH_MODE_LINE);
      expect(prompt).not.toContain('Guidance level');
    });

    it('falls back to direct mode when mode is omitted or unrecognized', () => {
      expect(buildSystemPrompt(ctx({ mode: undefined }))).toContain(
        DIRECT_MODE_LINE,
      );
      expect(
        buildSystemPrompt(
          ctx({ mode: 'socratic' as unknown as 'coach' | 'direct' }),
        ),
      ).toContain(DIRECT_MODE_LINE);
      expect(
        buildSystemPrompt(
          ctx({ mode: 'socratic' as unknown as 'coach' | 'direct' }),
        ),
      ).not.toContain(COACH_MODE_LINE);
    });
  });

  describe('coach guidance levels', () => {
    it.each([1, 2, 3, 4, 5])(
      'emits the level %i guidance sentence',
      (level) => {
        const prompt = buildSystemPrompt(ctx({ mode: 'coach', guidance: level }));

        expect(prompt).toContain(GUIDANCE_LINES[level]);
        for (const other of [1, 2, 3, 4, 5].filter((l) => l !== level)) {
          expect(prompt).not.toContain(GUIDANCE_LINES[other]);
        }
      },
    );

    it('defaults to level 3 when guidance is not supplied', () => {
      const prompt = buildSystemPrompt(ctx({ mode: 'coach' }));

      expect(prompt).toContain(GUIDANCE_LINES[3]);
    });

    it('clamps guidance below 1 up to level 1', () => {
      expect(buildSystemPrompt(ctx({ mode: 'coach', guidance: 0 }))).toContain(
        GUIDANCE_LINES[1],
      );
      expect(buildSystemPrompt(ctx({ mode: 'coach', guidance: -7 }))).toContain(
        GUIDANCE_LINES[1],
      );
    });

    it('clamps guidance above 5 down to level 5', () => {
      expect(buildSystemPrompt(ctx({ mode: 'coach', guidance: 6 }))).toContain(
        GUIDANCE_LINES[5],
      );
      expect(buildSystemPrompt(ctx({ mode: 'coach', guidance: 99 }))).toContain(
        GUIDANCE_LINES[5],
      );
    });

    it('rounds fractional guidance to the nearest level', () => {
      expect(buildSystemPrompt(ctx({ mode: 'coach', guidance: 2.4 }))).toContain(
        GUIDANCE_LINES[2],
      );
      expect(buildSystemPrompt(ctx({ mode: 'coach', guidance: 2.6 }))).toContain(
        GUIDANCE_LINES[3],
      );
      expect(buildSystemPrompt(ctx({ mode: 'coach', guidance: 3.5 }))).toContain(
        GUIDANCE_LINES[4],
      );
    });
  });

  describe('greeting eligibility', () => {
    const GREETING_OPENER =
      'This is the beginning of a new general chat. The UI may already show a short welcome bubble — that is fine; still answer their message.';
    const CONTINUATION_OPENER =
      "This conversation has already started or is a section-specific chat. Do not begin with Hi, Hello, Hey, Welcome, or the student's name as a greeting. Begin directly with the answer.";

    it('allows a greeting on the first turn of a general chat', () => {
      const prompt = buildSystemPrompt(
        ctx({ conversationType: 'general', conversationStarted: false }),
      );

      expect(prompt).toContain(GREETING_OPENER);
      expect(prompt).toContain('Example first-turn greeting shape:');
      expect(prompt).toContain(
        'Do not invent course topics that are not supported by the course material or course name.',
      );
      expect(prompt).not.toContain(CONTINUATION_OPENER);
    });

    it('suppresses greetings once the general chat has started', () => {
      const prompt = buildSystemPrompt(
        ctx({ conversationType: 'general', conversationStarted: true }),
      );

      expect(prompt).toContain(CONTINUATION_OPENER);
      expect(prompt).toContain(
        'Do not end with generic filler such as "Let me know if you have any questions" or "What would you like to work on next?"',
      );
      expect(prompt).not.toContain(GREETING_OPENER);
    });

    it('suppresses greetings in a brand-new section chat', () => {
      const prompt = buildSystemPrompt(
        ctx({ conversationType: 'section', conversationStarted: false }),
      );

      expect(prompt).toContain(CONTINUATION_OPENER);
      expect(prompt).toContain(
        'A section chat may already show an introductory message such as "What would you like to know about Week 3?" Do not repeat or replace that introduction.',
      );
      expect(prompt).not.toContain(GREETING_OPENER);
    });

    it('suppresses greetings when the conversation type is unknown', () => {
      const prompt = buildSystemPrompt(
        ctx({ conversationType: undefined, conversationStarted: false }),
      );

      expect(prompt).toContain(CONTINUATION_OPENER);
      expect(prompt).not.toContain(GREETING_OPENER);
    });
  });

  describe('content generation instructions', () => {
    it('includes the propose_* tool rules and count limits when content can be proposed', () => {
      const prompt = buildSystemPrompt(ctx({ canProposeContent: true }));

      expect(prompt).toContain(
        'When the student clearly asks you to create/make/generate a study guide, study notes, or review sheet in Moodle, call the propose_study_guide tool with a sensible title and scopeSummary.',
      );
      expect(prompt).toContain(
        'When the student clearly asks you to create/make/generate flashcards or a flashcard deck in Moodle, call the propose_flashcards tool with a sensible title, scopeSummary, and cardCount.',
      );
      expect(prompt).toContain(
        'When the student clearly asks you to create/make/generate a practice quiz in Moodle, call the propose_practice_quiz tool with a sensible title, scopeSummary, questionCount, and difficulty.',
      );
      expect(prompt).toContain(
        'Do not call more than one create tool in one turn. Pick study guide vs flashcards vs quiz based on the request.',
      );
      expect(prompt).toContain(
        'Do not claim a study guide, flashcards, or quiz already exist. Creation happens only after the student confirms in the UI.',
      );
      expect(prompt).not.toContain(
        'You cannot create Moodle content from this context',
      );
    });

    it('interpolates the flashcard and quiz count bounds into the tool rules', () => {
      const prompt = buildSystemPrompt(ctx({ canProposeContent: true }));

      expect(prompt).toContain(
        `If the student did not say how many flashcards they want, choose a good count between ${FLASHCARD_COUNT_MIN} and ${FLASHCARD_COUNT_AUTO_MAX} and set countSpecifiedByStudent to false.`,
      );
      expect(prompt).toContain(
        `If the student explicitly stated a flashcard count, pass their requested number (even if above ${FLASHCARD_COUNT_EXPLICIT_MAX}) and set countSpecifiedByStudent to true.`,
      );
      expect(prompt).toContain(
        `If the student did not say how many questions they want, choose a good count between ${QUIZ_QUESTION_COUNT_MIN} and ${QUIZ_QUESTION_COUNT_AUTO_MAX} and set countSpecifiedByStudent to false.`,
      );
      expect(prompt).toContain(
        `If the student explicitly stated a question count, pass their requested number (even if above ${QUIZ_QUESTION_COUNT_EXPLICIT_MAX}) and set countSpecifiedByStudent to true. Still call the tool — the system will cap the count and explain the limit in the proposal.`,
      );
      expect(prompt).toContain(
        `For difficulty, use easy, medium, hard, or expert when the student clearly asks for a level; otherwise use ${QUIZ_DIFFICULTY_DEFAULT}.`,
      );
    });

    it('forbids type labels and linked-page topics in propose_* titles', () => {
      const prompt = buildSystemPrompt(ctx({ canProposeContent: true }));

      expect(prompt).toContain(
        'For propose_* tool titles, use a bare topic title only (e.g. "Week 14 - Packing and Exploitation"). Never put "Study Guide", "Flashcards", "Quiz", or "Practice Quiz" in the title — the system prepends the type label.',
      );
      expect(prompt).toContain(
        'Linked articles and news may inspire which course topic to study, but propose_* title and scopeSummary must name a course topic grounded in the Course Material / syllabus — never "this article", a news site, or facts that appear only in linked pages.',
      );
    });

    it('uses the short opening-paragraph capability line on a greeting-eligible turn', () => {
      const prompt = buildSystemPrompt(
        ctx({
          canProposeContent: true,
          conversationType: 'general',
          conversationStarted: false,
        }),
      );

      expect(prompt).toContain(
        'In greeting and capability replies, mention study guides, flashcards, and practice quizzes inside that same opening paragraph — still keep the whole reply short.',
      );
      expect(prompt).not.toContain(
        'When listing capabilities, mention that you can answer course questions and generate study guides, flashcards, or practice quizzes tailored to the course material.',
      );
    });

    it('uses the plain capability line once the conversation has started', () => {
      const prompt = buildSystemPrompt(
        ctx({ canProposeContent: true, conversationStarted: true }),
      );

      expect(prompt).toContain(
        'When listing capabilities, mention that you can answer course questions and generate study guides, flashcards, or practice quizzes tailored to the course material.',
      );
      expect(prompt).not.toContain(
        'In greeting and capability replies, mention study guides, flashcards, and practice quizzes inside that same opening paragraph',
      );
    });

    it('explains the tools are unavailable and drops the propose_* rules', () => {
      const prompt = buildSystemPrompt(ctx({ canProposeContent: false }));

      expect(prompt).toContain(
        'You cannot create Moodle content from this context (missing course, user, or material). If asked, explain they need to open a course page while logged in.',
      );
      expect(prompt).toContain(
        'When listing capabilities, describe how you can help with course Q&A, and explain they need to open a course page while logged in to create study guides, flashcards, or practice quizzes.',
      );
      expect(prompt).not.toContain('call the propose_practice_quiz tool');
      expect(prompt).not.toContain('call the propose_study_guide tool');
      expect(prompt).not.toContain('call the propose_flashcards tool');
    });

    it('uses the tools-unavailable greeting vibe on a greeting-eligible turn', () => {
      const prompt = buildSystemPrompt(
        ctx({
          canProposeContent: false,
          conversationType: 'general',
          conversationStarted: false,
        }),
      );

      expect(prompt).toContain(
        'In greeting replies when tools are unavailable, follow this vibe in one paragraph:',
      );
      expect(prompt).not.toContain(
        'When listing capabilities, describe how you can help with course Q&A,',
      );
    });
  });

  describe('course scoping', () => {
    it('falls back to the raw course id when the course name is unknown', () => {
      const prompt = buildSystemPrompt(
        ctx({ courseId: 12, courseName: undefined }),
      );

      expect(prompt).toContain('The student is currently viewing course ID 12.');
      expect(prompt).not.toContain('The student is currently viewing the course:');
      expect(prompt).not.toContain(
        'Use the course material below as your primary source.',
      );
      expect(prompt).not.toContain('dashboard or site home');
    });

    it('treats an empty course name as unknown', () => {
      const prompt = buildSystemPrompt(ctx({ courseId: 9, courseName: '' }));

      expect(prompt).toContain('The student is currently viewing course ID 9.');
    });
  });

  describe('student name', () => {
    it('suggests a first-turn greeting with the name when a greeting is allowed', () => {
      const prompt = buildSystemPrompt(
        ctx({
          userFirstName: '  Jordan  ',
          conversationType: 'general',
          conversationStarted: false,
        }),
      );

      expect(prompt).toContain(
        'The student\'s first name is Jordan. Use their name where it feels natural and warm, including an appropriate first-turn greeting such as "Hi Jordan,".',
      );
      expect(prompt).toContain(
        'Do not force their name into every reply. For ordinary course Q&A and tool proposals, answer directly without repeating Jordan unless it adds a genuine personal touch.',
      );
    });

    it('omits the first-turn greeting clause once the conversation has started', () => {
      const prompt = buildSystemPrompt(
        ctx({ userFirstName: 'Jordan', conversationStarted: true }),
      );

      expect(prompt).toContain(
        "The student's first name is Jordan. Use their name where it feels natural and warm.",
      );
      expect(prompt).not.toContain('including an appropriate first-turn greeting');
    });
  });
});

describe('buildPracticeQuestionsPrompt', () => {
  const base = {
    title: 'Memory Management',
    scopeSummary: 'Week 3 paging and TLBs',
    courseMaterial: 'Paging splits memory into fixed-size frames.',
  };

  it('states the requested count, title, and scope on the opening lines', () => {
    const prompt = buildPracticeQuestionsPrompt(base, 7, []);

    expect(prompt).toContain(
      'Create exactly 7 practice quiz questions for: Memory Management',
    );
    expect(prompt).toContain('Scope: Week 3 paging and TLBs');
  });

  it.each([
    [
      'easy',
      'Difficulty: easy — Easy: focus on recall and definitions; ask for direct facts clearly stated in the material. Avoid multi-step reasoning.',
    ],
    [
      'medium',
      'Difficulty: medium — Medium: ask for straightforward application of one concept from the material in a simple scenario.',
    ],
    [
      'hard',
      'Difficulty: hard — Hard: use multi-step reasoning, compare/contrast, or common pitfalls grounded in the material.',
    ],
    [
      'expert',
      'Difficulty: expert — Expert: synthesize across ideas or use edge cases from the material only. Do not invent topics or facts not present in the course material.',
    ],
  ])('emits the %s difficulty guidance', (difficulty, expected) => {
    const prompt = buildPracticeQuestionsPrompt(
      { ...base, difficulty: difficulty as QuizDifficulty },
      5,
      [],
    );

    expect(prompt).toContain(expected);
  });

  it('falls back to medium when difficulty is omitted or invalid', () => {
    expect(buildPracticeQuestionsPrompt(base, 5, [])).toContain(
      'Difficulty: medium —',
    );
    expect(
      buildPracticeQuestionsPrompt(
        { ...base, difficulty: 'brutal' as unknown as QuizDifficulty },
        5,
        [],
      ),
    ).toContain('Difficulty: medium —');
  });

  it('includes the question-quality and format rules', () => {
    const prompt = buildPracticeQuestionsPrompt(base, 5, []);

    expect(prompt).toContain('Question quality rules:');
    expect(prompt).toContain(
      '- Forbidden: which week/section covered a topic; final-exam / syllabus / topic-list membership; "according to the course outline"; calendar or admin trivia.',
    );
    expect(prompt).toContain(
      '- Forbidden: URLs, HTML, markdown links, or "click here" anywhere in question or answer text. Plain text only.',
    );
    expect(prompt).toContain(
      'For true/false, answers must be exactly two entries with text "True" and "False".',
    );
    expect(prompt).toContain(
      'For multichoice, provide 3–4 options; exactly one answer has fraction 1.0, others 0.',
    );
  });

  it('omits the replacement block when nothing has been accepted yet', () => {
    const prompt = buildPracticeQuestionsPrompt(base, 5, []);

    expect(prompt).not.toContain('These questions are replacements');
  });

  it('lists already-accepted questions as numbered do-not-repeat items', () => {
    const accepted: PracticeQuizQuestion[] = [
      {
        type: 'multichoice',
        name: 'Q1',
        questiontext: 'What is a page fault?',
        answers: [{ text: 'A trap', fraction: 1 }],
      },
      {
        type: 'truefalse',
        name: 'Q2',
        questiontext: 'A TLB caches page table entries.',
        answers: [
          { text: 'True', fraction: 1 },
          { text: 'False', fraction: 0 },
        ],
      },
    ];

    const prompt = buildPracticeQuestionsPrompt(base, 3, accepted);

    expect(prompt).toContain(
      '- These questions are replacements for rejected ones. Do not repeat or paraphrase any of the following already-accepted questions:',
    );
    expect(prompt).toContain('  1. What is a page fault?');
    expect(prompt).toContain('  2. A TLB caches page table entries.');
  });

  it('truncates the course material at 60000 characters and closes the block', () => {
    const material = `${'A'.repeat(60000)}TAIL_MARKER`;

    const prompt = buildPracticeQuestionsPrompt(
      { ...base, courseMaterial: material },
      5,
      [],
    );

    expect(prompt).toContain('A'.repeat(60000));
    expect(prompt).not.toContain('TAIL_MARKER');
    expect(prompt.endsWith('---')).toBe(true);
  });
});

describe('buildStudyGuidePrompt', () => {
  const base = {
    title: 'Scheduling',
    scopeSummary: 'Week 4 CPU scheduling',
    courseMaterial: 'Round robin uses a fixed time quantum.',
  };

  it('names the guide, its scope, and the expected JSON shape', () => {
    const prompt = buildStudyGuidePrompt(base);

    expect(prompt).toContain('Create a structured study guide for: Scheduling');
    expect(prompt).toContain('Scope: Week 4 CPU scheduling');
    expect(prompt).toContain(
      'Return JSON with title, optional introMarkdown, and sections (heading + bodyMarkdown).',
    );
    expect(prompt).toContain(
      'Aim for 4–8 focused sections. Keep each section concise and useful for studying.',
    );
  });

  it('forbids links and exam logistics and grounds the guide in course material', () => {
    const prompt = buildStudyGuidePrompt(base);

    expect(prompt).toContain(
      'Forbidden: URLs, HTML, or markdown links in any field. Plain markdown only (headings in body are optional; section heading is separate).',
    );
    expect(prompt).toContain(
      'Forbidden: which week/section covered a topic; exam logistics (format, points, WR/MC sections, grading); syllabus trivia.',
    );
    expect(prompt).toContain('Ground every section strictly in the course material below.');
    expect(prompt).toContain('Round robin uses a fixed time quantum.');
  });

  it('truncates the course material at 60000 characters', () => {
    const prompt = buildStudyGuidePrompt({
      ...base,
      courseMaterial: `${'B'.repeat(60000)}TAIL_MARKER`,
    });

    expect(prompt).toContain('B'.repeat(60000));
    expect(prompt).not.toContain('TAIL_MARKER');
  });
});

describe('buildFlashcardsPrompt', () => {
  const base = {
    title: 'Syscalls',
    scopeSummary: 'Week 2 kernel interface',
    courseMaterial: 'A syscall traps into kernel mode.',
    cardCount: 12,
  };

  it('requests exactly the given card count with the front/back contract', () => {
    const prompt = buildFlashcardsPrompt(base);

    expect(prompt).toContain('Create exactly 12 flashcards for: Syscalls');
    expect(prompt).toContain('Scope: Week 2 kernel interface');
    expect(prompt).toContain(
      'Return JSON with title and cards array. Each card has front (prompt/term/question) and back (concise answer).',
    );
    expect(prompt).toContain(
      'Back: a plain concise answer — one or two short sentences, or a phrase. Light emphasis is OK.',
    );
    expect(prompt).toContain(
      'Avoid bullet lists, headings, or mini-essays on the back; these cards are small and meant for quick self-check.',
    );
  });

  it('reflects a different card count in the instruction', () => {
    expect(buildFlashcardsPrompt({ ...base, cardCount: 30 })).toContain(
      'Create exactly 30 flashcards for: Syscalls',
    );
  });

  it('truncates the course material at 60000 characters', () => {
    const prompt = buildFlashcardsPrompt({
      ...base,
      courseMaterial: `${'C'.repeat(60000)}TAIL_MARKER`,
    });

    expect(prompt).toContain('C'.repeat(60000));
    expect(prompt).not.toContain('TAIL_MARKER');
  });
});

describe('buildWrongAnswerExplanationPrompt', () => {
  const base = {
    questiontext: 'What does the TLB cache?',
    studentanswer: 'Disk blocks',
    rightanswer: 'Recent virtual-to-physical translations',
    courseMaterial: 'The TLB caches recent page table lookups.',
  };

  it('states the question, the student answer, and the correct answer', () => {
    const prompt = buildWrongAnswerExplanationPrompt(base);

    expect(prompt).toContain(
      'Explain why the student missed this practice-quiz question.',
    );
    expect(prompt).toContain('Write 2-3 short sentences, clear and encouraging.');
    expect(prompt).toContain('Question: What does the TLB cache?');
    expect(prompt).toContain('Student answered: Disk blocks');
    expect(prompt).toContain(
      'Correct answer: Recent virtual-to-physical translations',
    );
    expect(prompt).toContain('The TLB caches recent page table lookups.');
  });

  it('leaves the material block empty when no course material is available', () => {
    const prompt = buildWrongAnswerExplanationPrompt({
      ...base,
      courseMaterial: '',
    });

    expect(prompt.endsWith('Course material:\n---\n\n---')).toBe(true);
    expect(prompt).toContain(
      'Use only the course material below. If the material is thin, still explain from the correct answer without inventing course facts.',
    );
  });

  it('truncates the course material at 20000 characters', () => {
    const prompt = buildWrongAnswerExplanationPrompt({
      ...base,
      courseMaterial: `${'D'.repeat(20000)}TAIL_MARKER`,
    });

    expect(prompt).toContain('D'.repeat(20000));
    expect(prompt).not.toContain('TAIL_MARKER');
  });
});

describe('buildTopicSuggestionsPrompt', () => {
  it('always asks for exactly three on-course topics in a topics JSON object', () => {
    const prompt = buildTopicSuggestionsPrompt({ recentTurns: [] });

    expect(prompt).toContain(
      'Suggest exactly 3 short study topics the student might want a study guide, flashcards, or practice quiz about next.',
    );
    expect(prompt).toContain('Return JSON: { "topics": ["...", "...", "..."] }.');
    expect(prompt).toContain(
      'Each topic: one concise phrase (max ~12 words), specific enough to study, no numbering or quotes.',
    );
    expect(prompt).toContain(
      'Stay strictly on-course. Do not suggest off-topic or personal tasks.',
    );
  });

  it('adds the course and section focus lines when both are known', () => {
    const prompt = buildTopicSuggestionsPrompt({
      courseName: 'Operating Systems',
      sectionName: 'Week 3 — Memory',
      recentTurns: [],
    });

    expect(prompt).toContain('Course: Operating Systems');
    expect(prompt).toContain('Active section focus: Week 3 — Memory');
  });

  it('adds only the course line when there is no active section', () => {
    const prompt = buildTopicSuggestionsPrompt({
      courseName: 'Operating Systems',
      recentTurns: [],
    });

    expect(prompt).toContain('Course: Operating Systems');
    expect(prompt).not.toContain('Active section focus:');
  });

  it('omits both lines when neither course nor section is known', () => {
    const prompt = buildTopicSuggestionsPrompt({ recentTurns: [] });

    expect(prompt).not.toContain('Course:');
    expect(prompt).not.toContain('Active section focus:');
  });

  it('notes that there is no history when there are no recent turns', () => {
    const prompt = buildTopicSuggestionsPrompt({ recentTurns: [] });

    expect(prompt.endsWith('Recent conversation:\n(no prior messages)')).toBe(
      true,
    );
  });

  it('labels user turns Student and every other role Assistant', () => {
    const prompt = buildTopicSuggestionsPrompt({
      recentTurns: [
        { role: 'user', content: 'How does paging work?' },
        { role: 'assistant', content: 'It splits memory into frames.' },
        { role: 'system', content: 'Context refreshed.' },
      ],
    });

    expect(prompt).toContain('Student: How does paging work?');
    expect(prompt).toContain('Assistant: It splits memory into frames.');
    expect(prompt).toContain('Assistant: Context refreshed.');
    expect(prompt).not.toContain('(no prior messages)');
  });

  it('collapses whitespace inside turn content', () => {
    const prompt = buildTopicSuggestionsPrompt({
      recentTurns: [
        { role: 'user', content: '  How   does\n\npaging\twork?  ' },
      ],
    });

    expect(prompt).toContain('Student: How does paging work?');
  });

  it('skips turns whose content is blank after trimming', () => {
    const prompt = buildTopicSuggestionsPrompt({
      recentTurns: [
        { role: 'user', content: '   ' },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'Real question' },
      ],
    });

    expect(prompt).toContain('Student: Real question');
    expect(prompt).not.toContain('Student: \n');
    expect(prompt).not.toContain('Assistant:');
  });

  it('truncates a long turn to 500 characters', () => {
    const prompt = buildTopicSuggestionsPrompt({
      recentTurns: [
        { role: 'user', content: `${'e'.repeat(500)}TAIL_MARKER` },
      ],
    });

    expect(prompt).toContain(`Student: ${'e'.repeat(500)}`);
    expect(prompt).not.toContain('TAIL_MARKER');
  });

  it('keeps only the last eight turns', () => {
    const turns = Array.from({ length: 12 }, (_, i) => ({
      role: 'user',
      content: `turn-${i + 1}`,
    }));

    const prompt = buildTopicSuggestionsPrompt({ recentTurns: turns });

    for (const dropped of [1, 2, 3, 4]) {
      expect(prompt).not.toContain(`Student: turn-${dropped}\n`);
    }
    expect(prompt).toContain('Student: turn-5');
    expect(prompt).toContain('Student: turn-12');
    expect(prompt.split('\n').filter((l) => l.startsWith('Student: '))).toHaveLength(
      8,
    );
  });
});
