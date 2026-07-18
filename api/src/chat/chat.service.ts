import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  FunctionCallingMode,
  HarmBlockThreshold,
  HarmCategory,
  type Tool,
} from '@google/generative-ai';
import { ContextService } from '../context/context.service';
import { PracticeQuizMoodleService } from '../context/practice-quiz-moodle.service';
import { ConversationService } from '../conversation/conversation.service';
import {
  buildSystemPrompt,
  PROPOSE_PRACTICE_QUIZ_TOOL,
  toGeminiHistory,
} from './chat.prompts';
import type {
  ChatResponse,
  PendingActionDto,
  ReviewOfferDto,
} from './chat.types';
import { GeminiClient } from './gemini.client';
import { PendingActionService } from './pending-action.service';
import { SendMessageDto } from './dto/send-message.dto';
import { PracticeQuizGenerationService } from './practice-quiz-generation.service';
import { PracticeQuizReviewService } from './practice-quiz-review.service';
import {
  buildPracticeQuizContextFilter,
  buildProposalMessage,
  clampQuestionCount,
  QUIZ_QUESTION_COUNT_EXPLICIT_MAX,
  scrubQuizGenerationContext,
} from './practice-quiz.helpers';

export type {
  ChatResponse,
  PendingActionDto,
  ReviewBlockDto,
  ReviewOfferDto,
} from './chat.types';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly gemini: GeminiClient,
    private readonly contextService: ContextService,
    private readonly practiceQuizMoodle: PracticeQuizMoodleService,
    private readonly conversationService: ConversationService,
    private readonly pendingActionService: PendingActionService,
    private readonly practiceQuizGeneration: PracticeQuizGenerationService,
    private readonly practiceQuizReview: PracticeQuizReviewService,
  ) {}

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

    const model = this.gemini.getGenerativeModel({
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
      const title = (args.title ?? '').trim() || 'Practice quiz';
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

    const {
      title,
      scopeSummary,
      questionCount,
      sectionId,
      sectionNumber,
      sectionName,
    } = action.payload;

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
    const questions =
      await this.practiceQuizGeneration.generatePracticeQuestions({
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
    return this.practiceQuizReview.getReviewOffer(
      conversationId,
      moodleUserId,
    );
  }

  async explainWrongAnswers(
    conversationId: string,
    moodleUserId: number,
  ): Promise<ChatResponse> {
    return this.practiceQuizReview.explainWrongAnswers(
      conversationId,
      moodleUserId,
    );
  }
}
