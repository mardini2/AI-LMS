/**
 * Shared shapes for every LLM backend. Keep these provider-agnostic so we can
 * swap OpenAI / Gemini / Claude / etc. without rewriting chat.service.
 */

export const AI_PROVIDER_IDS = [
  'openai',
  'gemini',
  'anthropic',
  'xai',
  'mistral',
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export function isAiProviderId(value: unknown): value is AiProviderId {
  return (
    typeof value === 'string' &&
    (AI_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

/** Safe info sent to the browser — never includes API keys. */
export interface AiProviderInfo {
  id: AiProviderId;
  displayName: string;
  available: boolean;
}

export interface LlmChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, LlmJsonSchema>;
    required?: string[];
  };
}

/** Minimal JSON Schema subset used for tools + structured generation. */
export interface LlmJsonSchema {
  type?: string | string[];
  description?: string;
  enum?: Array<string | number | boolean>;
  format?: string;
  properties?: Record<string, LlmJsonSchema>;
  items?: LlmJsonSchema;
  required?: string[];
  additionalProperties?: boolean;
}

export interface LlmToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface LlmChatRequest {
  systemInstruction: string;
  history: LlmChatMessage[];
  message: string;
  tools?: LlmTool[];
}

export interface LlmChatResult {
  text: string;
  toolCalls: LlmToolCall[];
}

export interface LlmJsonRequest {
  prompt: string;
  /** When set, providers that support it will constrain output to this schema. */
  schema?: LlmJsonSchema;
  schemaName?: string;
}
