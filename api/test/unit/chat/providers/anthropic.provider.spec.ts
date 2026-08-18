import {
  BadGatewayException,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AnthropicProvider } from '../../../../src/chat/providers/anthropic.provider';
import type { LlmChatRequest, LlmTool } from '../../../../src/chat/providers/provider.types';

jest.mock('@anthropic-ai/sdk', () => {
  const create = jest.fn();
  const AnthropicCtor = jest.fn().mockImplementation(() => ({
    messages: { create },
  }));
  return {
    __esModule: true,
    default: AnthropicCtor,
    // Handles kept on the mock module itself so the spec can reach them without
    // tripping over jest.mock factory hoisting.
    __handles: { create, AnthropicCtor },
  };
});

const { create, AnthropicCtor } = (
  jest.requireMock('@anthropic-ai/sdk') as {
    __handles: { create: jest.Mock; AnthropicCtor: jest.Mock };
  }
).__handles;

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const JSON_SYSTEM =
  'You are a careful JSON generator. Reply with valid JSON only — no markdown fences.';

interface MessagesCreateArgs {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}

function buildProvider(values: Record<string, string | undefined> = {}) {
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return new AnthropicProvider(config);
}

function configuredProvider(extra: Record<string, string | undefined> = {}) {
  return buildProvider({ ANTHROPIC_API_KEY: 'sk-ant-test', ...extra });
}

function chatRequest(overrides: Partial<LlmChatRequest> = {}): LlmChatRequest {
  return {
    systemInstruction: 'Stay on the course material.',
    history: [],
    message: 'What is a page fault?',
    ...overrides,
  };
}

function textBlocks(...texts: string[]) {
  return { content: texts.map((text) => ({ type: 'text', text })) };
}

function createArgs(index = 0): MessagesCreateArgs {
  return create.mock.calls[index][0] as MessagesCreateArgs;
}

let warnSpy: jest.SpyInstance;
const originalGreetingDebug = process.env.CHAT_GREETING_DEBUG;

