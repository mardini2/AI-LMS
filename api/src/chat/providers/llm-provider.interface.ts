import type { AiProviderId, AiProviderInfo } from './provider.types';
import type { LlmChatRequest, LlmChatResult, LlmJsonRequest } from './provider.types';

/**
 * Contract every AI backend must implement.
 * Add a new provider by writing a class that matches this and registering it.
 */
export interface LlmProvider {
  readonly id: AiProviderId;
  readonly displayName: string;

  /** True when a non-empty API key is configured for this provider. */
  isConfigured(): boolean;

  /** Conversational turn (optional tool/function calls for study tools). */
  chat(request: LlmChatRequest): Promise<LlmChatResult>;

  /** One-shot JSON generation used by study guides, quizzes, flashcards, etc. */
  generateJson(request: LlmJsonRequest): Promise<string>;
}

export type { AiProviderInfo };
