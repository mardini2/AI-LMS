import {
  BadGatewayException,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  OpenAiCompatibleProvider,
  type OpenAiCompatibleConfig,
} from '../../../../src/chat/providers/openai-compatible.provider';
import type { LlmChatRequest, LlmTool } from '../../../../src/chat/providers/provider.types';

jest.mock('openai', () => {
  const create = jest.fn();
  const OpenAiCtor = jest.fn().mockImplementation(() => ({
    chat: { completions: { create } },
  }));
  return {
    __esModule: true,
    default: OpenAiCtor,
    // Handles kept on the mock module itself so the spec can reach them without
    // tripping over jest.mock factory hoisting.
    __handles: { create, OpenAiCtor },
  };
});

const { create, OpenAiCtor } = (
  jest.requireMock('openai') as {
    __handles: { create: jest.Mock; OpenAiCtor: jest.Mock };
  }
).__handles;

const JSON_SYSTEM =
  'You are a careful JSON generator. Reply with valid JSON only — no markdown fences.';

interface CompletionArgs {
  model: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?: string;
  response_format?: {
    type: string;
    json_schema?: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
}

function buildProvider(overrides: Partial<OpenAiCompatibleConfig> = {}) {
  return new OpenAiCompatibleProvider({
    id: 'openai',
    displayName: 'OpenAI ChatGPT',
    apiKey: 'sk-test',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    ...overrides,
  });
}

function grokProvider(overrides: Partial<OpenAiCompatibleConfig> = {}) {
  return buildProvider({
    id: 'xai',
    displayName: 'xAI Grok',
    apiKey: 'xai-test',
    baseURL: 'https://api.x.ai/v1',
    defaultModel: 'grok-4',
    ...overrides,
  });
}

function chatRequest(overrides: Partial<LlmChatRequest> = {}): LlmChatRequest {
  return {
    systemInstruction: 'Stay on the course material.',
    history: [],
    message: 'What is a page fault?',
    ...overrides,
  };
}

function textCompletion(content: string | null) {
  return { choices: [{ message: { content } }] };
}

function completionArgs(index = 0): CompletionArgs {
  return create.mock.calls[index][0] as CompletionArgs;
}

let warnSpy: jest.SpyInstance;
const originalGreetingDebug = process.env.CHAT_GREETING_DEBUG;

beforeEach(() => {
  create.mockReset();
  OpenAiCtor.mockClear();
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

describe('OpenAiCompatibleProvider configuration', () => {
  it('builds one SDK client from the trimmed key, base URL and extra headers', () => {
    const provider = buildProvider({
      apiKey: '  sk-test  ',
      defaultHeaders: { 'HTTP-Referer': 'https://lms.example' },
    });

    expect(provider.id).toBe('openai');
    expect(provider.displayName).toBe('OpenAI ChatGPT');
    expect(provider.isConfigured()).toBe(true);
    expect(OpenAiCtor).toHaveBeenCalledTimes(1);
    expect(OpenAiCtor).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://api.openai.com/v1',
      defaultHeaders: { 'HTTP-Referer': 'https://lms.example' },
    });
  });

  it('keeps the host-specific id, label and base URL for a sibling host', () => {
    const provider = grokProvider();

    expect(provider.id).toBe('xai');
    expect(provider.displayName).toBe('xAI Grok');
    expect(OpenAiCtor).toHaveBeenCalledWith({
      apiKey: 'xai-test',
      baseURL: 'https://api.x.ai/v1',
      defaultHeaders: undefined,
    });
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   \t'],
    ['undefined', undefined as unknown as string],
  ])('reports not configured and builds no client when the key is %s', (_name, apiKey) => {
    const provider = buildProvider({ apiKey });

    expect(provider.isConfigured()).toBe(false);
    expect(OpenAiCtor).not.toHaveBeenCalled();
  });

  it('sends the configured default model verbatim', async () => {
    create.mockResolvedValue(textCompletion('ok'));
    await buildProvider({ defaultModel: 'gpt-5-mini' }).chat(chatRequest());

    expect(completionArgs().model).toBe('gpt-5-mini');
  });
});

describe('OpenAiCompatibleProvider chat messages', () => {
  beforeEach(() => {
    create.mockResolvedValue(textCompletion('answer'));
  });

  it('puts the system instruction first and the new message last', async () => {
    await buildProvider().chat(
      chatRequest({
        systemInstruction: 'Be concise.',
        history: [
          { role: 'user', content: 'What is paging?' },
          { role: 'assistant', content: 'Paging splits memory.' },
        ],
        message: 'Explain further',
      }),
    );

    expect(completionArgs().messages).toEqual([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'What is paging?' },
      { role: 'assistant', content: 'Paging splits memory.' },
      { role: 'user', content: 'Explain further' },
    ]);
  });

  it('keeps consecutive same-role turns separate instead of merging them', async () => {
    await buildProvider().chat(
      chatRequest({
        history: [
          { role: 'user', content: 'first' },
          { role: 'user', content: 'second' },
        ],
        message: 'third',
      }),
    );

    expect(completionArgs().messages).toEqual([
      { role: 'system', content: 'Stay on the course material.' },
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
      { role: 'user', content: 'third' },
    ]);
  });

  it('does not seed an opener when history starts with the assistant', async () => {
    await buildProvider().chat(
      chatRequest({
        history: [{ role: 'assistant', content: 'Welcome to Section 3.' }],
        message: 'Thanks',
      }),
    );

    expect(completionArgs().messages).toEqual([
      { role: 'system', content: 'Stay on the course material.' },
      { role: 'assistant', content: 'Welcome to Section 3.' },
      { role: 'user', content: 'Thanks' },
    ]);
  });

  it('sends only the system prompt and the message when there is no history', async () => {
    await buildProvider().chat(chatRequest({ message: 'Hello' }));

    const args = completionArgs();
    expect(args.messages).toEqual([
      { role: 'system', content: 'Stay on the course material.' },
      { role: 'user', content: 'Hello' },
    ]);
    expect(args.tools).toBeUndefined();
    expect(args.tool_choice).toBeUndefined();
  });

  it('logs the outgoing messages once the conversation has a prior user turn', async () => {
    await grokProvider().chat(
      chatRequest({ history: [{ role: 'user', content: 'earlier question' }] }),
    );

    const logged = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((msg) => msg.includes('[GREETING_DEBUG] PROVIDER_PAYLOAD:xai'));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('1. [system] Stay on the course material.');
    expect(logged[0]).toContain('2. [user] earlier question');
  });

  it('logs "(empty text)" for a tool-only reply on a later turn', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'build_quiz', arguments: '{}' },
              },
            ],
          },
        },
      ],
    });

    await buildProvider().chat(
      chatRequest({ history: [{ role: 'user', content: 'earlier question' }] }),
    );

    const logged = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((msg) => msg.includes('[GREETING_DEBUG] PROVIDER_RAW:openai'));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('(empty text)');
  });

  it('stays silent when greeting debug is disabled', async () => {
    process.env.CHAT_GREETING_DEBUG = '0';

    await buildProvider().chat(
      chatRequest({ history: [{ role: 'user', content: 'earlier question' }] }),
    );

    expect(
      warnSpy.mock.calls.filter((call) => String(call[0]).includes('[GREETING_DEBUG]')),
    ).toHaveLength(0);
  });
});