beforeEach(() => {
  create.mockReset();
  AnthropicCtor.mockClear();
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

describe('AnthropicProvider configuration', () => {
  it('builds the SDK client from the trimmed key and exposes registry metadata', () => {
    const provider = buildProvider({ ANTHROPIC_API_KEY: '  sk-ant-test  ' });

    expect(provider.id).toBe('anthropic');
    expect(provider.displayName).toBe('Anthropic Claude');
    expect(provider.isConfigured()).toBe(true);
    expect(AnthropicCtor).toHaveBeenCalledTimes(1);
    expect(AnthropicCtor).toHaveBeenCalledWith({ apiKey: 'sk-ant-test' });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace only', '   \n\t '],
  ])('reports not configured and builds no client when the key is %s', (_name, key) => {
    const provider = buildProvider({ ANTHROPIC_API_KEY: key });

    expect(provider.isConfigured()).toBe(false);
    expect(AnthropicCtor).not.toHaveBeenCalled();
  });

  it('falls back to the default model when ANTHROPIC_MODEL is absent', async () => {
    create.mockResolvedValue(textBlocks('ok'));
    await configuredProvider().chat(chatRequest());

    expect(createArgs().model).toBe(DEFAULT_MODEL);
  });

  it.each([
    ['blank', '   '],
    ['empty', ''],
  ])('falls back to the default model when ANTHROPIC_MODEL is %s', async (_name, model) => {
    create.mockResolvedValue(textBlocks('ok'));
    await configuredProvider({ ANTHROPIC_MODEL: model }).chat(chatRequest());

    expect(createArgs().model).toBe(DEFAULT_MODEL);
  });

  it('uses a trimmed custom model from config', async () => {
    create.mockResolvedValue(textBlocks('ok'));
    await configuredProvider({
      ANTHROPIC_MODEL: '  claude-opus-4-1  ',
    }).chat(chatRequest());

    expect(createArgs().model).toBe('claude-opus-4-1');
  });
});

describe('AnthropicProvider chat message normalisation', () => {
  beforeEach(() => {
    create.mockResolvedValue(textBlocks('answer'));
  });

  it('sends the system prompt top-level and the message as the only turn when history is empty', async () => {
    await configuredProvider().chat(
      chatRequest({ systemInstruction: 'Be concise.', message: 'Hello' }),
    );

    const args = createArgs();
    expect(args.system).toBe('Be concise.');
    expect(args.max_tokens).toBe(4096);
    expect(args.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(args.tools).toBeUndefined();
  });

  it('merges consecutive same-role turns with a newline', async () => {
    await configuredProvider().chat(
      chatRequest({
        history: [
          { role: 'user', content: 'first' },
          { role: 'user', content: 'second' },
          { role: 'assistant', content: 'reply a' },
          { role: 'assistant', content: 'reply b' },
        ],
        message: 'follow up',
      }),
    );

    expect(createArgs().messages).toEqual([
      { role: 'user', content: 'first\nsecond' },
      { role: 'assistant', content: 'reply a\nreply b' },
      { role: 'user', content: 'follow up' },
    ]);
  });

  it('folds the new message into a trailing user turn', async () => {
    await configuredProvider().chat(
      chatRequest({
        history: [{ role: 'user', content: 'What is paging?' }],
        message: 'Explain further',
      }),
    );

    expect(createArgs().messages).toEqual([
      { role: 'user', content: 'What is paging?\nExplain further' },
    ]);
  });

  it('seeds a "(Conversation opened.)" user turn when history starts with the assistant', async () => {
    await configuredProvider().chat(
      chatRequest({
        history: [{ role: 'assistant', content: 'Welcome to Section 3.' }],
        message: 'What is a hash?',
      }),
    );

    expect(createArgs().messages).toEqual([
      { role: 'user', content: '(Conversation opened.)' },
      { role: 'assistant', content: 'Welcome to Section 3.' },
      { role: 'user', content: 'What is a hash?' },
    ]);
  });

  it('merges the leading assistant turns before seeding the opener', async () => {
    await configuredProvider().chat(
      chatRequest({
        history: [
          { role: 'assistant', content: 'Welcome.' },
          { role: 'assistant', content: 'Pick a topic.' },
        ],
        message: 'Deadlocks',
      }),
    );

    expect(createArgs().messages).toEqual([
      { role: 'user', content: '(Conversation opened.)' },
      { role: 'assistant', content: 'Welcome.\nPick a topic.' },
      { role: 'user', content: 'Deadlocks' },
    ]);
  });

  it('does not seed an opener when history already starts with a user turn', async () => {
    await configuredProvider().chat(
      chatRequest({
        history: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ],
        message: 'more',
      }),
    );

    expect(createArgs().messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'more' },
    ]);
  });

  it('leaves the caller-owned history array untouched while merging', async () => {
    const history: LlmChatRequest['history'] = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ];

    await configuredProvider().chat(chatRequest({ history, message: 'c' }));

    expect(history).toEqual([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ]);
  });

  it('logs the normalised payload once the conversation has a prior user turn', async () => {
    await configuredProvider().chat(
      chatRequest({ history: [{ role: 'user', content: 'earlier question' }] }),
    );

    const logged = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((msg) => msg.includes('[GREETING_DEBUG] PROVIDER_PAYLOAD:anthropic'));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('[user] earlier question What is a page fault?');
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

  it('logs "(empty text)" for a tool-only reply on a later turn', async () => {
    create.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'build_quiz', input: {} }],
    });

    await configuredProvider().chat(
      chatRequest({ history: [{ role: 'user', content: 'earlier question' }] }),
    );

    const logged = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((msg) => msg.includes('[GREETING_DEBUG] PROVIDER_RAW:anthropic'));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('(empty text)');
  });

  it('does not log the payload on the very first turn', async () => {
    await configuredProvider().chat(chatRequest({ history: [] }));

    expect(
      warnSpy.mock.calls.filter((call) => String(call[0]).includes('[GREETING_DEBUG]')),
    ).toHaveLength(0);
  });
});

describe('AnthropicProvider tool schemas', () => {
  const tool: LlmTool = {
    name: 'create_flashcards',
    description: 'Build flashcards for a topic',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic name' },
        count: { type: 'integer' },
        difficulty: { type: 'string', enum: ['easy', 'hard'] },
        tags: { type: 'array', items: { type: 'string' } },
        dueDate: { type: 'string', format: 'date-time' },
        window: { type: ['string', 'null'] },
        nested: {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: ['a'],
          additionalProperties: false,
        },
        mystery: {},
      },
      required: ['topic'],
    },
  };

  beforeEach(() => {
    create.mockResolvedValue(textBlocks('answer'));
  });

  it('converts LlmTool definitions into Anthropic tool schemas', async () => {
    await configuredProvider().chat(chatRequest({ tools: [tool] }));

    expect(createArgs().tools).toEqual([
      {
        name: 'create_flashcards',
        description: 'Build flashcards for a topic',
        input_schema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Topic name' },
            count: { type: 'integer' },
            difficulty: { type: 'string', enum: ['easy', 'hard'] },
            tags: { type: 'array', items: { type: 'string' } },
            dueDate: { type: 'string' },
            window: { type: 'string' },
            nested: {
              type: 'object',
              properties: { a: { type: 'string' } },
              required: ['a'],
            },
            mystery: {},
          },
          required: ['topic'],
        },
      },
    ]);
  });

  it('drops keys Anthropic does not accept from the plain schema', async () => {
    await configuredProvider().chat(chatRequest({ tools: [tool] }));

    const schema = createArgs().tools![0].input_schema as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(schema.properties.dueDate).not.toHaveProperty('format');
    expect(schema.properties.nested).not.toHaveProperty('additionalProperties');
  });

  it('sends no tools key when the tool list is empty', async () => {
    await configuredProvider().chat(chatRequest({ tools: [] }));

    expect(createArgs().tools).toBeUndefined();
  });
});

