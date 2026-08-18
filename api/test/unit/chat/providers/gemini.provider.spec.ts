import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GeminiClient } from '../../../../src/chat/gemini.client';
import { GeminiProvider } from '../../../../src/chat/providers/gemini.provider';
import type { LlmChatRequest, LlmTool } from '../../../../src/chat/providers/provider.types';

jest.mock('@google/genai', () => {
  const actual = jest.requireActual('@google/genai') as Record<string, unknown>;
  const sendMessage = jest.fn();
  const chatsCreate = jest.fn(() => ({ sendMessage }));
  const generateContent = jest.fn();
  const GoogleGenAI = jest.fn().mockImplementation(() => ({
    chats: { create: chatsCreate },
    models: { generateContent },
  }));
  return {
    ...actual,
    GoogleGenAI,
    // Handles kept on the mock module itself so the spec can reach them without
    // tripping over jest.mock factory hoisting.
    __handles: { sendMessage, chatsCreate, generateContent, GoogleGenAI },
  };
});

const { sendMessage, chatsCreate, generateContent, GoogleGenAI } = (
  jest.requireMock('@google/genai') as {
    __handles: {
      sendMessage: jest.Mock;
      chatsCreate: jest.Mock;
      generateContent: jest.Mock;
      GoogleGenAI: jest.Mock;
    };
  }
).__handles;

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const HARASSMENT_DEFAULT = {
  category: 'HARM_CATEGORY_HARASSMENT',
  threshold: 'BLOCK_MEDIUM_AND_ABOVE',
};

interface CreateChatArgs {
  model: string;
  history: Array<{ role: string; parts: Array<{ text: string }> }>;
  config: {
    systemInstruction: string;
    tools?: Array<{ functionDeclarations: Array<Record<string, unknown>> }>;
    toolConfig?: { functionCallingConfig: { mode: string } };
    safetySettings: Array<{ category: string; threshold: string }>;
  };
}

interface GenerateContentArgs {
  model: string;
  contents: string;
  config: { responseMimeType: string; responseSchema?: Record<string, unknown> };
}

function makeConfig(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function buildProvider(values: Record<string, string | undefined> = {}) {
  const config = makeConfig(values);
  return new GeminiProvider(new GeminiClient(config), config);
}

function configuredProvider(extra: Record<string, string | undefined> = {}) {
  return buildProvider({ GEMINI_API_KEY: 'gm-test-key', ...extra });
}

function chatRequest(overrides: Partial<LlmChatRequest> = {}): LlmChatRequest {
  return {
    systemInstruction: 'Stay on the course material.',
    history: [],
    message: 'What is a page fault?',
    ...overrides,
  };
}

function createChatArgs(index = 0): CreateChatArgs {
  return chatsCreate.mock.calls[index][0] as CreateChatArgs;
}

function generateContentArgs(index = 0): GenerateContentArgs {
  return generateContent.mock.calls[index][0] as GenerateContentArgs;
}

let warnSpy: jest.SpyInstance;
const originalGreetingDebug = process.env.CHAT_GREETING_DEBUG;

beforeEach(() => {
  sendMessage.mockReset();
  generateContent.mockReset();
  chatsCreate.mockClear();
  GoogleGenAI.mockClear();
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  // Greeting debug defaults ON; pin it off the ambient environment.
  delete process.env.CHAT_GREETING_DEBUG;
});

afterEach(() => {
  warnSpy.mockRestore();
});

afterAll(() => {
  if (originalGreetingDebug === undefined) {
    delete process.env.CHAT_GREETING_DEBUG;
  } else {
    process.env.CHAT_GREETING_DEBUG = originalGreetingDebug;
  }
});

describe('GeminiProvider configuration', () => {
  it('is configured when a trimmed key builds a ready SDK client', () => {
    const provider = buildProvider({ GEMINI_API_KEY: '  gm-test-key  ' });

    expect(provider.id).toBe('gemini');
    expect(provider.displayName).toBe('Google Gemini');
    expect(provider.isConfigured()).toBe(true);
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'gm-test-key' });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace only', ' \n\t '],
  ])('is not configured when the key is %s', (_name, key) => {
    const provider = buildProvider({ GEMINI_API_KEY: key });

    expect(provider.isConfigured()).toBe(false);
    expect(GoogleGenAI).not.toHaveBeenCalled();
  });

  it('is not configured when the shared Gemini client never got a key', () => {
    const provider = new GeminiProvider(
      new GeminiClient(makeConfig({})),
      makeConfig({ GEMINI_API_KEY: 'gm-test-key' }),
    );

    expect(provider.isConfigured()).toBe(false);
  });

  it('sends the default model when GEMINI_MODEL is absent', async () => {
    sendMessage.mockResolvedValue({ text: 'ok' });
    await configuredProvider().chat(chatRequest());

    expect(createChatArgs().model).toBe(DEFAULT_MODEL);
  });

  it('sends a trimmed custom model from config', async () => {
    sendMessage.mockResolvedValue({ text: 'ok' });
    await configuredProvider({ GEMINI_MODEL: '  gemini-3-pro  ' }).chat(chatRequest());

    expect(createChatArgs().model).toBe('gemini-3-pro');
  });

  it('falls back to the default model when GEMINI_MODEL is blank', async () => {
    generateContent.mockResolvedValue({ text: '{}' });
    await configuredProvider({ GEMINI_MODEL: '   ' }).generateJson({ prompt: 'p' });

    expect(generateContentArgs().model).toBe(DEFAULT_MODEL);
  });
});

