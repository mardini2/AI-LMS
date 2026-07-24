import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FunctionCallingConfigMode,
  HarmBlockThreshold,
  HarmCategory,
  Type,
  type FunctionDeclaration,
  type Schema,
  type Tool,
} from '@google/genai';
import { GeminiClient } from '../gemini.client';
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
export class GeminiProvider implements LlmProvider {
  readonly id: AiProviderId = 'gemini';
  readonly displayName = 'Google Gemini';
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly apiKey: string;

  constructor(
    private readonly gemini: GeminiClient,
    config: ConfigService,
  ) {
    this.apiKey = (config.get<string>('GEMINI_API_KEY') ?? '').trim();
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0 && this.gemini.isReady();
  }

  async chat(request: LlmChatRequest): Promise<LlmChatResult> {
    this.assertReady();
    try {
      const tools = request.tools?.length
        ? ([
            {
              functionDeclarations: request.tools.map(toGeminiFunctionDeclaration),
            },
          ] as Tool[])
        : undefined;

      const chat = this.gemini.createChat({
        history: toGeminiHistory(request.history),
        config: {
          systemInstruction: request.systemInstruction,
          tools,
          toolConfig: tools
            ? {
                functionCallingConfig: {
                  mode: FunctionCallingConfigMode.AUTO,
                },
              }
            : undefined,
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
          ],
        },
      });

      const result = await chat.sendMessage({ message: request.message });
      const toolCalls: LlmToolCall[] = (result.functionCalls ?? [])
        .filter((call) => typeof call.name === 'string' && call.name.length > 0)
        .map((call) => ({
          name: call.name as string,
          args: (call.args ?? {}) as Record<string, unknown>,
        }));

      return {
        text: (result.text ?? '').trim(),
        toolCalls,
      };
    } catch (err) {
      this.logger.warn(`Gemini chat failed: ${err instanceof Error ? err.message : String(err)}`);
      throw mapProviderError(err, this.displayName);
    }
  }

  async generateJson(request: LlmJsonRequest): Promise<string> {
    this.assertReady();
    try {
      const response = await this.gemini.generateContent({
        contents: request.prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: request.schema
            ? toGeminiSchema(request.schema)
            : undefined,
        },
      });
      return assertNonEmptyText(response.text, this.displayName);
    } catch (err) {
      this.logger.warn(
        `Gemini JSON generation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw mapProviderError(err, this.displayName);
    }
  }

  private assertReady(): void {
    if (!this.isConfigured()) {
      throw mapProviderError(
        new Error('missing api key'),
        this.displayName,
      );
    }
  }
}

function toGeminiHistory(
  history: LlmChatRequest['history'],
): Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> {
  const geminiHistory: Array<{
    role: 'user' | 'model';
    parts: [{ text: string }];
  }> = [];

  for (const m of history) {
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';

    if (geminiHistory.length === 0 && role === 'model') {
      continue;
    }

    const last = geminiHistory[geminiHistory.length - 1];
    if (last?.role === role) {
      last.parts[0].text += `\n${m.content}`;
      continue;
    }

    geminiHistory.push({ role, parts: [{ text: m.content }] });
  }

  return geminiHistory;
}

function toGeminiFunctionDeclaration(tool: LlmTool): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.parameters) as Schema,
  };
}

function toGeminiSchema(schema: LlmJsonSchema): Schema {
  const out: Schema = {};
  const type = normalizeGeminiType(schema.type);
  if (type) {
    out.type = type;
  }
  if (schema.description) {
    out.description = schema.description;
  }
  if (schema.enum) {
    out.enum = schema.enum.map(String);
  }
  if (schema.format) {
    out.format = schema.format;
  }
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        toGeminiSchema(value),
      ]),
    );
  }
  if (schema.items) {
    out.items = toGeminiSchema(schema.items);
  }
  if (schema.required) {
    out.required = schema.required;
  }
  return out;
}

function normalizeGeminiType(
  type: string | string[] | undefined,
): Type | undefined {
  const raw = Array.isArray(type) ? type[0] : type;
  if (!raw) return undefined;
  switch (raw.toLowerCase()) {
    case 'object':
      return Type.OBJECT;
    case 'array':
      return Type.ARRAY;
    case 'string':
      return Type.STRING;
    case 'number':
      return Type.NUMBER;
    case 'integer':
      return Type.INTEGER;
    case 'boolean':
      return Type.BOOLEAN;
    default:
      return undefined;
  }
}
