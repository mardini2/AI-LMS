import { BadRequestException } from '@nestjs/common';
import { AiProviderRegistry } from '../../../../src/chat/providers/provider.registry';
import type { LlmProvider } from '../../../../src/chat/providers/llm-provider.interface';
import type { AiProviderId } from '../../../../src/chat/providers/provider.types';
import { mapProviderError, assertNonEmptyText } from '../../../../src/chat/providers/provider.errors';
import { isAiProviderId, AI_PROVIDER_IDS } from '../../../../src/chat/providers/provider.types';

function makeProvider(
  id: AiProviderId,
  displayName: string,
  configured: boolean,
): LlmProvider {
  return {
    id,
    displayName,
    isConfigured: () => configured,
    chat: jest.fn(async () => ({ text: `hello from ${id}`, toolCalls: [] })),
    generateJson: jest.fn(async () => JSON.stringify({ ok: true, provider: id })),
  };
}

function buildRegistry(
  flags: Partial<Record<AiProviderId, boolean>> & { stubLlm?: boolean },
) {
  const gemini = makeProvider('gemini', 'Google Gemini', flags.gemini !== false);
  const anthropic = makeProvider(
    'anthropic',
    'Anthropic Claude',
    !!flags.anthropic,
  );

  // Bypass Nest DI — construct with stubs matching the registry constructor.
  const config = {
    get: (key: string) => {
      const map: Record<string, string> = {
        OPENAI_API_KEY: flags.openai ? 'sk-test' : '',
        XAI_API_KEY: flags.xai ? 'xai-test' : '',
        MISTRAL_API_KEY: flags.mistral ? 'mistral-test' : '',
        CORS_ORIGIN: 'http://localhost:8000',
        STUB_LLM: flags.stubLlm ? 'true' : '',
      };
      return map[key] ?? '';
    },
  };

  return new AiProviderRegistry(config as never, gemini as never, anthropic as never);
}

describe('AiProviderRegistry', () => {
  it('lists every known provider and marks availability from keys', () => {
    const registry = buildRegistry({
      gemini: true,
      openai: false,
      anthropic: true,
      xai: false,
      mistral: false,
    });

    const list = registry.listProviders();
    expect(list.map((p) => p.id)).toEqual([...AI_PROVIDER_IDS]);
    expect(list.find((p) => p.id === 'gemini')?.available).toBe(true);
    expect(list.find((p) => p.id === 'openai')?.available).toBe(false);
    expect(list.find((p) => p.id === 'anthropic')?.available).toBe(true);
    // Response must never include key material
    expect(JSON.stringify(list)).not.toMatch(/sk-|mistral-test|api[_-]?key/i);
  });

  it('defaults to gemini when it is configured', () => {
    const registry = buildRegistry({ gemini: true, openai: true });
    expect(registry.getDefaultProviderId()).toBe('gemini');
    expect(registry.resolve().id).toBe('gemini');
  });

  it('falls back to the next available provider when gemini is missing', () => {
    const registry = buildRegistry({
      gemini: false,
      openai: true,
      anthropic: false,
    });
    expect(registry.getDefaultProviderId()).toBe('openai');
    expect(registry.resolve().id).toBe('openai');
  });

  it('resolves an explicit provider for mid-conversation switching', () => {
    const registry = buildRegistry({ gemini: true, openai: true });
    expect(registry.resolve('openai').id).toBe('openai');
    expect(registry.resolve('gemini').id).toBe('gemini');
  });

  it('rejects switching to a provider with no API key', () => {
    const registry = buildRegistry({ gemini: true, openai: false });
    expect(() => registry.resolve('openai')).toThrow(BadRequestException);
    expect(() => registry.resolve('openai')).toThrow(
      /no API key has been configured/i,
    );
  });

  it('rejects unknown provider ids', () => {
    const registry = buildRegistry({ gemini: true });
    expect(() => registry.resolve('not-a-provider')).toThrow(BadRequestException);
  });

  it('rejects requests when no providers are configured', () => {
    const registry = buildRegistry({
      gemini: false,
      openai: false,
      anthropic: false,
      xai: false,
      mistral: false,
    });
    expect(registry.getDefaultProviderId()).toBeNull();
    expect(() => registry.resolve()).toThrow(/No AI providers are available/i);
  });

  it('routes every resolve through the in-process stub when STUB_LLM is set', async () => {
    const registry = buildRegistry({
      gemini: true,
      openai: true,
      stubLlm: true,
    });

    // Picker still lists the real backends — stub is not a student-facing option.
    expect(registry.listProviders().map((p) => p.id)).toEqual([...AI_PROVIDER_IDS]);
    expect(registry.listProviders().find((p) => p.id === 'gemini')?.available).toBe(
      true,
    );

    const fromDefault = registry.resolve();
    const fromPicker = registry.resolve('gemini');
    expect(fromDefault.displayName).toBe('Behat stub');
    expect(fromPicker.displayName).toBe('Behat stub');

    const result = await fromDefault.chat({
      systemInstruction: 'Stay on course.',
      history: [],
      message: 'What is a page fault?',
    });
    expect(result.text).toBe('Behat stub: What is a page fault?');
    expect(result.toolCalls).toEqual([]);
  });

  it('reports stub mode only when STUB_LLM is set', () => {
    expect(buildRegistry({ gemini: true }).isStubMode()).toBe(false);
    expect(buildRegistry({ gemini: true, stubLlm: true }).isStubMode()).toBe(true);
  });
});