describe('GeminiProvider history mapping', () => {
  beforeEach(() => {
    sendMessage.mockResolvedValue({ text: 'answer' });
  });

  it('maps assistant turns to model turns with a single text part', async () => {
    await configuredProvider().chat(
      chatRequest({
        history: [
          { role: 'user', content: 'What is paging?' },
          { role: 'assistant', content: 'Paging splits memory.' },
        ],
      }),
    );

    expect(createChatArgs().history).toEqual([
      { role: 'user', parts: [{ text: 'What is paging?' }] },
      { role: 'model', parts: [{ text: 'Paging splits memory.' }] },
    ]);
  });

  it('sends the new message through sendMessage rather than history', async () => {
    await configuredProvider().chat(
      chatRequest({
        history: [{ role: 'user', content: 'earlier' }],
        message: 'Explain further',
      }),
    );

    expect(createChatArgs().history).toEqual([
      { role: 'user', parts: [{ text: 'earlier' }] },
    ]);
    expect(sendMessage).toHaveBeenCalledWith({ message: 'Explain further' });
  });

  it('passes an empty history array when there is no history', async () => {
    await configuredProvider().chat(chatRequest({ history: [] }));

    expect(createChatArgs().history).toEqual([]);
  });

  it('seeds a "(Conversation opened.)" user turn when history starts with the assistant', async () => {
    await configuredProvider().chat(
      chatRequest({
        history: [
          { role: 'assistant', content: 'Welcome to Section 3.' },
          { role: 'user', content: 'Thanks' },
        ],
      }),
    );

    expect(createChatArgs().history).toEqual([
      { role: 'user', parts: [{ text: '(Conversation opened.)' }] },
      { role: 'model', parts: [{ text: 'Welcome to Section 3.' }] },
      { role: 'user', parts: [{ text: 'Thanks' }] },
    ]);
  });

  it('merges consecutive same-role turns into one part', async () => {
    await configuredProvider().chat(
      chatRequest({
        history: [
          { role: 'user', content: 'first' },
          { role: 'user', content: 'second' },
          { role: 'assistant', content: 'reply a' },
          { role: 'assistant', content: 'reply b' },
        ],
      }),
    );

    expect(createChatArgs().history).toEqual([
      { role: 'user', parts: [{ text: 'first\nsecond' }] },
      { role: 'model', parts: [{ text: 'reply a\nreply b' }] },
    ]);
  });

  it('merges leading assistant turns onto the seeded opener target, not the opener itself', async () => {
    await configuredProvider().chat(
      chatRequest({
        history: [
          { role: 'assistant', content: 'Welcome.' },
          { role: 'assistant', content: 'Pick a topic.' },
        ],
      }),
    );

    expect(createChatArgs().history).toEqual([
      { role: 'user', parts: [{ text: '(Conversation opened.)' }] },
      { role: 'model', parts: [{ text: 'Welcome.\nPick a topic.' }] },
    ]);
  });

  it('leaves the caller-owned history array untouched while merging', async () => {
    const history: LlmChatRequest['history'] = [
      { role: 'assistant', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];

    await configuredProvider().chat(chatRequest({ history }));

    expect(history).toEqual([
      { role: 'assistant', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
  });

  it('logs the mapped history once the conversation has a prior user turn', async () => {
    await configuredProvider().chat(
      chatRequest({ history: [{ role: 'user', content: 'earlier question' }] }),
    );

    const logged = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((msg) => msg.includes('[GREETING_DEBUG] PROVIDER_PAYLOAD:gemini'));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('1. [user] earlier question');
    expect(logged[0]).toContain('What is a page fault?');
  });

  it('logs "(empty text)" when a later turn produces nothing', async () => {
    sendMessage.mockResolvedValue({ text: '  ', candidates: [{ finishReason: 'SAFETY' }] });

    await configuredProvider().chat(
      chatRequest({ history: [{ role: 'user', content: 'earlier question' }] }),
    );

    const logged = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((msg) => msg.includes('[GREETING_DEBUG] PROVIDER_RAW:gemini'));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('(empty text)');
    expect(logged[0]).toContain('finishReason: SAFETY');
  });

  it('stays silent when greeting debug is disabled', async () => {
    process.env.CHAT_GREETING_DEBUG = '0';

    await configuredProvider().chat(
      chatRequest({ history: [{ role: 'user', content: 'earlier question' }] }),
    );

    expect(
      warnSpy.mock.calls.filter((call) => String(call[0]).includes('[GREETING_DEBUG]')),
    ).toHaveLength(0);
  });
});

describe('GeminiProvider safety settings', () => {
  beforeEach(() => {
    sendMessage.mockResolvedValue({ text: 'answer' });
  });

  it('blocks medium-and-above harassment by default', async () => {
    await configuredProvider().chat(chatRequest());

    expect(createChatArgs().config.safetySettings).toEqual([HARASSMENT_DEFAULT]);
  });

  it('relaxes dangerous content only when the turn asks for it', async () => {
    await configuredProvider().chat(
      chatRequest({ relaxDangerousContentSafety: true }),
    );

    expect(createChatArgs().config.safetySettings).toEqual([
      HARASSMENT_DEFAULT,
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_NONE',
      },
    ]);
  });

  it('keeps the strict default when the flag is explicitly false', async () => {
    await configuredProvider().chat(
      chatRequest({ relaxDangerousContentSafety: false }),
    );

    expect(createChatArgs().config.safetySettings).toEqual([HARASSMENT_DEFAULT]);
  });

  it('passes the system instruction through the chat config', async () => {
    await configuredProvider().chat(
      chatRequest({ systemInstruction: 'Only answer from the syllabus.' }),
    );

    expect(createChatArgs().config.systemInstruction).toBe(
      'Only answer from the syllabus.',
    );
  });
});

describe('GeminiProvider tool declarations', () => {
  const tool: LlmTool = {
    name: 'build_quiz',
    description: 'Build a quiz for a topic',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic name' },
        count: { type: 'integer' },
        weight: { type: 'number' },
        shuffle: { type: 'Boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        level: { type: 'string', enum: [1, 2] },
        due: { type: 'string', format: 'date-time' },
        window: { type: ['string', 'null'] },
        mystery: { type: 'null' },
        unspecified: { description: 'no type given' },
        nested: {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: ['a'],
          additionalProperties: false,
        },
      },
      required: ['topic'],
    },
  };

  beforeEach(() => {
    sendMessage.mockResolvedValue({ text: 'answer' });
  });

  it('converts LlmTool definitions into Gemini function declarations', async () => {
    await configuredProvider().chat(chatRequest({ tools: [tool] }));

    expect(createChatArgs().config.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'build_quiz',
            description: 'Build a quiz for a topic',
            parameters: {
              type: 'OBJECT',
              properties: {
                topic: { type: 'STRING', description: 'Topic name' },
                count: { type: 'INTEGER' },
                weight: { type: 'NUMBER' },
                shuffle: { type: 'BOOLEAN' },
                tags: { type: 'ARRAY', items: { type: 'STRING' } },
                level: { type: 'STRING', enum: ['1', '2'] },
                due: { type: 'STRING', format: 'date-time' },
                window: { type: 'STRING' },
                mystery: {},
                unspecified: { description: 'no type given' },
                nested: {
                  type: 'OBJECT',
                  properties: { a: { type: 'STRING' } },
                  required: ['a'],
                },
              },
              required: ['topic'],
            },
          },
        ],
      },
    ]);
  });

  it('drops schema keys Gemini does not accept', async () => {
    await configuredProvider().chat(chatRequest({ tools: [tool] }));

    const params = createChatArgs().config.tools![0].functionDeclarations[0]
      .parameters as { properties: Record<string, Record<string, unknown>> };
    expect(params.properties.nested).not.toHaveProperty('additionalProperties');
    expect(params.properties.mystery).not.toHaveProperty('type');
  });

  it('turns on automatic function calling when tools are present', async () => {
    await configuredProvider().chat(chatRequest({ tools: [tool] }));

    expect(createChatArgs().config.toolConfig).toEqual({
      functionCallingConfig: { mode: 'AUTO' },
    });
  });

  it('omits tools and toolConfig when the tool list is empty', async () => {
    await configuredProvider().chat(chatRequest({ tools: [] }));

    expect(createChatArgs().config.tools).toBeUndefined();
    expect(createChatArgs().config.toolConfig).toBeUndefined();
  });
});

