jest.mock('../../../src/chat/link-fetch', () => {
  const actual = jest.requireActual('../../../src/chat/link-fetch');
  return {
    ...actual,
    fetchLinkedPagesFromMessage: jest.fn(),
    buildSuggestedLinks: jest.fn(),
    pickOutboundSuggestedLinks: jest.fn(),
  };
});

import { Logger } from '@nestjs/common';
import { ChatService } from '../../../src/chat/chat.service';
import {
  buildSuggestedLinks,
  fetchLinkedPagesFromMessage,
  pickOutboundSuggestedLinks,
  type LinkFetchBatch,
} from '../../../src/chat/link-fetch';
import { stripLeadingAssistantGreeting } from '../../../src/chat/chat.service';
import type { LlmChatRequest, LlmToolCall } from '../../../src/chat/providers/provider.types';

/**
 * Covers the "student pasted a URL" path through completeMessageTurn: fetching
 * linked pages, offering the link tool, and the synthesized/degraded replies used
 * when the model returns no text of its own. The network layer is mocked out.
 */

const mockedFetchLinks = fetchLinkedPagesFromMessage as jest.Mock;
const mockedBuildSuggestedLinks = buildSuggestedLinks as jest.Mock;
const mockedPickOutbound = pickOutboundSuggestedLinks as jest.Mock;

type Deps = ReturnType<typeof buildDeps>;

function buildDeps() {
  const chat: jest.Mock = jest.fn(async () => ({ text: 'Here is the summary.' }));

  return {
    chat,
    providers: {
      resolve: jest.fn(() => ({ id: 'gemini', chat, generateJson: jest.fn() })),
      listProviders: jest.fn(() => []),
      getDefaultProviderId: jest.fn(() => 'gemini'),
      isStubMode: jest.fn(() => false),
    },
    contextService: {
      getContext: jest.fn().mockResolvedValue('### Week 3\nPaging basics'),
      resolveCourseName: jest.fn().mockResolvedValue('Operating Systems'),
      getEnrolledCourseNames: jest.fn().mockResolvedValue([]),
      resolveSectionsFromScope: jest.fn(),
    },
    practiceQuizMoodle: { createPracticeQuiz: jest.fn() },
    studyGuideMoodle: { createStudyGuide: jest.fn(), createPrivatePage: jest.fn() },
    conversationService: {
      assertOwner: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue({
        id: 'conv-1',
        type: 'general',
        title: 'Main',
        topicSuggestions: null,
      }),
      findMessage: jest.fn().mockResolvedValue({
        id: 'user-msg-1',
        role: 'user',
        content: 'read https://news.test/article',
      }),
      countUserMessages: jest.fn().mockResolvedValue(2),
      getRecentHistory: jest.fn().mockResolvedValue([]),
      appendMessages: jest.fn(async (_id: string, rows: Array<{ role: string }>) =>
        rows.map((row, i) => ({ id: `msg-${i}`, ...row })),
      ),
      setGeneratingStartedAt: jest.fn().mockResolvedValue(undefined),
      updateTopicSuggestions: jest.fn(async (_id: string, topics: string[]) => topics),
    },
    pendingActionService: {
      createPracticeQuizProposal: jest.fn().mockResolvedValue({ id: 'pa-quiz' }),
      createStudyGuideProposal: jest.fn().mockResolvedValue({ id: 'pa-guide' }),
      createFlashcardsProposal: jest.fn().mockResolvedValue({ id: 'pa-cards' }),
    },
    practiceQuizGeneration: { generatePracticeQuestions: jest.fn() },
    practiceQuizReview: { getReviewOffer: jest.fn(), explainWrongAnswers: jest.fn() },
    studyGuideGeneration: { generateStudyGuide: jest.fn() },
    flashcardsGeneration: { generateFlashcards: jest.fn() },
    topicSuggestions: { suggestTopics: jest.fn().mockResolvedValue([]) },
    chatAttachments: {
      resolveByIds: jest.fn().mockResolvedValue({
        promptBlock: '',
        storagePrefix: '',
        usableFilenames: [] as string[],
        errors: [] as string[],
        attachmentIds: [] as string[],
      }),
      buildLlmMessage: jest.fn((message: string) => message),
      buildStorageMessage: jest.fn((message: string) => message),
      linkToMessage: jest.fn(),
    },
  };
}

