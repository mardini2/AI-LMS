import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

type GetGenerativeModelParams = Parameters<
  GoogleGenerativeAI['getGenerativeModel']
>[0];

@Injectable()
export class GeminiClient {
  private readonly genAI: GoogleGenerativeAI;
  readonly defaultModel = 'gemini-3.5-flash-lite';

  constructor(config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(config.get<string>('GEMINI_API_KEY')!);
  }

  getGenerativeModel(
    params: Omit<GetGenerativeModelParams, 'model'> & { model?: string },
  ) {
    return this.genAI.getGenerativeModel({
      ...params,
      model: params.model ?? this.defaultModel,
    });
  }
}