describe('GeminiProvider chat result parsing', () => {
  it('trims the response text and reports no tool calls', async () => {
    sendMessage.mockResolvedValue({ text: '  Paging splits memory.  ' });

    const result = await configuredProvider().chat(chatRequest());

    expect(result.text).toBe('Paging splits memory.');
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBeUndefined();
  });

  it('maps function calls into tool calls', async () => {
    sendMessage.mockResolvedValue({
      text: 'Building it.',
      functionCalls: [
        { name: 'build_quiz', args: { topic: 'paging', count: 5 } },
        { name: 'list_topics', args: {} },
      ],
    });

    const result = await configuredProvider().chat(chatRequest());

    expect(result.toolCalls).toEqual([
      { name: 'build_quiz', args: { topic: 'paging', count: 5 } },
      { name: 'list_topics', args: {} },
    ]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('defaults tool call args to an empty object when args is %s', async (_name, args) => {
    sendMessage.mockResolvedValue({
      text: 'ok',
      functionCalls: [{ name: 'list_topics', args }],
    });

    const result = await configuredProvider().chat(chatRequest());

    expect(result.toolCalls).toEqual([{ name: 'list_topics', args: {} }]);
  });

  it('drops function calls that arrive without a usable name', async () => {
    sendMessage.mockResolvedValue({
      text: 'ok',
      functionCalls: [
        { args: { a: 1 } },
        { name: '', args: { b: 2 } },
        { name: 42, args: { c: 3 } },
        { name: 'keep_me', args: { d: 4 } },
      ],
    });

    const result = await configuredProvider().chat(chatRequest());

    expect(result.toolCalls).toEqual([{ name: 'keep_me', args: { d: 4 } }]);
  });

  it('reports the finish reason as a string when the candidate has one', async () => {
    sendMessage.mockResolvedValue({
      text: 'done',
      candidates: [{ finishReason: 'STOP' }],
    });

    const result = await configuredProvider().chat(chatRequest());

    expect(result.finishReason).toBe('STOP');
  });

  it('returns empty text and logs the safety context when the model says nothing', async () => {
    sendMessage.mockResolvedValue({
      text: '   ',
      functionCalls: [],
      candidates: [
        {
          finishReason: 'SAFETY',
          safetyRatings: [
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'HIGH' },
          ],
        },
      ],
    });

    const result = await configuredProvider().chat(chatRequest());

    expect(result).toEqual({ text: '', toolCalls: [], finishReason: 'SAFETY' });
    expect(warnSpy).toHaveBeenCalledWith(
      'Gemini returned empty text (finishReason=SAFETY, toolCalls=[], ' +
        'safetyRatings=[{"category":"HARM_CATEGORY_DANGEROUS_CONTENT","probability":"HIGH"}], ' +
        'relaxDangerous=false)',
    );
  });

  it('logs n/a and an empty rating list when the SDK gives no candidates', async () => {
    sendMessage.mockResolvedValue({});

    const result = await configuredProvider().chat(
      chatRequest({ relaxDangerousContentSafety: true }),
    );

    expect(result.text).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      'Gemini returned empty text (finishReason=n/a, toolCalls=[], safetyRatings=[], relaxDangerous=true)',
    );
  });

  it('names the tool calls in the empty-text warning', async () => {
    sendMessage.mockResolvedValue({
      text: '',
      functionCalls: [
        { name: 'build_quiz', args: { n: 3 } },
        { name: 'list_topics' },
      ],
      candidates: [{ finishReason: 'STOP' }],
    });

    const result = await configuredProvider().chat(chatRequest());

    expect(result.toolCalls).toEqual([
      { name: 'build_quiz', args: { n: 3 } },
      { name: 'list_topics', args: {} },
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      'Gemini returned empty text (finishReason=STOP, toolCalls=["build_quiz","list_topics"], ' +
        'safetyRatings=[], relaxDangerous=false)',
    );
  });

  it('does not warn about empty text when the model answered', async () => {
    sendMessage.mockResolvedValue({ text: 'here you go' });

    await configuredProvider().chat(chatRequest());

    expect(
      warnSpy.mock.calls.filter((call) =>
        String(call[0]).includes('Gemini returned empty text'),
      ),
    ).toHaveLength(0);
  });
});

describe('GeminiProvider error handling', () => {
  it('rejects chat without touching the SDK when unconfigured', async () => {
    const provider = buildProvider({ GEMINI_API_KEY: '  ' });

    await expect(provider.chat(chatRequest())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(provider.chat(chatRequest())).rejects.toThrow(
      'Google Gemini could not complete that request. Try again, or switch to another AI provider.',
    );
    expect(chatsCreate).not.toHaveBeenCalled();
  });

  it('rejects generateJson without touching the SDK when unconfigured', async () => {
    const provider = buildProvider({});

    await expect(provider.generateJson({ prompt: 'p' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('maps an exhausted-quota rejection from sendMessage', async () => {
    sendMessage.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota'));
    const provider = configuredProvider();

    await expect(provider.chat(chatRequest())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(provider.chat(chatRequest())).rejects.toThrow(
      'Google Gemini is rate-limited right now. Wait a moment, or switch to another AI provider.',
    );
  });

  it('maps an invalid-key rejection from sendMessage', async () => {
    sendMessage.mockRejectedValue(new Error('API key not valid. Please pass a valid key.'));

    await expect(configuredProvider().chat(chatRequest())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Gemini chat failed: API key not valid. Please pass a valid key.',
    );
  });

  it('maps a non-Error rejection from sendMessage', async () => {
    sendMessage.mockRejectedValue('overloaded');

    await expect(configuredProvider().chat(chatRequest())).rejects.toThrow(
      'Google Gemini is temporarily unavailable. Try again shortly, or switch to another AI provider.',
    );
    expect(warnSpy).toHaveBeenCalledWith('Gemini chat failed: overloaded');
  });

  it('maps a timeout rejection from generateContent', async () => {
    generateContent.mockRejectedValue(
      Object.assign(new Error('deadline exceeded'), { status: 504 }),
    );
    const provider = configuredProvider();

    await expect(provider.generateJson({ prompt: 'p' })).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Gemini JSON generation failed: deadline exceeded',
    );
  });

  it('maps a non-Error rejection from generateContent', async () => {
    generateContent.mockRejectedValue('overloaded');

    await expect(
      configuredProvider().generateJson({ prompt: 'p' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(warnSpy).toHaveBeenCalledWith(
      'Gemini JSON generation failed: overloaded',
    );
  });
});

describe('GeminiProvider generateJson', () => {
  it('requests JSON output with no schema constraint by default', async () => {
    generateContent.mockResolvedValue({ text: '{"ok":true}' });

    const raw = await configuredProvider().generateJson({
      prompt: 'Build a study guide',
    });

    expect(raw).toBe('{"ok":true}');
    const args = generateContentArgs();
    expect(args.contents).toBe('Build a study guide');
    expect(args.config.responseMimeType).toBe('application/json');
    expect(args.config.responseSchema).toBeUndefined();
  });

  it('converts the requested schema into a Gemini response schema', async () => {
    generateContent.mockResolvedValue({ text: '{"title":"x"}' });

    await configuredProvider().generateJson({
      prompt: 'Build a study guide',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Guide title' },
          steps: { type: 'array', items: { type: 'integer' } },
        },
        required: ['title'],
      },
    });

    expect(generateContentArgs().config.responseSchema).toEqual({
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Guide title' },
        steps: { type: 'ARRAY', items: { type: 'INTEGER' } },
      },
      required: ['title'],
    });
  });

  it('trims the generated JSON text', async () => {
    generateContent.mockResolvedValue({ text: '\n  {"a":1}\n' });

    await expect(
      configuredProvider().generateJson({ prompt: 'p' }),
    ).resolves.toBe('{"a":1}');
  });

  it.each([
    ['blank', '   '],
    ['empty', ''],
    ['missing', undefined],
  ])('rejects a %s JSON response', async (_name, text) => {
    generateContent.mockResolvedValue({ text });
    const provider = configuredProvider();

    await expect(provider.generateJson({ prompt: 'p' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(provider.generateJson({ prompt: 'p' })).rejects.toThrow(
      'Google Gemini returned an empty response. Try again, or switch to another AI provider.',
    );
  });
});