describe('OpenAiCompatibleProvider tool schemas', () => {
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
        due: { type: 'string', format: 'date-time' },
        window: { type: ['string', 'null'] },
        mystery: {},
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
    create.mockResolvedValue(textCompletion('answer'));
  });

  it('converts LlmTool definitions into OpenAI function tools', async () => {
    await buildProvider().chat(chatRequest({ tools: [tool] }));

    expect(completionArgs().tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'create_flashcards',
          description: 'Build flashcards for a topic',
          parameters: {
            type: 'object',
            properties: {
              topic: { type: 'string', description: 'Topic name' },
              count: { type: 'integer' },
              difficulty: { type: 'string', enum: ['easy', 'hard'] },
              tags: { type: 'array', items: { type: 'string' } },
              due: { type: 'string', format: 'date-time' },
              window: { type: 'string' },
              mystery: {},
              nested: {
                type: 'object',
                properties: { a: { type: 'string' } },
                required: ['a'],
                additionalProperties: false,
              },
            },
            required: ['topic'],
          },
        },
      },
    ]);
  });

  it('lets the model decide whether to call a tool', async () => {
    await buildProvider().chat(chatRequest({ tools: [tool] }));

    expect(completionArgs().tool_choice).toBe('auto');
  });

  it('sends no tools and no tool_choice when the tool list is empty', async () => {
    await buildProvider().chat(chatRequest({ tools: [] }));

    expect(completionArgs().tools).toBeUndefined();
    expect(completionArgs().tool_choice).toBeUndefined();
  });
});