describe('provider id helpers', () => {
  it('accepts only known provider ids', () => {
    expect(isAiProviderId('gemini')).toBe(true);
    expect(isAiProviderId('openai')).toBe(true);
    expect(isAiProviderId('')).toBe(false);
    expect(isAiProviderId('chatgpt')).toBe(false);
  });
});

describe('mapProviderError', () => {
  it('maps invalid key failures to a safe student message', () => {
    const err = Object.assign(new Error('Incorrect API key provided'), {
      status: 401,
    });
    const mapped = mapProviderError(err, 'OpenAI ChatGPT');
    expect(mapped.getStatus()).toBe(400);
    expect(mapped.message).toMatch(/API key/i);
    expect(mapped.message).not.toMatch(/Incorrect API key provided/);
  });

  it('maps rate limits without leaking upstream details', () => {
    const err = Object.assign(new Error('Rate limit exceeded: sk-secret'), {
      status: 429,
    });
    const mapped = mapProviderError(err, 'xAI Grok');
    expect(mapped.getStatus()).toBe(503);
    expect(mapped.message).toMatch(/rate-limited/i);
    expect(mapped.message).not.toMatch(/sk-secret/);
  });

  it('maps timeouts clearly', () => {
    const err = Object.assign(new Error('Request timed out'), { status: 504 });
    const mapped = mapProviderError(err, 'Google Gemini');
    expect(mapped.getStatus()).toBe(504);
    expect(mapped.message).toMatch(/too long/i);
  });
});

describe('assertNonEmptyText', () => {
  it('rejects empty provider responses', () => {
    expect(() => assertNonEmptyText('   ', 'OpenAI ChatGPT')).toThrow(
      /empty response/i,
    );
  });

  it('returns trimmed text when present', () => {
    expect(assertNonEmptyText('  hi  ', 'OpenAI ChatGPT')).toBe('hi');
  });
});

describe('chat turn provider selection', () => {
  it('uses the requested provider for the next message while keeping history intact', async () => {
    const registry = buildRegistry({ gemini: true, anthropic: true });
    const history = [
      { role: 'user' as const, content: 'What is a rootkit?' },
      { role: 'assistant' as const, content: 'A rootkit is…' },
    ];

    const gemini = registry.resolve('gemini');
    const anthropic = registry.resolve('anthropic');

    const first = await gemini.chat({
      systemInstruction: 'Stay on course.',
      history,
      message: 'Explain further',
    });
    const second = await anthropic.chat({
      systemInstruction: 'Stay on course.',
      history: [
        ...history,
        { role: 'user', content: 'Explain further' },
        { role: 'assistant', content: first.text },
      ],
      message: 'Give an example',
    });

    expect(first.text).toContain('gemini');
    expect(second.text).toContain('anthropic');
    expect(anthropic.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        history: expect.arrayContaining([
          expect.objectContaining({ content: 'What is a rootkit?' }),
        ]),
      }),
    );
  });
});

describe('study-tool generation through providers', () => {
  it('generateJson is routed through the selected provider', async () => {
    const registry = buildRegistry({ gemini: true, anthropic: true });
    const llm = registry.resolve('anthropic');
    const raw = await llm.generateJson({
      prompt: 'Make flashcards JSON',
      schemaName: 'flashcards',
    });
    const parsed = JSON.parse(raw) as { provider?: string };
    expect(parsed.provider).toBe('anthropic');
    expect(llm.generateJson).toHaveBeenCalled();
  });
});
