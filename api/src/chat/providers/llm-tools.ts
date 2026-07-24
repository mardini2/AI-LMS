import type { LlmTool } from './provider.types';
import {
  FLASHCARD_COUNT_AUTO_MAX,
  FLASHCARD_COUNT_EXPLICIT_MAX,
  FLASHCARD_COUNT_MIN,
} from '../flashcards.helpers';
import {
  QUIZ_DIFFICULTIES,
  QUIZ_DIFFICULTY_DEFAULT,
  QUIZ_QUESTION_COUNT_AUTO_MAX,
  QUIZ_QUESTION_COUNT_EXPLICIT_MAX,
  QUIZ_QUESTION_COUNT_MIN,
} from '../practice-quiz.helpers';

/**
 * Study-tool function declarations in a plain JSON-schema shape.
 * Each provider adapter maps these into its own tool/function format.
 */
export const PROPOSE_PRACTICE_QUIZ_TOOL: LlmTool = {
  name: 'propose_practice_quiz',
  description:
    'Propose creating a private Moodle practice quiz for the student. Call only when they clearly ask to create/make/generate a practice quiz in Moodle. Do not call for ordinary study questions, study guides, or flashcards.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          'Bare working title only (e.g. "Week 14 - Packing and Exploitation"). Do NOT include "Quiz", "Practice Quiz", "Study Guide", or "Flashcards" — those are added automatically.',
      },
      scopeSummary: {
        type: 'string',
        description:
          'What the quiz covers, e.g. "Weeks 1–4: variables, loops, and arrays"',
      },
      questionCount: {
        type: 'integer',
        description: `Number of questions to generate. If the student did not specify a count, choose a sensible number between ${QUIZ_QUESTION_COUNT_MIN} and ${QUIZ_QUESTION_COUNT_AUTO_MAX}. If they explicitly asked for a count, pass their requested number even if it exceeds ${QUIZ_QUESTION_COUNT_EXPLICIT_MAX} (the system will cap it).`,
      },
      countSpecifiedByStudent: {
        type: 'boolean',
        description:
          'True only when the student explicitly stated how many questions they want. False when you are choosing the count yourself.',
      },
      difficulty: {
        type: 'string',
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

export const PROPOSE_STUDY_GUIDE_TOOL: LlmTool = {
  name: 'propose_study_guide',
  description:
    'Propose creating a private Moodle study guide Page for the student. Call only when they clearly ask to create/make/generate a study guide, study notes, or review sheet in Moodle. Do not call for flashcards, practice quizzes, or ordinary Q&A.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          'Bare working title only (e.g. "Week 14 - Packing and Exploitation"). Do NOT include "Study Guide", "Flashcards", or "Quiz" — those are added automatically. Prefer week/topic with a hyphen.',
      },
      scopeSummary: {
        type: 'string',
        description:
          'What the guide covers, e.g. "Weeks 13–14: packing and rootkits"',
      },
    },
    required: ['title', 'scopeSummary'],
  },
};

export const PROPOSE_FLASHCARDS_TOOL: LlmTool = {
  name: 'propose_flashcards',
  description:
    'Propose creating a private Moodle flashcards Page for the student. Call only when they clearly ask to create/make/generate flashcards or a flashcard deck in Moodle. Do not call for study guides, practice quizzes, or ordinary Q&A.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          'Bare working title only (e.g. "Week 14 - Packing and Exploitation"). Do NOT include "Flashcards", "Study Guide", or "Quiz" — those are added automatically.',
      },
      scopeSummary: {
        type: 'string',
        description:
          'What the flashcards cover, e.g. "Weeks 13–14: packing and rootkits"',
      },
      cardCount: {
        type: 'integer',
        description: `Number of flashcards to generate. If the student did not specify a count, choose a sensible number between ${FLASHCARD_COUNT_MIN} and ${FLASHCARD_COUNT_AUTO_MAX}. If they explicitly asked for a count, pass their requested number even if it exceeds ${FLASHCARD_COUNT_EXPLICIT_MAX} (the system will cap it).`,
      },
      countSpecifiedByStudent: {
        type: 'boolean',
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

export const STUDY_PROPOSAL_TOOLS: LlmTool[] = [
  PROPOSE_STUDY_GUIDE_TOOL,
  PROPOSE_FLASHCARDS_TOOL,
  PROPOSE_PRACTICE_QUIZ_TOOL,
];