describe('OpenAiCompatibleProvider chat response parsing', () => {
  it('trims the assistant content', async () => {
    create.mockResolvedValue(textCompletion('  Paging splits memory.\n'));

    const result = await buildProvider().chat(chatRequest());

    expect(result).toEqual({ text: 'Paging splits memory.', toolCalls: [] });
  });

  it('parses function tool calls and their JSON arguments', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Making cards.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'create_flashcards',
                  arguments: '{"topic":"paging","count":5}',
                },
              },
            ],
          },
        },
      ],
    });

    const result = await buildProvider().chat(chatRequest());

    expect(result).toEqual({
      text: 'Making cards.',
      toolCalls: [
        { name: 'create_flashcards', args: { topic: 'paging', count: 5 } },
      ],
    });
  });

  it.each([
    ['unparseable JSON', 'not json at all'],
    ['an empty arguments string', ''],
    ['a whitespace-only arguments string', '  '],
    ['a truncated JSON object', '{"topic":'],
  ])('falls back to empty args for %s', async (_name, args) => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'ok',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'list_topics', arguments: args },
              },
            ],
          },
        },
      ],
    });

    const result = await buildProvider().chat(chatRequest());

    expect(result.toolCalls).toEqual([{ name: 'list_topics', args: {} }]);
  });

  it('skips tool calls that are not function calls', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'ok',
            tool_calls: [
              { id: 'c1', type: 'custom', custom: { name: 'shell' } },
              {
                id: 'c2',
                type: 'function',
                function: { name: 'keep_me', arguments: '{"a":1}' },
              },
            ],
          },
        },
      ],
    });

    const result = await buildProvider().chat(chatRequest());

    expect(result.toolCalls).toEqual([{ name: 'keep_me', args: { a: 1 } }]);
  });

  it('returns tool calls with empty text when content is null', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'build_quiz', arguments: '{"n":3}' },
              },
            ],
          },
        },
      ],
    });

    const result = await buildProvider().chat(chatRequest());

    expect(result.text).toBe('');
    expect(result.toolCalls).toEqual([{ name: 'build_quiz', args: { n: 3 } }]);
  });

  it.each([
    ['no choices came back', { choices: [] }],
    ['the content is blank with no tool calls', textCompletion('   ')],
    ['the content is null with no tool calls', textCompletion(null)],
    [
      'the tool call list is empty',
      { choices: [{ message: { content: '', tool_calls: [] } }] },
    ],
  ])('rejects the turn when %s', async (_name, completion) => {
    create.mockResolvedValue(completion);
    const provider = buildProvider();

    await expect(provider.chat(chatRequest())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(provider.chat(chatRequest())).rejects.toThrow(
      'OpenAI ChatGPT returned an unusable response. Try again, or switch to another AI provider.',
    );
  });
});