function buildService(deps: Deps): ChatService {
  return new ChatService(
    deps.providers as never,
    deps.contextService as never,
    deps.practiceQuizMoodle as never,
    deps.studyGuideMoodle as never,
    deps.conversationService as never,
    deps.pendingActionService as never,
    deps.practiceQuizGeneration as never,
    deps.practiceQuizReview as never,
    deps.studyGuideGeneration as never,
    deps.flashcardsGeneration as never,
    deps.topicSuggestions as never,
    deps.chatAttachments as never,
  );
}

function okBatch(overrides: Partial<LinkFetchBatch> = {}): LinkFetchBatch {
  return {
    results: [
      {
        url: 'https://news.test/article',
        ok: true,
        title: 'Rootkit roundup',
        text: 'A long article about rootkits.',
        contentType: 'text/html',
        outboundLinks: [
          { title: 'Kernel exploit explained', url: 'https://news.test/kernel' },
        ],
      },
    ],
    totalUrls: 1,
    skippedUrls: 0,
    ...overrides,
  } as LinkFetchBatch;
}

function failedBatch(): LinkFetchBatch {
  return {
    results: [
      { url: 'https://news.test/dead', ok: false, error: 'timed out' },
    ],
    totalUrls: 1,
    skippedUrls: 0,
  } as LinkFetchBatch;
}

function dto(overrides: Record<string, unknown> = {}) {
  return {
    courseId: 12,
    moodleUserId: 42,
    conversationId: 'conv-1',
    userMessageId: 'user-msg-1',
    message: 'What do you make of https://news.test/article ?',
    ...overrides,
  } as never;
}

function lastChatRequest(deps: Deps): LlmChatRequest {
  const calls = deps.chat.mock.calls;
  return calls[calls.length - 1][0] as LlmChatRequest;
}

