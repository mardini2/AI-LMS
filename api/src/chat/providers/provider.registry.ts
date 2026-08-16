import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmProvider } from './llm-provider.interface';
import { GeminiProvider } from './gemini.provider';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';
import {
  AI_PROVIDER_IDS,
  isAiProviderId,
  type AiProviderId,
  type AiProviderInfo,
} from './provider.types';

/**
 * Central place to resolve which LLM backends are available.
 * New providers: implement LlmProvider, construct here, done.
 */
@Injectable()
export class AiProviderRegistry {
  private readonly providers: Map<AiProviderId, LlmProvider>;
  /** Prefer Gemini when present so existing installs keep the same default. */
  private readonly preferredOrder: AiProviderId[] = [
    'gemini',
    'openai',
    'anthropic',
    'xai',
    'mistral',
  ];

  constructor(
    config: ConfigService,
    gemini: GeminiProvider,
    anthropic: AnthropicProvider,
  ) {
    const openai = new OpenAiCompatibleProvider({
      id: 'openai',
      displayName: 'OpenAI ChatGPT',
      apiKey: config.get<string>('OPENAI_API_KEY') ?? '',
      baseURL: 'https://api.openai.com/v1',
      defaultModel:
        config.get<string>('OPENAI_MODEL')?.trim() || 'gpt-4o-mini',
    });

    const xai = new OpenAiCompatibleProvider({
      id: 'xai',
      displayName: 'xAI Grok',
      apiKey: config.get<string>('XAI_API_KEY') ?? '',
      baseURL: 'https://api.x.ai/v1',
      defaultModel: config.get<string>('XAI_MODEL')?.trim() || 'grok-3-mini',
    });

    // Mistral's API is OpenAI-compatible, so it reuses the same adapter.
    const mistral = new OpenAiCompatibleProvider({
      id: 'mistral',
      displayName: 'Mistral',
      apiKey: config.get<string>('MISTRAL_API_KEY') ?? '',
      baseURL: 'https://api.mistral.ai/v1',
      defaultModel:
        config.get<string>('MISTRAL_MODEL')?.trim() || 'mistral-small-latest',
    });

    this.providers = new Map<AiProviderId, LlmProvider>([
      ['openai', openai],
      ['gemini', gemini],
      ['anthropic', anthropic],
      ['xai', xai],
      ['mistral', mistral],
    ]);
  }

  /** Public listing for the chatbox — never includes secrets. */
  listProviders(): AiProviderInfo[] {
    return AI_PROVIDER_IDS.map((id) => {
      const provider = this.providers.get(id)!;
      return {
        id,
        displayName: provider.displayName,
        available: provider.isConfigured(),
      };
    });
  }

  getDefaultProviderId(): AiProviderId | null {
    for (const id of this.preferredOrder) {
      const provider = this.providers.get(id);
      if (provider?.isConfigured()) {
        return id;
      }
    }
    return null;
  }

  /**
   * Resolve the provider for a request.
   * Empty/undefined providerId → default available provider.
   */
  resolve(providerId?: string | null): LlmProvider {
    const requested = (providerId ?? '').trim();

    if (requested) {
      if (!isAiProviderId(requested)) {
        throw new BadRequestException(
          'Unknown AI provider. Choose one of the listed providers.',
        );
      }
      const provider = this.providers.get(requested)!;
      if (!provider.isConfigured()) {
        throw new BadRequestException(
          'This AI provider is currently unavailable because no API key has been configured.',
        );
      }
      return provider;
    }

    const defaultId = this.getDefaultProviderId();
    if (!defaultId) {
      throw new BadRequestException(
        'No AI providers are available. Ask your administrator to configure at least one API key.',
      );
    }
    return this.providers.get(defaultId)!;
  }

  get(providerId: AiProviderId): LlmProvider | undefined {
    return this.providers.get(providerId);
  }
}
