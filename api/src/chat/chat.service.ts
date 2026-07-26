import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ContextService } from '../context/context.service';
import { PracticeQuizMoodleService } from '../context/practice-quiz-moodle.service';
import { StudyGuideMoodleService } from '../context/study-guide-moodle.service';
import { ConversationService } from '../conversation/conversation.service';
import { buildSystemPrompt } from './chat.prompts';
import type {
  ChatResponse,
  PendingActionDto,
  ReviewOfferDto,
} from './chat.types';
import { PendingActionService } from './pending-action.service';
import { SendMessageDto } from './dto/send-message.dto';
import { PracticeQuizGenerationService } from './practice-quiz-generation.service';
import { PracticeQuizReviewService } from './practice-quiz-review.service';
import { StudyGuideGenerationService } from './study-guide-generation.service';
import { FlashcardsGenerationService } from './flashcards-generation.service';
import { TopicSuggestionsService } from './topic-suggestions.service';
import { withKindTitlePrefix, stripKindTitlePrefix } from './ai-content-title';
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
  formatQuizDifficultyLabel,
  normalizeQuizDifficulty,
  QUIZ_QUESTION_COUNT_EXPLICIT_MAX,
  scrubQuizGenerationContext,
} from './practice-quiz.helpers';
import {
  buildStudyGuideContextFilter,
  buildStudyGuideProposalMessage,
  scrubStudyGuideContext,
  stripUnsafeText,
} from './study-guide.helpers';
import {
  buildFlashcardsContextFilter,
  buildFlashcardsProposalMessage,
  clampCardCount,
  FLASHCARD_COUNT_EXPLICIT_MAX,
  scrubFlashcardsContext,
} from './flashcards.helpers';
import {
  AiProviderRegistry,
  STUDY_PROPOSAL_TOOLS,
  type LlmProvider,
} from './providers';
import {
  formatHistoryForLog,
  logGreetingDebug,
  shouldLogGreetingDebug,
} from './greeting-debug';

export type {
  ChatResponse,
  PendingActionDto,
  ReviewBlockDto,
  ReviewOfferDto,
} from './chat.types';

/**
 * Remove leading ceremonial greeting(s) from assistant text.
 * Used for provider history normalization and follow-up response cleanup.
 * Loops so stacked openers like "Hello Admin! Welcome to …" are fully cleared.
 */
export function stripLeadingAssistantGreeting(
  text: string,
  userFirstName?: string,
): string {
  if (!text?.trim()) {
    return text;
  }

  const patterns: RegExp[] = [
    /^(?:hi|hello|hey)\s*[,!.]\s*/i,
    /^welcome(?:\s+back)?(?:\s*,?\s*[^\n!.?]{0,40})?[,!.]?\s*/i,
  ];
  const firstName = userFirstName?.trim();
  if (firstName) {
    const escapedName = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Prefer the named form first so "Hi Admin, …" is stripped cleanly.
    patterns.unshift(
      new RegExp(
        `^(?:hi|hello|hey)\\s*,?\\s*${escapedName}\\s*[,!.]?\\s*\\n*`,
        'i',
      ),
    );
  }

  let result = text;
  for (let i = 0; i < 3; i++) {
    let stripped = false;
    for (const pattern of patterns) {
      const next = result.replace(pattern, '').trimStart();
      if (next && next !== result) {
        result = next;
        stripped = true;
        break;
      }
    }
    if (!stripped) break;
  }
  return result || text;
}

/**
 * Strip a leading ceremonial greeting when the chat has already started
 * (or is a section chat that already has its own intro).
 */
export function preventRepeatedGreeting(
  text: string,
  shouldStrip: boolean,
  userFirstName?: string,
): string {
  if (!shouldStrip) {
    return text;
  }
  return stripLeadingAssistantGreeting(text, userFirstName);
}

/**
 * Normalize history for the LLM only: strip greeting prefixes from assistant
 * turns so prior "Hi/Hello …" openings are not replayed as few-shot examples.
 * User messages are unchanged. Callers must not persist this result.
 */
