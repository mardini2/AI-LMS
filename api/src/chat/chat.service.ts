import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FunctionCallingMode,
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  SchemaType,
  type FunctionDeclaration,
  type Tool,
} from '@google/generative-ai';
import { ContextService } from '../context/context.service';
import type { PracticeQuizQuestion } from '../context/context.service';
import { ConversationService } from '../conversation/conversation.service';
import { PendingActionService } from './pending-action.service';
import { SendMessageDto } from './dto/send-message.dto';

export interface PendingActionDto {
  id: string;
  type: 'practice_quiz';
  title: string;
  questionCount: number;
  scopeSummary: string;
}

export interface ReviewOfferDto {
  actionId: string;
  quizId: number;
  title: string;
  score: number;
  maxScore: number;
  wrongCount: number;
  total: number;
  scoreLabel: string;
}

export interface ReviewBlockDto {
  slot: number;
  question: string;
  studentAnswer: string;
  rightAnswer: string;
  why: string;
  citationTitle: string;
  citationSnippet?: string;
  citationUrl?: string;
}

export interface ChatResponse {
  response: string;
  conversationId: string;
  pendingAction?: PendingActionDto;
  quizUrl?: string;
  reviewOffer?: ReviewOfferDto;
  review?: ReviewBlockDto[];
}

const QUIZ_QUESTION_COUNT_MIN = 5;
const QUIZ_QUESTION_COUNT_AUTO_MAX = 15; // when AI chooses
const QUIZ_QUESTION_COUNT_EXPLICIT_MAX = 40; // when student specifies
const QUIZ_QUESTION_COUNT_DEFAULT = 10; // fallback if invalid

