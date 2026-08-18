import type { LlmProvider } from './llm-provider.interface';
import type {
  AiProviderId,
  LlmChatRequest,
  LlmChatResult,
  LlmJsonRequest,
} from './provider.types';

/**
 * Deterministic in-process LLM used by Behat / Selenium.
 * Enabled with STUB_LLM=true so acceptance tests never call a paid API.
 *
 * Intentionally not listed in AI_PROVIDER_IDS — the picker still shows the
 * real backends. resolve() short-circuits here when the flag is on.
 */
export const STUB_LLM_REPLY_PREFIX = 'Behat stub:';

export class StubLlmProvider implements LlmProvider {
  readonly id = 'stub' as AiProviderId;
  readonly displayName = 'Behat stub';

  isConfigured(): boolean {
    return true;
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResult> {
    const message = (request.message ?? '').trim() || '(empty)';
    return {
      text: `${STUB_LLM_REPLY_PREFIX} ${message}`,
      toolCalls: [],
    };
  }

  async generateJson(_request: LlmJsonRequest): Promise<string> {
    return JSON.stringify({ topics: [] });
  }
}

export function isStubLlmEnabled(raw: unknown): boolean {
  return raw === true || raw === 'true' || raw === '1';
}