describe('AnthropicProvider chat response parsing', () => {
  it('joins text blocks with newlines and trims the result', async () => {
    create.mockResolvedValue(textBlocks('  Hello', 'World  '));

    const result = await configuredProvider().chat(chatRequest());

    expect(result).toEqual({ text: 'Hello\nWorld', toolCalls: [] });
  });

  it('parses tool_use blocks into tool calls alongside text', async () => {
    create.mockResolvedValue({
      content: [
        { type: 'text', text: 'Making cards.' },
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'create_flashcards',
          input: { topic: 'paging', count: 5 },
        },
      ],
    });

    const result = await configuredProvider().chat(chatRequest());

    expect(result).toEqual({
      text: 'Making cards.',
      toolCalls: [{ name: 'create_flashcards', args: { topic: 'paging', count: 5 } }],
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('defaults tool call args to an empty object when input is %s', async (_name, input) => {
    create.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'list_topics', input }],
    });

    const result = await configuredProvider().chat(chatRequest());

    expect(result.toolCalls).toEqual([{ name: 'list_topics', args: {} }]);
  });

  it('returns tool calls with empty text when the model only calls a tool', async () => {
    create.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'build_quiz', input: { n: 3 } }],
    });

    const result = await configuredProvider().chat(chatRequest());

    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([{ name: 'build_quiz', args: { n: 3 } }]);
  });

  it('keeps every tool_use block in order', async () => {
    create.mockResolvedValue({
      content: [
        { type: 'tool_use', id: '1', name: 'first', input: { a: 1 } },
        { type: 'tool_use', id: '2', name: 'second', input: { b: 2 } },
      ],
    });

    const result = await configuredProvider().chat(chatRequest());

    expect(result.toolCalls.map((c) => c.name)).toEqual(['first', 'second']);
  });

  it('ignores block types it does not understand', async () => {
    create.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: 'Final answer' },
      ],
    });

    const result = await configuredProvider().chat(chatRequest());

    expect(result).toEqual({ text: 'Final answer', toolCalls: [] });
  });

  it.each([
    ['there are no blocks at all', []],
    ['every text block is blank', [{ type: 'text', text: '   ' }]],
    ['only unknown blocks came back', [{ type: 'thinking', thinking: 'hmm' }]],
  ])('rejects the turn when %s', async (_name, content) => {
    create.mockResolvedValue({ content });
    const provider = configuredProvider();

    await expect(provider.chat(chatRequest())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(provider.chat(chatRequest())).rejects.toThrow(
      'Anthropic Claude returned an unusable response. Try again, or switch to another AI provider.',
    );
  });
});

