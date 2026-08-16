import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  AZURE_TTS_MAX_CHARS,
  AZURE_TTS_SUPPORTED_LANGS,
} from '../speech.constants';

export class SynthesizeSpeechDto {
  @IsString()
  @MinLength(1)
  @MaxLength(AZURE_TTS_MAX_CHARS)
  text: string;

  /** Same labels the chat UI already uses for Grace / Ben. */
  @IsOptional()
  @IsIn(['grace', 'ben'])
  voice?: 'grace' | 'ben';

  /** BCP-47 locale from per-message detection (or mic fallback). */
  @IsOptional()
  @IsString()
  @IsIn([...AZURE_TTS_SUPPORTED_LANGS])
  lang?: (typeof AZURE_TTS_SUPPORTED_LANGS)[number];
}
