import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { LlmProvider } from './llm-provider.interface';
import {
  assertNonEmptyText,
  mapProviderError,
} from './provider.errors';
import type {
  AiProviderId,
  LlmChatRequest,
  LlmChatResult,
  LlmJsonRequest,
  LlmJsonSchema,
  LlmTool,
  LlmToolCall,
} from './provider.types';
import {
  formatHistoryForLog,
  logGreetingDebug,
  shouldLogGreetingDebug,
} from '../greeting-debug';

export interface OpenAiCompatibleConfig {
  id: AiProviderId;
  displayName: string;
  apiKey: string;
  baseURL: string;
  defaultModel: string;
  /** Extra headers some hosts accept (Referer, app title, etc.). */
  defaultHeaders?: Record<string, string>;
}

/**
 * Shared adapter for OpenAI-compatible chat completions APIs
 * (OpenAI, xAI Grok, Mistral).
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id: AiProviderId;
  readonly displayName: string;
  private readonly logger: Logger;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly client: OpenAI | null;

  constructor(config: OpenAiCompatibleConfig) {
    this.id = config.id;
    this.displayName = config.displayName;
    this.apiKey = (config.apiKey ?? '').trim();
    this.model = config.defaultModel;
    this.logger = new Logger(`LlmProvider:${config.id}`);
    this.client =
      this.apiKey.length > 0
        ? new OpenAI({
            apiKey: this.apiKey,
            baseURL: config.baseURL,
            defaultHeaders: config.defaultHeaders,
          })
        : null;
  }

  isConfigured(): boolean {
    return Boolean(this.client);
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResult> {
    const client = this.requireClient();
    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: request.systemInstruction },
        ...request.history.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: request.message },
      ];
      const priorUserTurns = request.history.filter((m) => m.role === 'user').length;
      if (shouldLogGreetingDebug(priorUserTurns)) {
        logGreetingDebug(
          `PROVIDER_PAYLOAD:${this.id}`,
          [
            'system message role=system included as messages[0]: YES',
            `systemInstructionLength: ${request.systemInstruction.length}`,
            `model: ${this.model}`,
            '',
            '----- MESSAGES SENT TO chat.completions.create -----',
            formatHistoryForLog(
              messages.map((m) => ({
                role: String(m.role),
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              })),
            ),
          ].join('\n'),
        );
      }

      const completion = await client.chat.completions.create({
        model: this.model,
        messages,
        tools: request.tools?.length
          ? request.tools.map(toOpenAiTool)
          : undefined,
        tool_choice: request.tools?.length ? 'auto' : undefined,
      });

      const choice = completion.choices[0];
      if (!choice) {
        throw new Error('empty response');
      }

      const toolCalls = parseOpenAiToolCalls(choice.message.tool_calls);
      const text = (choice.message.content ?? '').trim();

      if (!text && toolCalls.length === 0) {
        throw new Error('empty response');
      }

      if (shouldLogGreetingDebug(priorUserTurns)) {
        logGreetingDebug(
          `PROVIDER_RAW:${this.id}`,
          [
            '----- RAW PROVIDER RESPONSE (choice.message.content) -----',
            text || '(empty text)',
          ].join('\n'),
        );
      }

      return { text, toolCalls };
    } catch (err) {
      this.logger.warn(
        `${this.displayName} chat failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw mapProviderError(err, this.displayName);
    }
  }

  async generateJson(request: LlmJsonRequest): Promise<string> {
    const client = this.requireClient();
    try {
      const useSchema =
        request.schema &&
        // Stick to OpenAI's json_schema mode; others get json_object / plain fallback.
        this.id === 'openai';

      const completion = await client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a careful JSON generator. Reply with valid JSON only — no markdown fences.',
          },
          { role: 'user', content: request.prompt },
        ],
        response_format: useSchema
          ? {
              type: 'json_schema',
              json_schema: {
                name: request.schemaName || 'response',
                strict: false,
                schema: toPlainJsonSchema(request.schema!),
              },
            }
          : { type: 'json_object' },
      });

      const text = completion.choices[0]?.message?.content;
      return assertNonEmptyText(text, this.displayName);
    } catch (err) {
      // Some hosts reject json_object — retry once as plain text JSON.
      if (this.id !== 'openai') {
        try {
          return await this.generateJsonPlain(request);
        } catch (retryErr) {
          this.logger.warn(
            `${this.displayName} JSON generation failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
          );
          throw mapProviderError(retryErr, this.displayName);
        }
      }
      this.logger.warn(
        `${this.displayName} JSON generation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw mapProviderError(err, this.displayName);
    }
  }

  private async generateJsonPlain(request: LlmJsonRequest): Promise<string> {
    const client = this.requireClient();
    const completion = await client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'You are a careful JSON generator. Reply with valid JSON only — no markdown fences.',
        },
        { role: 'user', content: request.prompt },
      ],
    });
    return assertNonEmptyText(
      completion.choices[0]?.message?.content,
      this.displayName,
    );
  }

  private requireClient(): OpenAI {
    if (!this.client) {
      throw mapProviderError(new Error('invalid api key'), this.displayName);
    }
    return this.client;
  }
}

function toOpenAiTool(tool: LlmTool): OpenAI.Chat.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toPlainJsonSchema(tool.parameters),
    },
  };
}

function toPlainJsonSchema(
  schema: LlmJsonSchema,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (schema.type) {
    const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    out.type = t === 'integer' ? 'integer' : t;
  }
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.format) out.format = schema.format;
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [
        k,
        toPlainJsonSchema(v),
      ]),
    );
  }
  if (schema.items) out.items = toPlainJsonSchema(schema.items);
  if (schema.required) out.required = schema.required;
  if (schema.additionalProperties !== undefined) {
    out.additionalProperties = schema.additionalProperties;
  }
  return out;
}

function parseOpenAiToolCalls(
  toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] | undefined,
): LlmToolCall[] {
  if (!toolCalls?.length) return [];
  const out: LlmToolCall[] = [];
  for (const call of toolCalls) {
    if (call.type !== 'function') continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || '{}') as Record<
        string,
        unknown
      >;
    } catch {
      args = {};
    }
    out.push({ name: call.function.name, args });
  }
  return out;
}