describe('ChatService linked-page handling', () => {
  let deps: Deps;
  let service: ChatService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    deps = buildDeps();
    service = buildService(deps);
    mockedBuildSuggestedLinks.mockResolvedValue([]);
    mockedPickOutbound.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('leaves the link machinery alone when the message has no URL', async () => {
    await service.completeMessageTurn(dto({ message: 'Explain paging' }));

    expect(mockedFetchLinks).not.toHaveBeenCalled();
    const request = lastChatRequest(deps);
    expect(request.message).toBe('Explain paging');
    expect(request.relaxDangerousContentSafety).toBe(false);
  });

  it('appends fetched page content to the prompt and offers the link tool', async () => {
    mockedFetchLinks.mockResolvedValue(okBatch());

    await service.completeMessageTurn(dto());

    expect(mockedFetchLinks).toHaveBeenCalledWith(
      'What do you make of https://news.test/article ?',
    );
    const request = lastChatRequest(deps);
    expect(request.message).toContain('What do you make of');
    expect(request.message).toContain('Linked page content');
    expect(request.message).toContain('A long article about rootkits.');
    expect((request.tools ?? []).map((t) => t.name)).toContain(
      'suggest_openable_links',
    );
    // Security/news pages need the safety filter relaxed to get any answer at all.
    expect(request.relaxDangerousContentSafety).toBe(true);
  });

  it('reports unopenable links as non-fatal warnings and skips the link tool', async () => {
    mockedFetchLinks.mockResolvedValue(failedBatch());

    const result = await service.completeMessageTurn(dto());

    expect(result.attachmentWarnings).toEqual(['Could not open link: timed out']);
    expect((lastChatRequest(deps).tools ?? []).map((t) => t.name)).not.toContain(
      'suggest_openable_links',
    );
    expect(lastChatRequest(deps).relaxDangerousContentSafety).toBe(false);
  });

  it('returns the links the model nominated through suggest_openable_links', async () => {
    mockedFetchLinks.mockResolvedValue(okBatch());
    const suggested = [
      { title: 'Kernel exploit explained', url: 'https://news.test/kernel' },
    ];
    mockedBuildSuggestedLinks.mockResolvedValue(suggested);
    const toolCalls: LlmToolCall[] = [
      {
        name: 'suggest_openable_links',
        args: { links: [{ title: 'Kernel', url: 'https://news.test/kernel' }] },
      },
    ];
    deps.chat.mockResolvedValue({
      text: 'That article covers rootkits. See [Kernel](https://news.test/kernel).',
      toolCalls,
    });

    const result = await service.completeMessageTurn(dto());

    expect(mockedBuildSuggestedLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        toolArgs: { links: [{ title: 'Kernel', url: 'https://news.test/kernel' }] },
        responseText: expect.stringContaining('That article covers rootkits.'),
      }),
    );
    expect(result.suggestedLinks).toEqual(suggested);
  });

  it('writes the recommendation itself when the model only called the tool', async () => {
    mockedFetchLinks.mockResolvedValue(okBatch());
    mockedBuildSuggestedLinks.mockResolvedValue([
      { title: 'Kernel exploit explained', url: 'https://news.test/kernel' },
    ]);
    deps.chat.mockResolvedValue({
      text: '',
      toolCalls: [
        { name: 'suggest_openable_links', args: { links: [] } },
      ] as LlmToolCall[],
    });

    const result = await service.completeMessageTurn(dto());

    expect(result.response).toContain('These look most relevant to your course');
    expect(result.response).toContain(
      '1. [Kernel exploit explained](https://news.test/kernel)',
    );
    expect(result.suggestedLinks).toHaveLength(1);
  });

  it('degrades to raw outbound headlines when the model returns nothing usable', async () => {
    mockedFetchLinks.mockResolvedValue(okBatch());
    mockedBuildSuggestedLinks.mockResolvedValue([]);
    mockedPickOutbound.mockResolvedValue([
      { title: 'Kernel exploit explained', url: 'https://news.test/kernel' },
    ]);
    deps.chat.mockResolvedValue({ text: '', finishReason: 'MAX_TOKENS' });

    const result = await service.completeMessageTurn(dto());

    expect(mockedPickOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ totalUrls: 1 }),
    );
    expect(result.response).toContain('I could not get an AI write-up for that page');
    expect(result.response).toContain('https://news.test/kernel');
  });

  it('falls back to the retry message when a fetched page yields no links either', async () => {
    mockedFetchLinks.mockResolvedValue(okBatch());
    mockedBuildSuggestedLinks.mockResolvedValue([]);
    mockedPickOutbound.mockResolvedValue([]);
    deps.chat.mockResolvedValue({ text: '', finishReason: 'STOP' });

    const result = await service.completeMessageTurn(dto());

    expect(result.response).toBe(
      'I could not generate a reply just now. Please try again, or paste a specific article URL if you want me to read a page.',
    );
    expect(result.suggestedLinks).toBeUndefined();
  });

  it('still resolves Open buttons when the turn ended in a content proposal', async () => {
    mockedFetchLinks.mockResolvedValue(okBatch());
    mockedBuildSuggestedLinks.mockResolvedValue([
      { title: 'Kernel exploit explained', url: 'https://news.test/kernel' },
    ]);
    deps.chat.mockResolvedValue({
      text: '',
      toolCalls: [
        {
          name: 'propose_study_guide',
          args: { title: 'Rootkits', scopeSummary: 'Week 3' },
        },
      ] as LlmToolCall[],
    });

    const result = await service.completeMessageTurn(dto());

    expect(result.pendingAction?.type).toBe('study_guide');
    // The proposal branch skips link handling, so the post-pass fills it in.
    expect(result.suggestedLinks).toEqual([
      { title: 'Kernel exploit explained', url: 'https://news.test/kernel' },
    ]);
    expect(mockedBuildSuggestedLinks).toHaveBeenCalledWith(
      expect.objectContaining({ responseText: result.response }),
    );
  });

  it('passes through the per-message link limit warning', async () => {
    mockedFetchLinks.mockResolvedValue(
      okBatch({ totalUrls: 5, skippedUrls: 2 }),
    );

    const result = await service.completeMessageTurn(dto());

    expect(result.attachmentWarnings?.[0]).toContain(
      'I can open up to 3 links per message',
    );
    expect(lastChatRequest(deps).message).toContain('Limit note:');
  });
});

describe('stripLeadingAssistantGreeting edge cases', () => {
  it('returns blank input untouched rather than throwing', () => {
    expect(stripLeadingAssistantGreeting('')).toBe('');
    expect(stripLeadingAssistantGreeting('   ')).toBe('   ');
    expect(stripLeadingAssistantGreeting(undefined as unknown as string)).toBe(
      undefined,
    );
  });

  it('keeps the text when stripping would leave nothing behind', () => {
    expect(stripLeadingAssistantGreeting('Hello!')).toBe('Hello!');
  });

  it('escapes regex characters in the student name', () => {
    expect(
      stripLeadingAssistantGreeting('Hi A.C? paging uses frames.', 'A.C?'),
    ).toBe('paging uses frames.');
  });
});
