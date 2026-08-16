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
          'Course-topic scope only (e.g. "Weeks 1–4: variables, loops, and arrays" or "command and control and backdoors from course material"). Must be grounded in the course syllabus/material — never name a news article, website, or facts that appear only in linked pages.',
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
          'Course-topic scope only (e.g. "Weeks 13–14: packing and rootkits"). Must be grounded in the course syllabus/material — never name a news article, website, or facts that appear only in linked pages.',
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
          'Course-topic scope only (e.g. "Weeks 13–14: packing and rootkits"). Must be grounded in the course syllabus/material — never name a news article, website, or facts that appear only in linked pages.',
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

/** Offer Open-button targets when the system fetched page content this turn. */
export const SUGGEST_OPENABLE_LINKS_TOOL: LlmTool = {
  name: 'suggest_openable_links',
  description:
    'Suggest up to 3 http(s) pages for UI Read link buttons. Call when recommending articles from Linked page content / Outbound links on page. Use only URLs from that fetched content. You MUST still write a full normal reply with markdown links — this tool only supplies buttons and must never be your only output. Do not call for Moodle study-tool creation.',
  parameters: {
    type: 'object',
    properties: {
      links: {
        type: 'array',
        description: 'Up to 3 recommended pages, most relevant first.',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Short article or page title for the button label.',
            },
            url: {
              type: 'string',
              description:
                'Exact http(s) URL from the Linked page content or Outbound links list.',
            },
            teaser: {
              type: 'string',
              description: 'Optional short blurb (not shown on the button).',
            },
          },
          required: ['title', 'url'],
        },
      },
    },
    required: ['links'],
  },
};
