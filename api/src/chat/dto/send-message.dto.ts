import {
  IsInt,
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  ValidateNested,
  IsIn,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AI_PROVIDER_IDS } from '../providers/provider.types';

export class HistoryEntryDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  content: string;
}

export class SendMessageDto {
  @IsInt()
  @Min(0)
  courseId: number;

  @IsOptional()
  @IsString()
  courseName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  moodleUserId?: number;

  @IsOptional()
  @IsString()
  userFirstName?: string;

  @IsString()
  @MinLength(1)
  message: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;

  /** Which AI backend should answer this turn (openai, gemini, …). */
  @IsOptional()
  @IsIn([...AI_PROVIDER_IDS])
  provider?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HistoryEntryDto)
  history?: HistoryEntryDto[];
}
