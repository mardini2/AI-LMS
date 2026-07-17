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
  type Tool,
} from '@google/generative-ai';
import { ContextService } from '../context/context.service';
import type {
  CourseContextFilter,
  PracticeQuizQuestion,
} from '../context/context.types';
import { PracticeQuizMoodleService } from '../context/practice-quiz-moodle.service';
import { ConversationService } from '../conversation/conversation.service';
import {
  buildPracticeQuestionsPrompt,
  buildSystemPrompt,
  buildWrongAnswerExplanationPrompt,
  PROPOSE_PRACTICE_QUIZ_TOOL,
  toGeminiHistory,
} from './chat.prompts';
import { PendingActionService } from './pending-action.service';
import type { PracticeQuizPayload } from './entities/pending-action.entity';
import { SendMessageDto } from './dto/send-message.dto';
import {
  buildPracticeQuizContextFilter,
  buildProposalMessage,
  buildReviewMessage,
  clampQuestionCount,
  normalizeQuestion,
  questionDedupeKey,
  QUIZ_QUESTION_COUNT_EXPLICIT_MAX,
  scrubQuizGenerationContext,
} from './practice-quiz.helpers';

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

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly genAI: GoogleGenerativeAI;

  constructor(
    private readonly config: ConfigService,
    private readonly contextService: ContextService,
    private readonly practiceQuizMoodle: PracticeQuizMoodleService,
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

    const resolved = await this.contextService.resolveSectionsFromScope(
      action.courseId,
      scopeSummary,
      { sectionId, sectionNumber, sectionName },
    );
    if (resolved.unresolvedSpecificScope) {
      throw new BadRequestException(
        `Could not match "${scopeSummary}" to course week/section names. ` +
          'Try using the exact Moodle section titles (for example "Week 13"), or ask for a general topic quiz.',
      );
    }
    const filter = buildPracticeQuizContextFilter({
      ...action.payload,
      sectionIds: resolved.sectionIds,
      sectionNumbers: resolved.sectionNumbers,
    });

    const courseMaterial = await this.contextService.getContext(
      action.courseId,
      `${title} ${scopeSummary}`,
      filter,
    );

    if (!courseMaterial.trim()) {
      throw new BadRequestException(
        resolved.sectionIds.length > 0
          ? 'No course material found in the requested weeks/sections to generate quiz questions'
          : 'No course material available to generate quiz questions',
      );
    }

    this.logger.log(
      `Generating ${questionCount} practice questions for action ${actionId}` +
        (resolved.sectionIds.length > 0
          ? ` (hard-scoped to sections [${resolved.sectionNumbers.join(', ')}])`
          : ' (course-wide scope)'),
    );
    const questions = await this.generatePracticeQuestions({
      title,
      scopeSummary,
      questionCount,
      courseMaterial: scrubQuizGenerationContext(courseMaterial),
    });

    const quiz = await this.practiceQuizMoodle.createPracticeQuiz({
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
      sectionIds: resolved.sectionIds,
      sectionNumbers: resolved.sectionNumbers,
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
      const review = await this.practiceQuizMoodle.getPracticeAttemptReview(
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

    const attempt = await this.practiceQuizMoodle.getPracticeAttemptReview(
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

    const filter = await this.resolvePracticeQuizFilter(action);

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

  /**
   * Prefer persisted sectionIds from confirm; re-resolve for older actions.
   */
  private async resolvePracticeQuizFilter(action: {
    courseId: number;
    payload: PracticeQuizPayload;
  }): Promise<CourseContextFilter> {
    const payload = action.payload;
    if (payload.sectionIds && payload.sectionIds.length > 0) {
      return buildPracticeQuizContextFilter(payload);
    }

    const resolved = await this.contextService.resolveSectionsFromScope(
      action.courseId,
      payload.scopeSummary,
      {
        sectionId: payload.sectionId,
        sectionNumber: payload.sectionNumber,
        sectionName: payload.sectionName,
      },
    );

    return buildPracticeQuizContextFilter({
      ...payload,
      sectionIds: resolved.sectionIds,
      sectionNumbers: resolved.sectionNumbers,
    });
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

    const prompt = buildWrongAnswerExplanationPrompt(input);

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

    const parseAndNormalize = (raw: string): PracticeQuizQuestion[] => {
      const parsed = JSON.parse(raw) as { questions?: PracticeQuizQuestion[] };
      return (parsed.questions ?? [])
        .map(normalizeQuestion)
        .filter((q): q is PracticeQuizQuestion => q !== null);
    };

    const accepted: PracticeQuizQuestion[] = [];
    const seenKeys = new Set<string>();
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const needed = input.questionCount - accepted.length;
      if (needed <= 0) {
        break;
      }

      const batch = parseAndNormalize(
        (
          await model.generateContent(
            buildPracticeQuestionsPrompt(input, needed, accepted),
          )
        ).response.text(),
      );

      let added = 0;
      for (const q of batch) {
        if (accepted.length >= input.questionCount) {
          break;
        }
        const key = questionDedupeKey(q.questiontext);
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        accepted.push(q);
        added += 1;
      }

      this.logger.log(
        `Practice quiz gen attempt ${attempt + 1}: +${added} unique ` +
          `(${accepted.length}/${input.questionCount} total)`,
      );

      if (accepted.length >= input.questionCount) {
        break;
      }
    }

    if (accepted.length < 1) {
      throw new BadRequestException('Failed to generate quiz questions');
    }
    if (accepted.length < input.questionCount) {
      throw new BadRequestException(
        `Could only produce ${accepted.length} of ${input.questionCount} valid concept questions. ` +
          'Try again, or ask for fewer questions.',
      );
    }

    return accepted.slice(0, input.questionCount);
  }
}
