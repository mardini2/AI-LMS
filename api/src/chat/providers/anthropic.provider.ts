import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
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

@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly id: AiProviderId = 'anthropic';
  readonly displayName = 'Anthropic Claude';
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly client: Anthropic | null;

  constructor(config: ConfigService) {
    this.apiKey = (config.get<string>('ANTHROPIC_API_KEY') ?? '').trim();
    this.model =
      config.get<string>('ANTHROPIC_MODEL')?.trim() ||
      'claude-sonnet-4-20250514';
    this.client =
      this.apiKey.length > 0
        ? new Anthropic({ apiKey: this.apiKey })
        : null;
  }

  isConfigured(): boolean {
    return Boolean(this.client);
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResult> {
    const client = this.requireClient();
    try {
      const messages: Anthropic.MessageParam[] = [
        ...request.history.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: request.message },
      ];

      // Anthropic wants alternating roles; merge consecutive same-role turns.
      const normalized = normalizeAnthropicMessages(messages);

      const response = await client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: request.systemInstruction,
        messages: normalized,
        tools: request.tools?.length
          ? request.tools.map(toAnthropicTool)
          : undefined,
      });

      const toolCalls: LlmToolCall[] = [];
      const textParts: string[] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            name: block.name,
            args: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }

      const text = textParts.join('\n').trim();
      if (!text && toolCalls.length === 0) {
        throw new Error('empty response');
      }

      return { text, toolCalls };
    } catch (err) {
      this.logger.warn(
        `Anthropic chat failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw mapProviderError(err, this.displayName);
    }
  }

  async generateJson(request: LlmJsonRequest): Promise<string> {
    const client = this.requireClient();
    try {
      const schemaHint = request.schema
        ? `\nReturn JSON matching this schema:\n${JSON.stringify(toPlainJsonSchema(request.schema))}`
        : '';

      const response = await client.messages.create({
        model: this.model,
        max_tokens: 8192,
        system:
          'You are a careful JSON generator. Reply with valid JSON only — no markdown fences.' +
          schemaHint,
        messages: [{ role: 'user', content: request.prompt }],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      return assertNonEmptyText(stripJsonFences(text), this.displayName);
    } catch (err) {
      this.logger.warn(
        `Anthropic JSON generation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw mapProviderError(err, this.displayName);
    }
  }

  private requireClient(): Anthropic {
    if (!this.client) {
      throw mapProviderError(new Error('invalid api key'), this.displayName);
    }
    return this.client;
  }
}

function toAnthropicTool(tool: LlmTool): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: toPlainJsonSchema(tool.parameters) as Anthropic.Tool.InputSchema,
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
  return out;
}

function normalizeAnthropicMessages(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const msg of messages) {
    const last = out[out.length - 1];
    if (last && last.role === msg.role && typeof last.content === 'string' && typeof msg.content === 'string') {
      last.content = `${last.content}\n${msg.content}`;
      continue;
    }
    out.push({ role: msg.role, content: msg.content });
  }
  // Anthropic requires the first message to be from the user.
  while (out.length && out[0].role !== 'user') {
    out.shift();
  }
  return out;
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}