const PROPOSE_PRACTICE_QUIZ_TOOL: FunctionDeclaration = {
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
        description:
          `Number of questions to generate. If the student did not specify a count, choose a sensible number between ${QUIZ_QUESTION_COUNT_MIN} and ${QUIZ_QUESTION_COUNT_AUTO_MAX}. If they explicitly asked for a count, pass their requested number even if it exceeds ${QUIZ_QUESTION_COUNT_EXPLICIT_MAX} (the system will cap it).`,
      },
      countSpecifiedByStudent: {
        type: SchemaType.BOOLEAN,
        description:
          'True only when the student explicitly stated how many questions they want. False when you are choosing the count yourself.',
      },
    },
    required: ['title', 'scopeSummary', 'questionCount', 'countSpecifiedByStudent'],
  },
};

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly genAI: GoogleGenerativeAI;

  constructor(
    private readonly config: ConfigService,
    private readonly contextService: ContextService,
    private readonly conversationService: ConversationService,
    private readonly pendingActionService: PendingActionService,
  ) {
    this.genAI = new GoogleGenerativeAI(
      this.config.get<string>('GEMINI_API_KEY')!,
    );
  }

  async sendMessage(dto: SendMessageDto): Promise<ChatResponse> {
    const {
      courseId,
      courseName,
      moodleUserId,
      userFirstName,
      message,
      conversationId: incomingConvId,
    } = dto;

    let conversationId = incomingConvId;
    if (conversationId) {
      try {
        if (moodleUserId) {
          await this.conversationService.assertOwner(
            conversationId,
            moodleUserId,
          );
        } else {
          await this.conversationService.findById(conversationId);
        }
      } catch {
        conversationId = undefined;
      }
    }
    if (!conversationId) {
      const conversation = moodleUserId
        ? await this.conversationService.openConversation(
            courseId,
            moodleUserId,
            {
              type: 'general',
              title: 'Main',
            },
          )
        : await this.conversationService.create(courseId, moodleUserId);
      conversationId = conversation.id;
    }

    const conversation =
      await this.conversationService.findById(conversationId);

    const [courseMaterial, resolvedCourseName, enrolledCourses] =
      await Promise.all([
        this.contextService.getContext(courseId, message, {
          sectionId: conversation.sectionId,
          sectionNumber: conversation.sectionNumber,
          sectionName: conversation.sectionName,
        }),
        this.contextService.resolveCourseName(courseId, courseName),
        moodleUserId
          ? this.contextService.getEnrolledCourseNames(moodleUserId)
          : Promise.resolve([]),
      ]);

    const dbHistory = await this.conversationService.getRecentHistory(
      conversationId,
      20,
    );

    const canProposeQuiz =
      Boolean(moodleUserId) && courseId > 1 && Boolean(courseMaterial);

    const model = this.genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      systemInstruction: buildSystemPrompt({
        courseId,
        courseName: resolvedCourseName,
        userFirstName,
        enrolledCourses,
        conversationTitle: conversation.title,
        conversationType: conversation.type,
        sectionName: conversation.sectionName,
        courseMaterial,
        canProposeQuiz,
      }),
      tools: canProposeQuiz
        ? ([{ functionDeclarations: [PROPOSE_PRACTICE_QUIZ_TOOL] }] as Tool[])
        : undefined,
      toolConfig: canProposeQuiz
        ? {
            functionCallingConfig: {
              mode: FunctionCallingMode.AUTO,
            },
          }
        : undefined,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    });

    const chat = model.startChat({
      history: toGeminiHistory(dbHistory),
    });

    this.logger.log(`Sending message for conversation ${conversationId}`);
    const result = await chat.sendMessage(message);
    const functionCalls = result.response.functionCalls?.() ?? [];

    let responseText = '';
    let pendingAction: PendingActionDto | undefined;

    const proposeCall = functionCalls.find(
      (call) => call.name === 'propose_practice_quiz',
    );

    if (proposeCall && moodleUserId && courseId > 1) {
      const args = (proposeCall.args ?? {}) as {
        title?: string;
        scopeSummary?: string;
        questionCount?: number;
        countSpecifiedByStudent?: boolean;
      };
      const requestedCount =
        typeof args.questionCount === 'number'
          ? args.questionCount
          : Number(args.questionCount);
      const countSpecifiedByStudent = args.countSpecifiedByStudent === true;
      const questionCount = clampQuestionCount(
        requestedCount,
        countSpecifiedByStudent,
      );
      const exceededMax =
        countSpecifiedByStudent &&
        Number.isFinite(requestedCount) &&
        Math.round(requestedCount) > QUIZ_QUESTION_COUNT_EXPLICIT_MAX;
      const title =
        (args.title ?? '').trim() || 'Practice quiz';
      const scopeSummary =
        (args.scopeSummary ?? '').trim() ||
        'Course material from the current conversation';

      const action = await this.pendingActionService.createPracticeQuizProposal({
        conversationId,
        courseId,
        moodleUserId,
        payload: {
          title,
          scopeSummary,
          questionCount,
          sectionId: conversation.sectionId,
          sectionNumber: conversation.sectionNumber,
          sectionName: conversation.sectionName,
        },
      });

      pendingAction = {
        id: action.id,
        type: 'practice_quiz',
        title,
        questionCount,
        scopeSummary,
      };

      responseText = buildProposalMessage({
        title,
        questionCount,
        scopeSummary,
        requestedCount: exceededMax ? Math.round(requestedCount) : undefined,
      });
    } else {
      try {
        responseText = result.response.text();
      } catch {
        responseText =
          'I can help with course questions, or create a private practice quiz in Moodle when you ask for one.';
      }
    }

    await this.conversationService.appendMessages(conversationId, [
      { role: 'user', content: message },
      { role: 'assistant', content: responseText },
    ]);

    return { response: responseText, conversationId, pendingAction };
  }

  async confirmAction(
    actionId: string,
    moodleUserId: number,
  ): Promise<ChatResponse> {
    const action = await this.pendingActionService.assertPendingOwned(
      actionId,
      moodleUserId,
    );

    if (action.type !== 'practice_quiz') {
      throw new BadRequestException('Unsupported action type');
    }

    const { title, scopeSummary, questionCount, sectionId, sectionNumber, sectionName } =
      action.payload;

    const courseMaterial = await this.contextService.getContext(
      action.courseId,
      `${title} ${scopeSummary}`,
      { sectionId, sectionNumber, sectionName },
    );

    if (!courseMaterial.trim()) {
      throw new BadRequestException(
        'No course material available to generate quiz questions',
      );
    }

    this.logger.log(
      `Generating ${questionCount} practice questions for action ${actionId}`,
    );
    const questions = await this.generatePracticeQuestions({
      title,
      scopeSummary,
      questionCount,
      courseMaterial,
    });

    const quiz = await this.contextService.createPracticeQuiz({
      courseId: action.courseId,
      moodleUserId,
      name: title,
      intro:
        'Practice quiz created by Syllentras AI. This does not count toward your course grade.',
      questions,
    });

    await this.pendingActionService.markConfirmedWithQuiz(actionId, {
      quizId: quiz.quizId,
      cmId: quiz.cmId,
      viewUrl: quiz.viewUrl,
    });

    const responseText = [
      `Your practice quiz **${quiz.name}** is ready.`,
      '',
      `- ${questions.length} questions (multiple choice and true/false)`,
      `- Practice only — does not count toward your course grade`,
      `- Placed under **AI Content** (visible to you and instructors)`,
      '',
      `[Open practice quiz](${quiz.viewUrl})`,
    ].join('\n');

    await this.conversationService.appendMessages(action.conversationId, [
      { role: 'assistant', content: responseText },
    ]);

    return {
      response: responseText,
      conversationId: action.conversationId,
      quizUrl: quiz.viewUrl,
    };
  }

  async cancelAction(
    actionId: string,
    moodleUserId: number,
  ): Promise<ChatResponse> {
    const action = await this.pendingActionService.assertPendingOwned(
      actionId,
      moodleUserId,
    );
    await this.pendingActionService.markCancelled(actionId);

    const responseText =
      'Okay — I cancelled that practice quiz. Nothing was created in Moodle.';
    await this.conversationService.appendMessages(action.conversationId, [
      { role: 'assistant', content: responseText },
    ]);

    return {
      response: responseText,
      conversationId: action.conversationId,
    };
  }

  async getPendingAction(
    conversationId: string,
    moodleUserId: number,
  ): Promise<PendingActionDto | null> {
    await this.conversationService.assertOwner(conversationId, moodleUserId);
    const action = await this.pendingActionService.getPendingForConversation(
      conversationId,
      moodleUserId,
    );
    if (!action) {
      return null;
    }
    return {
      id: action.id,
      type: 'practice_quiz',
      title: action.payload.title,
      questionCount: action.payload.questionCount,
      scopeSummary: action.payload.scopeSummary,
    };
  }

  async getReviewOffer(
    conversationId: string,
    moodleUserId: number,
  ): Promise<ReviewOfferDto | null> {
    await this.conversationService.assertOwner(conversationId, moodleUserId);
    const action =
      await this.pendingActionService.getConfirmedPracticeQuizForConversation(
        conversationId,
        moodleUserId,
      );
    if (!action?.payload.quizId) {
      return null;
    }

    try {
      const review = await this.contextService.getPracticeAttemptReview(
        action.payload.quizId,
        moodleUserId,
      );
      if (!review.hasAttempt) {
        return null;
      }

      const explainedAttemptId = action.payload.explainedAttemptId ?? null;
      if (review.attemptId === explainedAttemptId) {
        return null;
      }

      const wrong = review.questions.filter((q) => !q.iscorrect);
      const total = review.questions.length || action.payload.questionCount;
      const score = Math.round(review.score);
      const maxScore = Math.round(review.maxScore) || total;

      if (wrong.length === 0) {
        // Perfect score — record this attempt so we don't keep prompting.
        await this.pendingActionService.markExplained(
          action.id,
          review.attemptId,
        );
        return null;
      }

      return {
        actionId: action.id,
        quizId: action.payload.quizId,
        title: action.payload.title,
        score,
        maxScore,
        wrongCount: wrong.length,
        total,
        scoreLabel: `${score}/${maxScore}`,
      };
    } catch (err) {
      this.logger.warn(
        `Failed to load review offer for conversation ${conversationId}: ${String(err)}`,
      );
      return null;
    }
  }

  async explainWrongAnswers(
    conversationId: string,
    moodleUserId: number,
  ): Promise<ChatResponse> {
    await this.conversationService.assertOwner(conversationId, moodleUserId);
    const action =
      await this.pendingActionService.getConfirmedPracticeQuizForConversation(
        conversationId,
        moodleUserId,
      );
    if (!action?.payload.quizId) {
      throw new BadRequestException(
        'No practice quiz ready for review in this conversation',
      );
    }

    const attempt = await this.contextService.getPracticeAttemptReview(
      action.payload.quizId,
      moodleUserId,
    );
    if (!attempt.hasAttempt) {
      throw new BadRequestException(
        'Finish the practice quiz in Moodle first, then ask me to explain',
      );
    }

    const wrong = attempt.questions.filter((q) => !q.iscorrect);
    if (wrong.length === 0) {
      await this.pendingActionService.markExplained(
        action.id,
        attempt.attemptId,
      );
      const responseText =
        'Nice work — you got everything right on that practice quiz. Nothing to walk through!';
      await this.conversationService.appendMessages(conversationId, [
        { role: 'assistant', content: responseText },
      ]);
      return { response: responseText, conversationId };
    }

    const filter = {
      sectionId: action.payload.sectionId,
      sectionNumber: action.payload.sectionNumber,
      sectionName: action.payload.sectionName,
    };

    const reviewBlocks: ReviewBlockDto[] = [];
    for (const q of wrong) {
      const query = `${q.questiontext} ${q.rightanswer}`.trim();
      const [material, citation] = await Promise.all([
        this.contextService.getContext(action.courseId, query, filter),
        this.contextService.findBestCitation(action.courseId, query, filter),
      ]);
      const why = await this.generateWrongAnswerExplanation({
        questiontext: q.questiontext,
        studentanswer: q.studentanswer,
        rightanswer: q.rightanswer,
        courseMaterial: material,
      });

      reviewBlocks.push({
        slot: q.slot,
        question: q.questiontext || q.name,
        studentAnswer: q.studentanswer || '(no answer)',
        rightAnswer: q.rightanswer || '(unavailable)',
        why,
        citationTitle: citation?.title ?? 'Course material',
        citationSnippet: citation?.snippet,
        citationUrl: citation?.url,
      });
    }

    await this.pendingActionService.markExplained(
      action.id,
      attempt.attemptId,
    );

    const score = Math.round(attempt.score);
    const maxScore = Math.round(attempt.maxScore) || attempt.questions.length;
    const responseText = buildReviewMessage({
      title: action.payload.title,
      score,
      maxScore,
      blocks: reviewBlocks,
    });

    await this.conversationService.appendMessages(conversationId, [
      { role: 'assistant', content: responseText },
    ]);

    return {
      response: responseText,
      conversationId,
      review: reviewBlocks,
    };
  }

  private async generateWrongAnswerExplanation(input: {
    questiontext: string;
    studentanswer: string;
    rightanswer: string;
    courseMaterial: string;
  }): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            why: { type: SchemaType.STRING },
          },
          required: ['why'],
        },
      },
    });

    const prompt = [
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

    const result = await model.generateContent(prompt);
    try {
      const parsed = JSON.parse(result.response.text()) as { why?: string };
      const why = (parsed.why ?? '').trim();
      if (why) {
        return why;
      }
    } catch {
      // fall through
    }
    return `The correct answer is "${input.rightanswer}". Your answer ("${input.studentanswer}") did not match. Review the related course section and try a similar question again.`;
  }

  private async generatePracticeQuestions(input: {
    title: string;
    scopeSummary: string;
    questionCount: number;
    courseMaterial: string;
  }): Promise<PracticeQuizQuestion[]> {
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            questions: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  type: {
                    type: SchemaType.STRING,
                    format: 'enum',
                    enum: ['multichoice', 'truefalse'],
                  },
                  name: { type: SchemaType.STRING },
                  questiontext: { type: SchemaType.STRING },
                  answers: {
                    type: SchemaType.ARRAY,
                    items: {
                      type: SchemaType.OBJECT,
                      properties: {
                        text: { type: SchemaType.STRING },
                        fraction: { type: SchemaType.NUMBER },
                      },
                      required: ['text', 'fraction'],
                    },
                  },
                },
                required: ['type', 'name', 'questiontext', 'answers'],
              },
            },
          },
          required: ['questions'],
        },
      },
    });

    const prompt = [
      `Create exactly ${input.questionCount} practice quiz questions for: ${input.title}`,
      `Scope: ${input.scopeSummary}`,
      'Use only multiple choice (exactly one correct answer, fraction 1.0) or true/false.',
      'For true/false, answers must be exactly two entries with text "True" and "False".',
      'For multichoice, provide 3–4 options; exactly one answer has fraction 1.0, others 0.',
      'Ground every question strictly in the course material below.',
      '',
      'Course material:',
      '---',
      input.courseMaterial.slice(0, 60000),
      '---',
    ].join('\n');

    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    const parsed = JSON.parse(raw) as { questions?: PracticeQuizQuestion[] };
    const questions = (parsed.questions ?? [])
      .map(normalizeQuestion)
      .filter((q): q is PracticeQuizQuestion => q !== null)
      .slice(0, input.questionCount);

    if (questions.length < 1) {
      throw new BadRequestException('Failed to generate quiz questions');
    }
    return questions;
  }
}