describe('AnthropicProvider error handling', () => {
  it('rejects chat with a key error and never calls the SDK when unconfigured', async () => {
    const provider = buildProvider({ ANTHROPIC_API_KEY: ' ' });

    await expect(provider.chat(chatRequest())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(provider.chat(chatRequest())).rejects.toThrow(
      'Anthropic Claude rejected the configured API key. Ask your administrator to check the key, or switch to another AI provider.',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects generateJson with a key error when unconfigured', async () => {
    const provider = buildProvider({});

    await expect(
      provider.generateJson({ prompt: 'make json' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('maps a rate-limited SDK rejection during chat', async () => {
    create.mockRejectedValue(Object.assign(new Error('rate_limit_error'), { status: 429 }));
    const provider = configuredProvider();

    await expect(provider.chat(chatRequest())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(provider.chat(chatRequest())).rejects.toThrow(
      'Anthropic Claude is rate-limited right now. Wait a moment, or switch to another AI provider.',
    );
  });

  it('maps an authentication SDK rejection during chat', async () => {
    create.mockRejectedValue(
      Object.assign(new Error('invalid x-api-key'), { status: 401 }),
    );

    await expect(configuredProvider().chat(chatRequest())).rejects.toThrow(
      /rejected the configured API key/,
    );
  });

  it('maps a non-Error rejection during chat', async () => {
    create.mockRejectedValue('Overloaded');

    await expect(configuredProvider().chat(chatRequest())).rejects.toThrow(
      'Anthropic Claude is temporarily unavailable. Try again shortly, or switch to another AI provider.',
    );
  });

  it('logs the upstream reason before mapping it', async () => {
    create.mockRejectedValue(new Error('boom upstream'));

    await expect(configuredProvider().chat(chatRequest())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(warnSpy).toHaveBeenCalledWith('Anthropic chat failed: boom upstream');
  });

  it('maps an SDK rejection during generateJson', async () => {
    create.mockRejectedValue(Object.assign(new Error('timed out'), { status: 504 }));

    await expect(
      configuredProvider().generateJson({ prompt: 'make json' }),
    ).rejects.toThrow(
      'Anthropic Claude took too long to respond. Try again, or switch to another AI provider.',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Anthropic JSON generation failed: timed out',
    );
  });

  it('maps a non-Error rejection during generateJson', async () => {
    create.mockRejectedValue('Overloaded');

    await expect(
      configuredProvider().generateJson({ prompt: 'make json' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(warnSpy).toHaveBeenCalledWith(
      'Anthropic JSON generation failed: Overloaded',
    );
  });
});

describe('AnthropicProvider generateJson', () => {
  it('asks for JSON only, with no tools and a larger token budget', async () => {
    create.mockResolvedValue(textBlocks('{"ok":true}'));

    await configuredProvider().generateJson({ prompt: 'Build a study guide' });

    const args = createArgs();
    expect(args.max_tokens).toBe(8192);
    expect(args.system).toBe(JSON_SYSTEM);
    expect(args.messages).toEqual([
      { role: 'user', content: 'Build a study guide' },
    ]);
    expect(args).not.toHaveProperty('tools');
  });

  it('appends a plain JSON schema hint to the system prompt', async () => {
    create.mockResolvedValue(textBlocks('{"title":"x"}'));

    await configuredProvider().generateJson({
      prompt: 'Build a study guide',
      schemaName: 'studyGuide',
      schema: {
        type: 'object',
        description: 'A study guide',
        properties: {
          title: { type: 'string' },
          steps: { type: 'array', items: { type: 'integer' } },
        },
        required: ['title'],
      },
    });

    expect(createArgs().system).toBe(
      `${JSON_SYSTEM}\nReturn JSON matching this schema:\n` +
        '{"type":"object","description":"A study guide","properties":' +
        '{"title":{"type":"string"},"steps":{"type":"array","items":{"type":"integer"}}},' +
        '"required":["title"]}',
    );
  });

  it.each([
    ['a ```json fenced block', '```json\n{"a":1}\n```', '{"a":1}'],
    ['an unlabelled fenced block', '```\n{"b":2}\n```', '{"b":2}'],
    ['an uppercase JSON fence', '```JSON\n{"c":3}\n```', '{"c":3}'],
    ['a fence with no newlines', '```json {"d":4} ```', '{"d":4}'],
    ['bare JSON wrapped in whitespace', '\n\n  {"e":5}  \n', '{"e":5}'],
    ['a fenced array', '```json\n[1, 2]\n```', '[1, 2]'],
  ])('strips %s', async (_name, raw, expected) => {
    create.mockResolvedValue(textBlocks(raw));

    await expect(
      configuredProvider().generateJson({ prompt: 'p' }),
    ).resolves.toBe(expected);
  });

  it('leaves a fence that is not at the boundaries alone', async () => {
    create.mockResolvedValue(textBlocks('Here you go: ```json\n{"f":6}\n``` enjoy'));

    await expect(configuredProvider().generateJson({ prompt: 'p' })).resolves.toBe(
      'Here you go: ```json\n{"f":6}\n``` enjoy',
    );
  });

  it('joins multiple text blocks and skips non-text blocks', async () => {
    create.mockResolvedValue({
      content: [
        { type: 'text', text: '{"a":1,' },
        { type: 'tool_use', id: 'tu_1', name: 'ignored', input: {} },
        { type: 'text', text: '"b":2}' },
      ],
    });

    await expect(configuredProvider().generateJson({ prompt: 'p' })).resolves.toBe(
      '{"a":1,\n"b":2}',
    );
  });

  it.each([
    ['no text blocks', []],
    ['blank text', [{ type: 'text', text: '   \n ' }]],
    ['an empty fence', [{ type: 'text', text: '```json\n\n```' }]],
  ])('rejects an empty JSON response built from %s', async (_name, content) => {
    create.mockResolvedValue({ content });
    const provider = configuredProvider();

    await expect(provider.generateJson({ prompt: 'p' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(provider.generateJson({ prompt: 'p' })).rejects.toThrow(
      'Anthropic Claude returned an empty response. Try again, or switch to another AI provider.',
    );
  });
});
