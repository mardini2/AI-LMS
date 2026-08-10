import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { ChatService } from './chat.service';

function buildChatService(overrides: {
  conversation?: Record<string, unknown>;
  providers?: Record<string, unknown>;
  chatAttachments?: Record<string, unknown>;
  context?: Record<string, unknown>;
} = {}) {
  const conversationService = {
    assertOwner: jest.fn(async () => undefined),
    findById: jest.fn(async () => ({
      id: 'conv-1',
      type: 'general',
      title: 'Main',
      topicSuggestions: null,
    })),
    appendMessages: jest.fn(async (_id: string, pairs: Array<{ role: string }>) =>
      pairs.map((p, i) => ({
        id: p.role === 'user' ? 'user-msg-1' : `asst-msg-${i}`,
        role: p.role,
        content: 'x',
      })),
    ),
    setGeneratingStartedAt: jest.fn(async () => undefined),
    findMessage: jest.fn(async () => ({
      id: 'user-msg-1',
      role: 'user',
      content: 'thanks',
    })),
    countUserMessages: jest.fn(async () => 1),
    getRecentHistory: jest.fn(async () => [{ role: 'user', content: 'thanks' }]),
    hasUserMessages: jest.fn(async () => true),
    updateTopicSuggestions: jest.fn(async () => []),
    ...overrides.conversation,
  };

  const providers = {
    resolve: jest.fn(() => ({
      id: 'mock',
      chat: jest.fn(async () => ({ text: 'Hello from model' })),
    })),
    listProviders: jest.fn(() => []),
    getDefaultProviderId: jest.fn(() => 'mock'),
    ...overrides.providers,
  };

  const chatAttachments = {
    resolveByIds: jest.fn(async () => ({
      promptBlock: '',
      storagePrefix: '',
      usableFilenames: [] as string[],
      errors: [] as string[],
      attachmentIds: [] as string[],
    })),
    buildLlmMessage: jest.fn((raw: string) => raw),
    buildStorageMessage: jest.fn((raw: string) => raw),
    linkToMessage: jest.fn(async () => undefined),
    ...overrides.chatAttachments,
  };

  const contextService = {
    getContext: jest.fn(async () => 'course material'),
    resolveCourseName: jest.fn(async () => 'Course'),
    getEnrolledCourseNames: jest.fn(async () => []),
    ...overrides.context,
  };

  const service = new ChatService(
    providers as never,
    contextService as never,
    {} as never,
    {} as never,
    conversationService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { suggestTopics: jest.fn(async () => []) } as never,
    chatAttachments as never,
  );

  return { service, conversationService, providers, chatAttachments };
}

describe('ChatService persist-first turns', () => {
  it('startMessageTurn appends only the user message and sets generatingStartedAt', async () => {
    const { service, conversationService } = buildChatService();

    const result = await service.startMessageTurn({
      courseId: 2,
      moodleUserId: 7,
      conversationId: 'conv-1',
      message: 'What is paging?',
    });

    expect(result.conversationId).toBe('conv-1');
    expect(result.userMessageId).toBe('user-msg-1');
    expect(result.generatingStartedAt).toBeTruthy();
    expect(conversationService.appendMessages).toHaveBeenCalledWith(
      'conv-1',
      [
        expect.objectContaining({
          role: 'user',
          content: 'What is paging?',
        }),
      ],
    );
    expect(conversationService.setGeneratingStartedAt).toHaveBeenCalled();
    expect(
      (conversationService.setGeneratingStartedAt as jest.Mock).mock.calls[0][0],
    ).toBe('conv-1');
    expect(
      (conversationService.setGeneratingStartedAt as jest.Mock).mock.calls[0][1],
    ).toBeInstanceOf(Date);
  });

  it('completeMessageTurn for gratitude appends only the assistant and clears generating', async () => {
    const { service, conversationService } = buildChatService();

    const result = await service.completeMessageTurn({
      courseId: 2,
      moodleUserId: 7,
      conversationId: 'conv-1',
      userMessageId: 'user-msg-1',
      message: 'thanks',
    });

    expect(result.response.length).toBeGreaterThan(0);
    expect(conversationService.appendMessages).toHaveBeenCalledWith(
      'conv-1',
      [expect.objectContaining({ role: 'assistant' })],
    );
    expect(conversationService.setGeneratingStartedAt).toHaveBeenCalled();
    const clearCall = (
      conversationService.setGeneratingStartedAt as jest.Mock
    ).mock.calls.find((call) => call[1] === null);
    expect(clearCall).toBeTruthy();
    expect(clearCall?.[0]).toBe('conv-1');
  });

  it('completeMessageTurn rejects a non-user userMessageId', async () => {
    const { service } = buildChatService({
      conversation: {
        findMessage: jest.fn(async () => ({
          id: 'asst-1',
          role: 'assistant',
          content: 'hi',
        })),
      },
    });

    await expect(
      service.completeMessageTurn({
        courseId: 2,
        moodleUserId: 7,
        conversationId: 'conv-1',
        userMessageId: 'asst-1',
        message: 'hello',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sendMessage wrapper starts then completes', async () => {
    const { service, conversationService } = buildChatService();

    const result = await service.sendMessage({
      courseId: 2,
      moodleUserId: 7,
      conversationId: 'conv-1',
      message: 'thanks',
    });

    expect(result.conversationId).toBe('conv-1');
    expect(result.response.length).toBeGreaterThan(0);
    // user then assistant
    expect(conversationService.appendMessages).toHaveBeenCalledTimes(2);
    expect(conversationService.appendMessages).toHaveBeenNthCalledWith(
      1,
      'conv-1',
      [expect.objectContaining({ role: 'user' })],
    );
    expect(conversationService.appendMessages).toHaveBeenNthCalledWith(
      2,
      'conv-1',
      [expect.objectContaining({ role: 'assistant' })],
    );
  });
});