function clampQuestionCount(
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

function buildProposalMessage(input: {
  title: string;
  questionCount: number;
  scopeSummary: string;
  requestedCount?: number;
}): string {
  const lines = [
    `I can create a **private practice quiz** in Moodle for you.`,
    '',
    `**${input.title}**`,
    `- **${input.questionCount} questions** (multiple choice and true/false)`,
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

function buildReviewMessage(input: {
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
    lines.push(`**${block.slot}. ❌ ${block.question}**`);
    lines.push(
      `You answered: *${block.studentAnswer}* · Correct: *${block.rightAnswer}*`,
    );
    lines.push('');
    lines.push(`**Why:** ${block.why}`);
    lines.push('');
    if (block.citationUrl) {
      lines.push(
        `**From your course:** [${block.citationTitle}](${block.citationUrl})`,
      );
    } else {
      lines.push(`**From your course:** ${block.citationTitle}`);
    }
    if (block.citationSnippet) {
      lines.push(`> ${block.citationSnippet}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n').trim();
}

function normalizeQuestion(
  q: PracticeQuizQuestion,
): PracticeQuizQuestion | null {
  if (!q || (q.type !== 'multichoice' && q.type !== 'truefalse')) {
    return null;
  }
  const answers = (q.answers ?? [])
    .map((a) => ({
      text: String(a.text ?? '').trim(),
      fraction: Number(a.fraction) > 0 ? 1 : 0,
    }))
    .filter((a) => a.text.length > 0);

  if (q.type === 'truefalse') {
    const hasTrue = answers.some((a) => /^true$/i.test(a.text));
    const hasFalse = answers.some((a) => /^false$/i.test(a.text));
    if (!hasTrue || !hasFalse) {
      return null;
    }
  } else if (answers.length < 2 || !answers.some((a) => a.fraction === 1)) {
    return null;
  }

  return {
    type: q.type,
    name: (q.name || 'Practice question').slice(0, 200),
    questiontext: q.questiontext || '',
    answers,
  };
}

function buildSystemPrompt(ctx: {
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
    lines.push(`The student is currently viewing the course: ${ctx.courseName}.`);
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

type GeminiHistoryEntry = {
  role: 'user' | 'model';
  parts: [{ text: string }];
};

/** Gemini requires history to start with 'user' and alternate user/model turns. */
function toGeminiHistory(
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
