import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AZURE_TTS_MAX_CHARS } from '../speech.constants';

export class SynthesizeSpeechDto {
  @IsString()
  @MinLength(1)
  @MaxLength(AZURE_TTS_MAX_CHARS)
  text: string;

  /** Same labels the chat UI already uses for Grace / Ben. */
  @IsOptional()
  @IsIn(['grace', 'ben'])
  voice?: 'grace' | 'ben';
}
