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
import { StudyGuideMoodleService } from '../context/study-guide-moodle.service';
import { ConversationService } from '../conversation/conversation.service';
import {
  buildSystemPrompt,
  PROPOSE_PRACTICE_QUIZ_TOOL,
  PROPOSE_STUDY_GUIDE_TOOL,
  PROPOSE_FLASHCARDS_TOOL,
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
import { StudyGuideGenerationService } from './study-guide-generation.service';
import { FlashcardsGenerationService } from './flashcards-generation.service';
import type {
  PracticeQuizPayload,
  StudyGuidePayload,
  FlashcardsPayload,
} from './entities/pending-action.entity';
import type { PendingAction } from './entities/pending-action.entity';
import {
  buildPracticeQuizContextFilter,
  buildProposalMessage,
  clampQuestionCount,
  QUIZ_QUESTION_COUNT_EXPLICIT_MAX,
  scrubQuizGenerationContext,
} from './practice-quiz.helpers';
import {
  buildStudyGuideContextFilter,
  buildStudyGuideProposalMessage,
  scrubStudyGuideContext,
} from './study-guide.helpers';
import {
  buildFlashcardsContextFilter,
  buildFlashcardsProposalMessage,
  clampCardCount,
  FLASHCARD_COUNT_EXPLICIT_MAX,
  scrubFlashcardsContext,
} from './flashcards.helpers';

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
    private readonly studyGuideMoodle: StudyGuideMoodleService,
    private readonly conversationService: ConversationService,
    private readonly pendingActionService: PendingActionService,
    private readonly practiceQuizGeneration: PracticeQuizGenerationService,
    private readonly practiceQuizReview: PracticeQuizReviewService,
    private readonly studyGuideGeneration: StudyGuideGenerationService,
    private readonly flashcardsGeneration: FlashcardsGenerationService,
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

    const canProposeContent =
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
        canProposeContent,
      }),
      tools: canProposeContent
        ? ([
            {
              functionDeclarations: [
                PROPOSE_PRACTICE_QUIZ_TOOL,
                PROPOSE_STUDY_GUIDE_TOOL,
                PROPOSE_FLASHCARDS_TOOL,
              ],
            },
          ] as Tool[])
        : undefined,
      toolConfig: canProposeContent
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

    const proposeQuizCall = functionCalls.find(
      (call) => call.name === 'propose_practice_quiz',
    );
    const proposeGuideCall = functionCalls.find(
      (call) => call.name === 'propose_study_guide',
    );
    const proposeFlashcardsCall = functionCalls.find(
      (call) => call.name === 'propose_flashcards',
    );

    if (proposeQuizCall && moodleUserId && courseId > 1) {
      const args = (proposeQuizCall.args ?? {}) as {
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
    } else if (proposeGuideCall && moodleUserId && courseId > 1) {
      const args = (proposeGuideCall.args ?? {}) as {
        title?: string;
        scopeSummary?: string;
      };
      const title = (args.title ?? '').trim() || 'Study guide';
      const scopeSummary =
        (args.scopeSummary ?? '').trim() ||
        'Course material from the current conversation';

      const action = await this.pendingActionService.createStudyGuideProposal({
        conversationId,
        courseId,
        moodleUserId,
        payload: {
          title,
          scopeSummary,
          sectionId: conversation.sectionId,
          sectionNumber: conversation.sectionNumber,
          sectionName: conversation.sectionName,
        },
      });

      pendingAction = {
        id: action.id,
        type: 'study_guide',
        title,
        scopeSummary,
      };

      responseText = buildStudyGuideProposalMessage({ title, scopeSummary });
    } else if (proposeFlashcardsCall && moodleUserId && courseId > 1) {
      const args = (proposeFlashcardsCall.args ?? {}) as {
        title?: string;
        scopeSummary?: string;
        cardCount?: number;
        countSpecifiedByStudent?: boolean;
      };
      const requestedCount =
        typeof args.cardCount === 'number'
          ? args.cardCount
          : Number(args.cardCount);
      const countSpecifiedByStudent = args.countSpecifiedByStudent === true;
      const cardCount = clampCardCount(
        requestedCount,
        countSpecifiedByStudent,
      );
      const exceededMax =
        countSpecifiedByStudent &&
        Number.isFinite(requestedCount) &&
        Math.round(requestedCount) > FLASHCARD_COUNT_EXPLICIT_MAX;
      const title = (args.title ?? '').trim() || 'Flashcards';
      const scopeSummary =
        (args.scopeSummary ?? '').trim() ||
        'Course material from the current conversation';

      const action = await this.pendingActionService.createFlashcardsProposal({
        conversationId,
        courseId,
        moodleUserId,
        payload: {
          title,
          scopeSummary,
          cardCount,
          sectionId: conversation.sectionId,
          sectionNumber: conversation.sectionNumber,
          sectionName: conversation.sectionName,
        },
      });

      pendingAction = {
        id: action.id,
        type: 'flashcards',
        title,
        cardCount,
        scopeSummary,
      };

      responseText = buildFlashcardsProposalMessage({
        title,
        scopeSummary,
        cardCount,
        requestedCount: exceededMax ? Math.round(requestedCount) : undefined,
      });
    } else {
      try {
        responseText = result.response.text();
      } catch {
        responseText =
          'I can help with course questions, or create a private practice quiz, study guide, or flashcards in Moodle when you ask for one.';
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

    if (action.type === 'practice_quiz') {
      return this.confirmPracticeQuiz(action, moodleUserId);
    }
    if (action.type === 'study_guide') {
      return this.confirmStudyGuide(action, moodleUserId);
    }
    if (action.type === 'flashcards') {
      return this.confirmFlashcards(action, moodleUserId);
    }

    throw new BadRequestException('Unsupported action type');
  }

  private async confirmPracticeQuiz(
    action: PendingAction,
    moodleUserId: number,
  ): Promise<ChatResponse> {
    const payload = action.payload as PracticeQuizPayload;
    const {
      title,
      scopeSummary,
      questionCount,
      sectionId,
      sectionNumber,
      sectionName,
    } = payload;

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
      ...payload,
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
      `Generating ${questionCount} practice questions for action ${action.id}` +
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

    await this.pendingActionService.markConfirmedWithQuiz(action.id, {
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

  private async confirmStudyGuide(
    action: PendingAction,
    moodleUserId: number,
  ): Promise<ChatResponse> {
    const payload = action.payload as StudyGuidePayload;
    const { title, scopeSummary, sectionId, sectionNumber, sectionName } =
      payload;

    const resolved = await this.contextService.resolveSectionsFromScope(
      action.courseId,
      scopeSummary,
      { sectionId, sectionNumber, sectionName },
    );
    if (resolved.unresolvedSpecificScope) {
      throw new BadRequestException(
        `Could not match "${scopeSummary}" to course week/section names. ` +
          'Try using the exact Moodle section titles (for example "Week 13"), or ask for a general topic study guide.',
      );
    }
    const filter = buildStudyGuideContextFilter({
      ...payload,
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
          ? 'No course material found in the requested weeks/sections to generate a study guide'
          : 'No course material available to generate a study guide',
      );
    }

    this.logger.log(
      `Generating study guide for action ${action.id}` +
        (resolved.sectionIds.length > 0
          ? ` (hard-scoped to sections [${resolved.sectionNumbers.join(', ')}])`
          : ' (course-wide scope)'),
    );

    const { document, html } =
      await this.studyGuideGeneration.generateStudyGuide({
        title,
        scopeSummary,
        courseMaterial: scrubStudyGuideContext(courseMaterial),
      });

    const page = await this.studyGuideMoodle.createStudyGuide({
      courseId: action.courseId,
      moodleUserId,
      name: document.title || title,
      intro:
        'Study guide created by Syllentras AI. This is a private practice aid and is not graded.',
      contentHtml: html,
    });

    await this.pendingActionService.markConfirmedWithPage(action.id, {
      pageId: page.pageId,
      cmId: page.cmId,
      viewUrl: page.viewUrl,
      sectionIds: resolved.sectionIds,
      sectionNumbers: resolved.sectionNumbers,
    });

    const responseText = [
      `Your study guide **${page.name}** is ready.`,
      '',
      `- ${document.sections.length} sections of study notes`,
      `- Practice aid only — not graded`,
      `- Placed under **AI Content** (visible to you and instructors)`,
      '',
      `[Open study guide](${page.viewUrl})`,
    ].join('\n');

    await this.conversationService.appendMessages(action.conversationId, [
      { role: 'assistant', content: responseText },
    ]);

    return {
      response: responseText,
      conversationId: action.conversationId,
      studyGuideUrl: page.viewUrl,
    };
  }

  private async confirmFlashcards(
    action: PendingAction,
    moodleUserId: number,
  ): Promise<ChatResponse> {
    const payload = action.payload as FlashcardsPayload;
    const {
      title,
      scopeSummary,
      cardCount,
      sectionId,
      sectionNumber,
      sectionName,
    } = payload;

    const resolved = await this.contextService.resolveSectionsFromScope(
      action.courseId,
      scopeSummary,
      { sectionId, sectionNumber, sectionName },
    );
    if (resolved.unresolvedSpecificScope) {
      throw new BadRequestException(
        `Could not match "${scopeSummary}" to course week/section names. ` +
          'Try using the exact Moodle section titles (for example "Week 13"), or ask for a general topic flashcard set.',
      );
    }
    const filter = buildFlashcardsContextFilter({
      ...payload,
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
          ? 'No course material found in the requested weeks/sections to generate flashcards'
          : 'No course material available to generate flashcards',
      );
    }

    this.logger.log(
      `Generating ${cardCount} flashcards for action ${action.id}` +
        (resolved.sectionIds.length > 0
          ? ` (hard-scoped to sections [${resolved.sectionNumbers.join(', ')}])`
          : ' (course-wide scope)'),
    );

    const { document, html } =
      await this.flashcardsGeneration.generateFlashcards({
        title,
        scopeSummary,
        cardCount,
        courseMaterial: scrubFlashcardsContext(courseMaterial),
      });

    const page = await this.studyGuideMoodle.createPrivatePage({
      courseId: action.courseId,
      moodleUserId,
      name: document.title || title,
      intro:
        'Flashcards created by Syllentras AI. This is a private practice aid and is not graded.',
      contentHtml: html,
    });

    await this.pendingActionService.markConfirmedWithPage(action.id, {
      pageId: page.pageId,
      cmId: page.cmId,
      viewUrl: page.viewUrl,
      sectionIds: resolved.sectionIds,
      sectionNumbers: resolved.sectionNumbers,
    });

    const responseText = [
      `Your flashcards **${page.name}** are ready.`,
      '',
      `- ${document.cards.length} cards (expand to reveal answers)`,
      `- Practice aid only — not graded`,
      `- Placed under **AI Content** (visible to you and instructors)`,
      '',
      `[Open flashcards](${page.viewUrl})`,
    ].join('\n');

    await this.conversationService.appendMessages(action.conversationId, [
      { role: 'assistant', content: responseText },
    ]);

    return {
      response: responseText,
      conversationId: action.conversationId,
      flashcardsUrl: page.viewUrl,
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
      action.type === 'study_guide'
        ? 'Okay — I cancelled that study guide. Nothing was created in Moodle.'
        : action.type === 'flashcards'
          ? 'Okay — I cancelled those flashcards. Nothing was created in Moodle.'
          : 'Okay — I cancelled that practice quiz. Nothing was created in Moodle.';
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
    return this.toPendingActionDto(action);
  }

  private toPendingActionDto(action: PendingAction): PendingActionDto {
    if (action.type === 'study_guide') {
      const payload = action.payload as StudyGuidePayload;
      return {
        id: action.id,
        type: 'study_guide',
        title: payload.title,
        scopeSummary: payload.scopeSummary,
      };
    }
    if (action.type === 'flashcards') {
      const payload = action.payload as FlashcardsPayload;
      return {
        id: action.id,
        type: 'flashcards',
        title: payload.title,
        scopeSummary: payload.scopeSummary,
        cardCount: payload.cardCount,
      };
    }
    const payload = action.payload as PracticeQuizPayload;
    return {
      id: action.id,
      type: 'practice_quiz',
      title: payload.title,
      questionCount: payload.questionCount,
      scopeSummary: payload.scopeSummary,
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
