import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenAI,
  type CreateChatParameters,
  type GenerateContentParameters,
} from '@google/genai';

@Injectable()
export class GeminiClient {
  readonly ai: GoogleGenAI | null;
  readonly defaultModel: string;

  constructor(config: ConfigService) {
    const apiKey = (config.get<string>('GEMINI_API_KEY') ?? '').trim();
    this.defaultModel =
      config.get<string>('GEMINI_MODEL')?.trim() || 'gemini-3.5-flash-lite';
    // Only construct the SDK when a key is present — missing key just means
    // Gemini is unavailable in the provider list, not a boot failure.
    this.ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  isReady(): boolean {
    return this.ai !== null;
  }

  generateContent(params: Omit<GenerateContentParameters, 'model'> & { model?: string }) {
    if (!this.ai) {
      throw new Error('Gemini API key is not configured');
    }
    return this.ai.models.generateContent({
      ...params,
      model: params.model ?? this.defaultModel,
    });
  }

  createChat(params: Omit<CreateChatParameters, 'model'> & { model?: string }) {
    if (!this.ai) {
      throw new Error('Gemini API key is not configured');
    }
    return this.ai.chats.create({
      ...params,
      model: params.model ?? this.defaultModel,
    });
  }
}