describe('OpenAiCompatibleProvider chat error handling', () => {
  it('rejects with a key error and never calls the SDK when unconfigured', async () => {
    const provider = buildProvider({ apiKey: '  ' });

    await expect(provider.chat(chatRequest())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(provider.chat(chatRequest())).rejects.toThrow(
      'OpenAI ChatGPT rejected the configured API key. Ask your administrator to check the key, or switch to another AI provider.',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('maps a rate-limited SDK rejection and logs the upstream reason', async () => {
    create.mockRejectedValue(
      Object.assign(new Error('Rate limit reached for gpt-4o-mini'), { status: 429 }),
    );
    const provider = buildProvider();

    await expect(provider.chat(chatRequest())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(provider.chat(chatRequest())).rejects.toThrow(
      'OpenAI ChatGPT is rate-limited right now. Wait a moment, or switch to another AI provider.',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'OpenAI ChatGPT chat failed: Rate limit reached for gpt-4o-mini',
    );
  });

  it('maps a bad-model SDK rejection', async () => {
    create.mockRejectedValue(new Error('The model `gpt-9` does not exist'));

    await expect(buildProvider().chat(chatRequest())).rejects.toThrow(
      'OpenAI ChatGPT could not use the configured model. Ask your administrator to check the model name, or switch to another AI provider.',
    );
  });

  it('maps a non-Error rejection using the provider label', async () => {
    create.mockRejectedValue('overloaded');

    await expect(grokProvider().chat(chatRequest())).rejects.toThrow(
      'xAI Grok is temporarily unavailable. Try again shortly, or switch to another AI provider.',
    );
    expect(warnSpy).toHaveBeenCalledWith('xAI Grok chat failed: overloaded');
  });
});

describe('OpenAiCompatibleProvider generateJson', () => {
  it('uses json_schema mode for OpenAI when a schema is supplied', async () => {
    create.mockResolvedValue(textCompletion('{"title":"x"}'));

    const raw = await buildProvider().generateJson({
      prompt: 'Build a study guide',
      schemaName: 'studyGuide',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          steps: { type: 'array', items: { type: 'integer' } },
        },
        required: ['title'],
        additionalProperties: false,
      },
    });

    expect(raw).toBe('{"title":"x"}');
    const args = completionArgs();
    expect(args.messages).toEqual([
      { role: 'system', content: JSON_SYSTEM },
      { role: 'user', content: 'Build a study guide' },
    ]);
    expect(args.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'studyGuide',
        strict: false,
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            steps: { type: 'array', items: { type: 'integer' } },
          },
          required: ['title'],
          additionalProperties: false,
        },
      },
    });
  });

  it('names the schema "response" when no schema name is given', async () => {
    create.mockResolvedValue(textCompletion('{}'));

    await buildProvider().generateJson({
      prompt: 'p',
      schema: { type: 'object' },
    });

    expect(completionArgs().response_format?.json_schema?.name).toBe('response');
  });

  it('falls back to json_object mode for OpenAI without a schema', async () => {
    create.mockResolvedValue(textCompletion('{"a":1}'));

    await buildProvider().generateJson({ prompt: 'p' });

    expect(completionArgs().response_format).toEqual({ type: 'json_object' });
  });

  it('never asks a non-OpenAI host for json_schema mode even with a schema', async () => {
    create.mockResolvedValue(textCompletion('{"a":1}'));

    await grokProvider().generateJson({
      prompt: 'p',
      schemaName: 'studyGuide',
      schema: { type: 'object', properties: { a: { type: 'string' } } },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(completionArgs().response_format).toEqual({ type: 'json_object' });
  });

  it('trims the generated JSON', async () => {
    create.mockResolvedValue(textCompletion('\n {"a":1} \n'));

    await expect(buildProvider().generateJson({ prompt: 'p' })).resolves.toBe(
      '{"a":1}',
    );
  });

  it.each([
    ['blank', '   '],
    ['null', null],
  ])('rejects a %s JSON response from OpenAI without retrying', async (_name, content) => {
    create.mockResolvedValue(textCompletion(content));
    const provider = buildProvider();

    await expect(provider.generateJson({ prompt: 'p' })).rejects.toThrow(
      'OpenAI ChatGPT returned an empty response. Try again, or switch to another AI provider.',
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing choice list from OpenAI', async () => {
    create.mockResolvedValue({ choices: [] });

    await expect(buildProvider().generateJson({ prompt: 'p' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('does not retry OpenAI failures', async () => {
    create.mockRejectedValue(Object.assign(new Error('nope'), { status: 401 }));

    await expect(buildProvider().generateJson({ prompt: 'p' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('OpenAI ChatGPT JSON generation failed: nope');
  });

  it('retries a non-OpenAI host as plain text JSON when json_object is rejected', async () => {
    create
      .mockRejectedValueOnce(new Error('response_format is not supported'))
      .mockResolvedValueOnce(textCompletion(' {"a":1} '));

    await expect(grokProvider().generateJson({ prompt: 'p' })).resolves.toBe(
      '{"a":1}',
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(completionArgs(0).response_format).toEqual({ type: 'json_object' });
    expect(completionArgs(1)).not.toHaveProperty('response_format');
    expect(completionArgs(1).messages).toEqual([
      { role: 'system', content: JSON_SYSTEM },
      { role: 'user', content: 'p' },
    ]);
    expect(completionArgs(1).model).toBe('grok-4');
  });

  it('retries a non-OpenAI host when the first attempt came back empty', async () => {
    create
      .mockResolvedValueOnce(textCompletion('   '))
      .mockResolvedValueOnce(textCompletion('{"b":2}'));

    await expect(grokProvider().generateJson({ prompt: 'p' })).resolves.toBe(
      '{"b":2}',
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('maps the retry failure, not the first failure, for a non-OpenAI host', async () => {
    create
      .mockRejectedValueOnce(new Error('internal error'))
      .mockRejectedValueOnce(
        Object.assign(new Error('Rate limit reached'), { status: 429 }),
      );

    await expect(grokProvider().generateJson({ prompt: 'p' })).rejects.toThrow(
      'xAI Grok is rate-limited right now. Wait a moment, or switch to another AI provider.',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'xAI Grok JSON generation failed: Rate limit reached',
    );
  });

  it('stringifies a non-Error retry failure for the log', async () => {
    create
      .mockRejectedValueOnce(new Error('response_format is not supported'))
      .mockRejectedValueOnce('service overloaded');

    await expect(grokProvider().generateJson({ prompt: 'p' })).rejects.toThrow(
      'xAI Grok is temporarily unavailable. Try again shortly, or switch to another AI provider.',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'xAI Grok JSON generation failed: service overloaded',
    );
  });

  it('stringifies a non-Error OpenAI failure for the log', async () => {
    create.mockRejectedValue('service overloaded');

    await expect(buildProvider().generateJson({ prompt: 'p' })).rejects.toThrow(
      'OpenAI ChatGPT is temporarily unavailable. Try again shortly, or switch to another AI provider.',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'OpenAI ChatGPT JSON generation failed: service overloaded',
    );
  });

  it('reports an empty response when both the json_object and plain attempts are empty', async () => {
    create.mockResolvedValue(textCompletion(''));

    await expect(grokProvider().generateJson({ prompt: 'p' })).rejects.toThrow(
      'xAI Grok returned an empty response. Try again, or switch to another AI provider.',
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('rejects with a key error and never calls the SDK when unconfigured', async () => {
    const provider = buildProvider({ apiKey: '' });

    await expect(provider.generateJson({ prompt: 'p' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });
});
