import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenAI,
  type CreateChatParameters,
  type GenerateContentParameters,
} from '@google/genai';

@Injectable()
export class GeminiClient {
  readonly ai: GoogleGenAI;
  readonly defaultModel = 'gemini-3.5-flash-lite';

  constructor(config: ConfigService) {
    this.ai = new GoogleGenAI({
      apiKey: config.get<string>('GEMINI_API_KEY')!,
    });
  }

  generateContent(params: Omit<GenerateContentParameters, 'model'> & { model?: string }) {
    return this.ai.models.generateContent({
      ...params,
      model: params.model ?? this.defaultModel,
    });
  }

  createChat(params: Omit<CreateChatParameters, 'model'> & { model?: string }) {
    return this.ai.chats.create({
      ...params,
      model: params.model ?? this.defaultModel,
    });
  }
}