export function normalizeHistoryForLlm(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userFirstName?: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return history.map((entry) => {
    if (entry.role !== 'assistant') {
      return entry;
    }
    return {
      ...entry,
      content: stripLeadingAssistantGreeting(entry.content, userFirstName),
    };
  });
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly providers: AiProviderRegistry,
    private readonly contextService: ContextService,
    private readonly practiceQuizMoodle: PracticeQuizMoodleService,
    private readonly studyGuideMoodle: StudyGuideMoodleService,
    private readonly conversationService: ConversationService,
    private readonly pendingActionService: PendingActionService,
    private readonly practiceQuizGeneration: PracticeQuizGenerationService,
    private readonly practiceQuizReview: PracticeQuizReviewService,
    private readonly studyGuideGeneration: StudyGuideGenerationService,
    private readonly flashcardsGeneration: FlashcardsGenerationService,
    private readonly topicSuggestions: TopicSuggestionsService,
  ) {}

  listProviders() {
    return {
      providers: this.providers.listProviders(),
      defaultProviderId: this.providers.getDefaultProviderId(),
    };
  }

  async sendMessage(dto: SendMessageDto): Promise<ChatResponse> {
    const {
      courseId,
      courseName,
      moodleUserId,
      userFirstName,
      message,
      conversationId: incomingConvId,
      provider: requestedProvider,
    } = dto;
    const mode = dto.mode === 'coach' ? 'coach' : 'direct';
    const guidance =
      mode === 'coach'
        ? Math.min(5, Math.max(1, Math.round(dto.guidance ?? 3)))
        : undefined;
    const llm = this.providers.resolve(requestedProvider);

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
              title: courseId > 1 ? 'Main' : 'Home',
            },
          )
        : await this.conversationService.create(courseId, moodleUserId);
      conversationId = conversation.id;
    }

    const conversation =
      await this.conversationService.findById(conversationId);

    const [
      courseMaterial,
      resolvedCourseName,
      enrolledCourses,
      conversationStarted,
      dbHistory,
    ] = await Promise.all([
      this.contextService.getContext(courseId, message, {
        sectionId: conversation.sectionId,
        sectionNumber: conversation.sectionNumber,
        sectionName: conversation.sectionName,
      }),
      this.contextService.resolveCourseName(courseId, courseName),
      moodleUserId
        ? this.contextService.getEnrolledCourseNames(moodleUserId)
        : Promise.resolve([]),
      this.conversationService.hasUserMessages(conversationId),
      this.conversationService.getRecentHistory(conversationId, 20),
    ]);

    const canProposeContent =
      Boolean(moodleUserId) && courseId > 1 && Boolean(courseMaterial);
    // Section chats already show "What would you like to know about …?" — never re-greet.
    const mayGreet =
      !conversationStarted && (conversation.type ?? 'general') === 'general';
    const priorUserTurns = dbHistory.filter((m) => m.role === 'user').length;
    const systemInstruction = buildSystemPrompt({
      courseId,
      courseName: resolvedCourseName,
      userFirstName,
      enrolledCourses,
      conversationTitle: conversation.title,
      conversationType: conversation.type ?? 'general',
      sectionName: conversation.sectionName,
      courseMaterial,
      canProposeContent,
      mode,
      guidance,
      conversationStarted,
    });
    // Provider-only view: do not persist or return this to the UI.
    const providerHistory = normalizeHistoryForLlm(dbHistory, userFirstName);
    const debugSecondTurn = shouldLogGreetingDebug(priorUserTurns);

    if (debugSecondTurn) {
      logGreetingDebug(
        'REQUEST',
        [
          `conversationId: ${conversationId}`,
          `conversationType: ${conversation.type ?? 'general'}`,
          `priorUserTurns: ${priorUserTurns}`,
          `allowGreeting: ${mayGreet}`,
          `providerId: ${llm.id}`,
          '',
          '----- SYSTEM PROMPT -----',
          systemInstruction,
          '',
          '----- HISTORY (DB, unchanged) -----',
          formatHistoryForLog(dbHistory),
          '',
          '----- HISTORY (SENT TO PROVIDER, normalized) -----',
          formatHistoryForLog(providerHistory),
          '',
          '----- USER MESSAGE -----',
          message,
        ].join('\n'),
      );
    }

    this.logger.log(
      `Sending message for conversation ${conversationId} via ${llm.id}`,
    );
    const result = await llm.chat({
      systemInstruction,
      history: providerHistory,
      message,
      tools: canProposeContent ? STUDY_PROPOSAL_TOOLS : undefined,
    });

    if (debugSecondTurn) {
      logGreetingDebug(
        'RAW PROVIDER RESPONSE',
        [
          `conversationId: ${conversationId}`,
          `providerId: ${llm.id}`,
          `toolCalls: ${JSON.stringify(result.toolCalls ?? [])}`,
          '',
          '----- RAW PROVIDER RESPONSE -----',
          result.text ?? '(empty text)',
        ].join('\n'),
      );
    }

    const functionCalls = result.toolCalls ?? [];

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
        difficulty?: string;
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
        stripKindTitlePrefix((args.title ?? '').trim()) || 'Practice topics';
      const scopeSummary =
        (args.scopeSummary ?? '').trim() ||
        'Course material from the current conversation';
      const difficulty = normalizeQuizDifficulty(args.difficulty);

      const action = await this.pendingActionService.createPracticeQuizProposal({
        conversationId,
        courseId,
        moodleUserId,
        payload: {
          title,
          scopeSummary,
          questionCount,
          difficulty,
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
        difficulty,
        scopeSummary,
      };

      responseText = buildProposalMessage({
        title,
        questionCount,
        scopeSummary,
        difficulty,
        requestedCount: exceededMax ? Math.round(requestedCount) : undefined,
      });
    } else if (proposeGuideCall && moodleUserId && courseId > 1) {
      const args = (proposeGuideCall.args ?? {}) as {
        title?: string;
        scopeSummary?: string;
      };
      const title =
        stripKindTitlePrefix((args.title ?? '').trim()) || 'Course review';
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
      const title =
        stripKindTitlePrefix((args.title ?? '').trim()) || 'Key terms';
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
      const rawText =
        result.text?.trim() ||
        'I can help with course questions, or create a private study guide, flashcards, or practice quiz in Moodle when you ask for one.';
      responseText = preventRepeatedGreeting(
        rawText,
        !mayGreet,
        userFirstName,
      );
      if (debugSecondTurn) {
        logGreetingDebug(
          'POST-PROCESS',
          [
            `conversationId: ${conversationId}`,
            `allowGreeting: ${mayGreet}`,
            `preventRepeatedGreetingApplied: ${!mayGreet}`,
            `rawEqualsFinal: ${rawText === responseText}`,
            '',
            '----- FINAL RESPONSE AFTER PROCESSING -----',
            responseText,
          ].join('\n'),
        );
      }
    }

    await this.conversationService.appendMessages(conversationId, [
      { role: 'user', content: message, mode, guidance: guidance ?? null },
      {
        role: 'assistant',
        content: responseText,
        mode,
        guidance: guidance ?? null,
      },
    ]);

    let topicSuggestions = normalizeReturnedTopics(conversation.topicSuggestions);

    if (courseId > 1 && message.trim()) {
      const historyForTopics = [
        ...dbHistory.slice(-6),
        { role: 'user' as const, content: message },
        { role: 'assistant' as const, content: responseText },
      ];
      const refreshed = await this.topicSuggestions.suggestTopics(
        {
          courseName: resolvedCourseName,
          sectionName: conversation.sectionName,
          recentTurns: historyForTopics,
        },
        llm,
      );
      if (refreshed.length) {
        topicSuggestions =
          await this.conversationService.updateTopicSuggestions(
            conversationId,
            refreshed,
          );
      }
    }

    return {
      response: responseText,
      conversationId,
      pendingAction,
      topicSuggestions,
      provider: llm.id,
      mode,
      guidance,
    };
  }

  async confirmAction(
    actionId: string,
    moodleUserId: number,
    edits?: { title?: string; count?: number; difficulty?: string },
    providerId?: string,
  ): Promise<ChatResponse> {
    const llm = this.providers.resolve(providerId);
    let action = await this.pendingActionService.assertPendingOwned(
      actionId,
      moodleUserId,
    );

    if (
      edits?.title !== undefined ||
      edits?.count !== undefined ||
      edits?.difficulty !== undefined
    ) {
      action = await this.applyConfirmEdits(action, edits);
    }

    if (action.type === 'practice_quiz') {
      return this.confirmPracticeQuiz(action, moodleUserId, llm);
    }
    if (action.type === 'study_guide') {
      return this.confirmStudyGuide(action, moodleUserId, llm);
    }
    if (action.type === 'flashcards') {
      return this.confirmFlashcards(action, moodleUserId, llm);
    }

    throw new BadRequestException('Unsupported action type');
  }

  private async applyConfirmEdits(
    action: PendingAction,
    edits: { title?: string; count?: number; difficulty?: string },
  ): Promise<PendingAction> {
    const payload = { ...action.payload } as
      | PracticeQuizPayload
      | StudyGuidePayload
      | FlashcardsPayload;

    if (edits.title !== undefined) {
      const title = stripKindTitlePrefix(
        stripUnsafeText(edits.title).trim(),
      ).slice(0, 200);
      if (!title) {
        throw new BadRequestException('Title cannot be empty');
      }
      payload.title = title;
    }

    if (edits.count !== undefined) {
      if (action.type === 'practice_quiz') {
        (payload as PracticeQuizPayload).questionCount = clampQuestionCount(
          edits.count,
          true,
        );
      } else if (action.type === 'flashcards') {
        (payload as FlashcardsPayload).cardCount = clampCardCount(
          edits.count,
          true,
        );
      }
      // study_guide: count is ignored
    }

    if (edits.difficulty !== undefined && action.type === 'practice_quiz') {
      (payload as PracticeQuizPayload).difficulty = normalizeQuizDifficulty(
        edits.difficulty,
      );
    }

    return this.pendingActionService.updatePendingPayload(action.id, payload);
  }

  private async confirmPracticeQuiz(
    action: PendingAction,
    moodleUserId: number,
    llm: LlmProvider,
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
    const difficulty = normalizeQuizDifficulty(payload.difficulty);

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
        ` (difficulty=${difficulty})` +
        (resolved.sectionIds.length > 0
          ? ` (hard-scoped to sections [${resolved.sectionNumbers.join(', ')}])`
          : ' (course-wide scope)'),
    );
    const questions =
      await this.practiceQuizGeneration.generatePracticeQuestions(
        {
          title,
          scopeSummary,
          questionCount,
          difficulty,
          courseMaterial: scrubQuizGenerationContext(courseMaterial),
        },
        llm,
      );

    const quiz = await this.practiceQuizMoodle.createPracticeQuiz({
      courseId: action.courseId,
      moodleUserId,
      name: withKindTitlePrefix(title, 'practice_quiz'),
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
      `- Difficulty: **${formatQuizDifficultyLabel(difficulty)}**`,
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
      provider: llm.id,
    };
  }

  private async confirmStudyGuide(
    action: PendingAction,
    moodleUserId: number,
    llm: LlmProvider,
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
      await this.studyGuideGeneration.generateStudyGuide(
        {
          title,
          scopeSummary,
          courseMaterial: scrubStudyGuideContext(courseMaterial),
        },
        llm,
      );

    const page = await this.studyGuideMoodle.createStudyGuide({
      courseId: action.courseId,
      moodleUserId,
      name: withKindTitlePrefix(document.title || title, 'study_guide'),
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
      provider: llm.id,
    };
  }

  private async confirmFlashcards(
    action: PendingAction,
    moodleUserId: number,
    llm: LlmProvider,
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
      await this.flashcardsGeneration.generateFlashcards(
        {
          title,
          scopeSummary,
          cardCount,
          courseMaterial: scrubFlashcardsContext(courseMaterial),
        },
        llm,
      );

    const page = await this.studyGuideMoodle.createPrivatePage({
      courseId: action.courseId,
      moodleUserId,
      name: withKindTitlePrefix(document.title || title, 'flashcards'),
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
      provider: llm.id,
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
      difficulty: normalizeQuizDifficulty(payload.difficulty),
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
    providerId?: string,
  ): Promise<ChatResponse> {
    const llm = this.providers.resolve(providerId);
    return this.practiceQuizReview.explainWrongAnswers(
      conversationId,
      moodleUserId,
      llm,
    );
  }
}

function normalizeReturnedTopics(
  topics?: string[] | null,
): string[] | undefined {
  if (!Array.isArray(topics) || !topics.length) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of topics) {
    if (typeof raw !== 'string') continue;
    const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 3) break;
  }
  return out.length ? out : undefined;
}
