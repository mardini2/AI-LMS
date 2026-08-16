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
  StartMessageTurnResponse,
} from './chat.types';
import { PendingActionService } from './pending-action.service';
import { SendMessageDto } from './dto/send-message.dto';
import { CompleteMessageDto } from './dto/complete-message.dto';
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
  SUGGEST_OPENABLE_LINKS_TOOL,
  type LlmProvider,
} from './providers';
import {
  formatHistoryForLog,
  logGreetingDebug,
  shouldLogGreetingDebug,
} from './greeting-debug';
import { ChatAttachmentsService } from './attachments/chat-attachments.service';
import {
  isPrimaryGratitudeMessage,
  pickGratitudeReply,
} from './chat-gratitude';
import {
  buildLinkFetchPromptBlock,
  buildSuggestedLinks,
  buildSuggestedLinksReply,
  extractHttpUrls,
  fetchLinkedPagesFromMessage,
  linkFetchWarningMessages,
  pickOutboundSuggestedLinks,
  type LinkFetchBatch,
  type SuggestedLink,
} from './link-fetch';
import type { LlmTool } from './providers/provider.types';

const EMPTY_LLM_REPLY_FALLBACK =
  'I could not generate a reply just now. Please try again, or paste a specific article URL if you want me to read a page.';

const SAFETY_LLM_REPLY_FALLBACK =
  "I couldn't complete that reply. Please ask again.";

function emptyLlmFallback(finishReason?: string): string {
  const reason = (finishReason ?? '').toUpperCase();
  if (reason.includes('SAFETY')) return SAFETY_LLM_REPLY_FALLBACK;
  return EMPTY_LLM_REPLY_FALLBACK;
}

