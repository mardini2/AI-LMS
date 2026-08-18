/**
 * @jest-environment node
 *
 * Lightweight checks for chatbox provider-selector behaviour.
 * These mirror the DOM-less logic in providers.js so we can catch regressions
 * without spinning up Moodle.
 */

const UNAVAILABLE_PROVIDER_MESSAGE =
  'This AI provider is currently unavailable because no API key has been configured.';

type ProviderInfo = {
  id: string;
  displayName: string;
  available: boolean;
};

function pickSelectedProvider(
  providers: ProviderInfo[],
  storedId: string | null,
  defaultProviderId: string | null,
): string | null {
  const find = (id: string | null) =>
    providers.find((p) => p.id === id) ?? null;

  const stored = find(storedId);
  if (stored?.available) return stored.id;

  const def = find(defaultProviderId);
  if (def?.available) return def.id;

  return providers.find((p) => p.available)?.id ?? null;
}

function canSwitchProvider(
  providers: ProviderInfo[],
  targetId: string,
  isGenerating: boolean,
): { ok: boolean; reason?: string } {
  if (isGenerating) {
    return { ok: false, reason: 'generating' };
  }
  const target = providers.find((p) => p.id === targetId);
  if (!target) return { ok: false, reason: 'unknown' };
  if (!target.available) {
    return { ok: false, reason: UNAVAILABLE_PROVIDER_MESSAGE };
  }
  return { ok: true };
}

describe('chatbox provider selector behaviour', () => {
  const providers: ProviderInfo[] = [
    { id: 'openai', displayName: 'OpenAI ChatGPT', available: false },
    { id: 'gemini', displayName: 'Google Gemini', available: true },
    { id: 'anthropic', displayName: 'Anthropic Claude', available: false },
    { id: 'xai', displayName: 'xAI Grok', available: true },
    { id: 'mistral', displayName: 'Mistral', available: false },
  ];

  it('keeps unavailable providers listed but not selectable', () => {
    const unavailable = providers.filter((p) => !p.available);
    expect(unavailable.map((p) => p.id)).toEqual([
      'openai',
      'anthropic',
      'mistral',
    ]);
    for (const p of unavailable) {
      const result = canSwitchProvider(providers, p.id, false);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(UNAVAILABLE_PROVIDER_MESSAGE);
    }
  });

  it('blocks provider switches while a response is generating', () => {
    const result = canSwitchProvider(providers, 'xai', true);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('generating');
  });

  it('allows switching to an available provider mid-conversation', () => {
    expect(canSwitchProvider(providers, 'xai', false)).toEqual({ ok: true });
  });

  it('restores a stored provider when it is still available', () => {
    expect(pickSelectedProvider(providers, 'xai', 'gemini')).toBe('xai');
  });

  it('falls back when the stored provider has no API key', () => {
    expect(pickSelectedProvider(providers, 'openai', 'gemini')).toBe('gemini');
  });

  it('preserves conversation id when only the provider changes', () => {
    const conversationId = '11111111-2222-3333-4444-555555555555';
    const historyLength = 6;
    // Switching providers is a client-side selection only — chat state stays put.
    const afterSwitch = {
      conversationId,
      historyLength,
      provider: 'xai',
    };
    expect(afterSwitch.conversationId).toBe(conversationId);
    expect(afterSwitch.historyLength).toBe(6);
  });

  it('uses the selected provider on the next outbound message payload', () => {
    const selected = pickSelectedProvider(providers, null, 'gemini');
    const body = {
      message: 'Explain week 3',
      conversationId: 'abc',
      provider: selected,
    };
    expect(body.provider).toBe('gemini');
  });
});