export type {
  ChatResponse,
  PendingActionDto,
  ReviewBlockDto,
  ReviewOfferDto,
  SuggestedLinkDto,
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
    private readonly chatAttachments: ChatAttachmentsService,
  ) {}

  listProviders() {
    return {
      providers: this.providers.listProviders(),
      defaultProviderId: this.providers.getDefaultProviderId(),
    };
  }

  /**
   * Persist the user message immediately and mark the conversation as generating.
   * Peers can refetch and show thinking UI before the LLM finishes.
   */
  async startMessageTurn(dto: SendMessageDto): Promise<StartMessageTurnResponse> {
    const {
      courseId,
      moodleUserId,
      conversationId: incomingConvId,
    } = dto;
    const rawMessage = typeof dto.message === 'string' ? dto.message : '';
    const mode = dto.mode === 'coach' ? 'coach' : 'direct';
    const guidance =
      mode === 'coach'
        ? Math.min(5, Math.max(1, Math.round(dto.guidance ?? 3)))
        : undefined;

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

    const attachmentIds = dto.attachmentIds || [];
    if (attachmentIds.length && !moodleUserId) {
      throw new BadRequestException(
        'Signing in is required to use file attachments.',
      );
    }

    const processedAttachments = moodleUserId
      ? await this.chatAttachments.resolveByIds({
          attachmentIds,
          moodleUserId,
          conversationId,
          query: rawMessage,
        })
      : {
          promptBlock: '',
          storagePrefix: '',
          usableFilenames: [] as string[],
          errors: [] as string[],
          attachmentIds: [] as string[],
        };

    if (
      !rawMessage.trim() &&
      !processedAttachments.promptBlock &&
      attachmentIds.length > 0
    ) {
      throw new BadRequestException(
        processedAttachments.errors[0] ||
          'None of the attached files could be read. Please try different files.',
      );
    }
    if (!rawMessage.trim() && !processedAttachments.promptBlock) {
      throw new BadRequestException('Message cannot be empty.');
    }

    const messageForStorage = this.chatAttachments.buildStorageMessage(
      rawMessage,
      processedAttachments.storagePrefix,
    );

    const [userMessage] = await this.conversationService.appendMessages(
      conversationId,
      [
        {
          role: 'user',
          content: messageForStorage,
          mode,
          guidance: guidance ?? null,
        },
      ],
    );

    if (moodleUserId && processedAttachments.attachmentIds.length) {
      await this.chatAttachments.linkToMessage(
        processedAttachments.attachmentIds,
        userMessage.id,
        conversationId,
        moodleUserId,
      );
    }

    const generatingStartedAt = new Date();
    await this.conversationService.setGeneratingStartedAt(
      conversationId,
      generatingStartedAt,
    );

    return {
      conversationId,
      userMessageId: userMessage.id,
      generatingStartedAt: generatingStartedAt.toISOString(),
      attachmentWarnings: processedAttachments.errors.length
        ? processedAttachments.errors
        : undefined,
    };
  }

  /**
   * Generate and persist the assistant reply for a user message already saved
   * by startMessageTurn.
   */
  async completeMessageTurn(dto: CompleteMessageDto): Promise<ChatResponse> {
    const {
      courseId,
      courseName,
      moodleUserId,
      userFirstName,
      conversationId,
      userMessageId,
      provider: requestedProvider,
    } = dto;
    const rawMessage = typeof dto.message === 'string' ? dto.message : '';
    const mode = dto.mode === 'coach' ? 'coach' : 'direct';
    const guidance =
      mode === 'coach'
        ? Math.min(5, Math.max(1, Math.round(dto.guidance ?? 3)))
        : undefined;
    const llm = this.providers.resolve(requestedProvider);

    try {
      if (moodleUserId) {
        await this.conversationService.assertOwner(conversationId, moodleUserId);
      } else {
        await this.conversationService.findById(conversationId);
      }

      const userMessage = await this.conversationService.findMessage(
        conversationId,
        userMessageId,
      );
      if (userMessage.role !== 'user') {
        throw new BadRequestException('userMessageId must refer to a user message.');
      }

      const conversation =
        await this.conversationService.findById(conversationId);

      const attachmentIds = dto.attachmentIds || [];
      if (attachmentIds.length && !moodleUserId) {
        throw new BadRequestException(
          'Signing in is required to use file attachments.',
        );
      }

      const processedAttachments = moodleUserId
        ? await this.chatAttachments.resolveByIds({
            attachmentIds,
            moodleUserId,
            conversationId,
            query: rawMessage,
          })
        : {
            promptBlock: '',
            storagePrefix: '',
            usableFilenames: [] as string[],
            errors: [] as string[],
            attachmentIds: [] as string[],
          };

      let messageForLlm = this.chatAttachments.buildLlmMessage(
        rawMessage,
        processedAttachments.promptBlock,
      );
      const messageForStorage = userMessage.content;
      const message = rawMessage.trim()
        ? rawMessage.trim()
        : processedAttachments.usableFilenames.join(', ') || messageForStorage;

      const sharedUrls = extractHttpUrls(rawMessage);
      let linkWarnings: string[] = [];
      let linkBatch: LinkFetchBatch | null = null;
      if (sharedUrls.length) {
        linkBatch = await fetchLinkedPagesFromMessage(rawMessage);
        const linkBlock = buildLinkFetchPromptBlock(linkBatch);
        if (linkBlock) {
          messageForLlm = messageForLlm
            ? `${messageForLlm}\n\n${linkBlock}`
            : linkBlock;
        }
        linkWarnings = linkFetchWarningMessages(linkBatch);
        this.logger.log(
          `Link fetch for conversation ${conversationId}: opened ${linkBatch.results.length}/${linkBatch.totalUrls}` +
            (linkBatch.skippedUrls ? ` (skipped ${linkBatch.skippedUrls})` : '') +
            ` — ${linkBatch.results
              .map((r) => (r.ok ? `ok:${r.url}` : `fail:${r.url}`))
              .join(', ')}`,
        );
      }

      if (
        !attachmentIds.length &&
        !sharedUrls.length &&
        isPrimaryGratitudeMessage(rawMessage)
      ) {
        const responseText = pickGratitudeReply(rawMessage);
        await this.conversationService.appendMessages(conversationId, [
          {
            role: 'assistant',
            content: responseText,
            mode,
            guidance: guidance ?? null,
          },
        ]);
        const topicSuggestions = normalizeReturnedTopics(
          conversation.topicSuggestions,
        );
        this.logger.log(
          `Gratitude acknowledgment for conversation ${conversationId} (skipped LLM)`,
        );
        return {
          response: responseText,
          conversationId,
          topicSuggestions,
          provider: llm.id,
          mode,
          guidance,
        };
      }

      const [
        courseMaterial,
        resolvedCourseName,
        enrolledCourses,
        userMessageCount,
        dbHistoryIncludingCurrent,
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
        this.conversationService.countUserMessages(conversationId),
        this.conversationService.getRecentHistory(conversationId, 20),
      ]);

      // Current user message is already persisted — exclude it from LLM history
      // and from "conversation started" / greeting gating.
      const dbHistory =
        dbHistoryIncludingCurrent.length &&
        dbHistoryIncludingCurrent[dbHistoryIncludingCurrent.length - 1].role ===
          'user'
          ? dbHistoryIncludingCurrent.slice(0, -1)
          : dbHistoryIncludingCurrent;
      const conversationStarted = userMessageCount > 1;
      const canProposeContent =
        Boolean(moodleUserId) && courseId > 1 && Boolean(courseMaterial);
      const mayGreet =
        !conversationStarted && (conversation.type ?? 'general') === 'general';
      const priorUserTurns = Math.max(0, userMessageCount - 1);
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
            messageForLlm,
          ].join('\n'),
        );
      }

      this.logger.log(
        `Sending message for conversation ${conversationId} via ${llm.id}`,
      );
      const tools: LlmTool[] = [];
      if (canProposeContent) {
        tools.push(...STUDY_PROPOSAL_TOOLS);
      }
      if (linkBatch?.results.some((r) => r.ok)) {
        tools.push(SUGGEST_OPENABLE_LINKS_TOOL);
      }
      const hasLinkedPageContent = Boolean(linkBatch?.results.some((r) => r.ok));
      const result = await llm.chat({
        systemInstruction,
        history: providerHistory,
        message: messageForLlm,
        tools: tools.length ? tools : undefined,
        relaxDangerousContentSafety: hasLinkedPageContent,
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
      let suggestedLinks: SuggestedLink[] = [];

      const proposeQuizCall = functionCalls.find(
        (call) => call.name === 'propose_practice_quiz',
      );
      const proposeGuideCall = functionCalls.find(
        (call) => call.name === 'propose_study_guide',
      );
      const proposeFlashcardsCall = functionCalls.find(
        (call) => call.name === 'propose_flashcards',
      );
      const suggestLinksCall = functionCalls.find(
        (call) => call.name === 'suggest_openable_links',
      );

      const suggestToolArgs = (suggestLinksCall?.args ?? null) as {
        links?: Array<{ title?: unknown; url?: unknown; teaser?: unknown }>;
      } | null;

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
        let modelText = result.text?.trim() ?? '';
        if (linkBatch?.results.some((r) => r.ok)) {
          suggestedLinks = await buildSuggestedLinks({
            batch: linkBatch,
            toolArgs: suggestToolArgs,
            responseText: modelText,
          });
        }

        if (!modelText && suggestedLinks.length) {
          modelText = buildSuggestedLinksReply(suggestedLinks, linkBatch ?? undefined);
          this.logger.log(
            `Synthesized link-recommendation reply for conversation ${conversationId} from suggest_openable_links (${suggestedLinks.length} links)`,
          );
        } else if (!modelText && linkBatch?.results.some((r) => r.ok)) {
          suggestedLinks = await pickOutboundSuggestedLinks(linkBatch);
          if (suggestedLinks.length) {
            modelText = buildSuggestedLinksReply(suggestedLinks, linkBatch, {
              degraded: true,
            });
            this.logger.log(
              `Degraded outbound-link reply for conversation ${conversationId}` +
                ` after empty LLM (finishReason=${result.finishReason ?? 'n/a'}, ${suggestedLinks.length} links)`,
            );
          } else {
            this.logger.warn(
              `Empty LLM text for conversation ${conversationId} via ${llm.id}` +
                ` (finishReason=${result.finishReason ?? 'n/a'}, toolCalls=${JSON.stringify(
                  functionCalls.map((c) => c.name),
                )})`,
            );
            modelText = emptyLlmFallback(result.finishReason);
          }
        } else if (!modelText) {
          this.logger.warn(
            `Empty LLM text for conversation ${conversationId} via ${llm.id}` +
              ` (finishReason=${result.finishReason ?? 'n/a'}, toolCalls=${JSON.stringify(
                functionCalls.map((c) => c.name),
              )})`,
          );
          modelText = emptyLlmFallback(result.finishReason);
        }

        responseText = preventRepeatedGreeting(
          modelText,
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
              `suggestedLinks: ${suggestedLinks.length}`,
              '',
              '----- FINAL RESPONSE AFTER PROCESSING -----',
              responseText,
            ].join('\n'),
          );
        }
      }

      if (
        !suggestedLinks.length &&
        linkBatch?.results.some((r) => r.ok)
      ) {
        suggestedLinks = await buildSuggestedLinks({
          batch: linkBatch,
          toolArgs: suggestToolArgs,
          responseText,
        });
      }

      await this.conversationService.appendMessages(conversationId, [
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
        suggestedLinks: suggestedLinks.length ? suggestedLinks : undefined,
        topicSuggestions,
        provider: llm.id,
        mode,
        guidance,
        attachmentWarnings: (() => {
          const warnings = [
            ...processedAttachments.errors,
            ...linkWarnings,
          ];
          return warnings.length ? warnings : undefined;
        })(),
      };
    } finally {
      await this.conversationService.setGeneratingStartedAt(conversationId, null);
    }
  }

  /** Legacy single-call send: start then complete (tests / older clients). */
  async sendMessage(dto: SendMessageDto): Promise<ChatResponse> {
    const started = await this.startMessageTurn(dto);
    return this.completeMessageTurn({
      courseId: dto.courseId,
      courseName: dto.courseName,
      moodleUserId: dto.moodleUserId,
      userFirstName: dto.userFirstName,
      conversationId: started.conversationId,
      userMessageId: started.userMessageId,
      message: typeof dto.message === 'string' ? dto.message : '',
      attachmentIds: dto.attachmentIds,
      provider: dto.provider,
      mode: dto.mode,
      guidance: dto.guidance,
    });
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
