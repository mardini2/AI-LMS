import {
  IsInt,
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  ValidateNested,
  IsIn,
  Min,
  Max,
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

  /** Teaching style for this turn. Defaults to direct in the service. */
  @IsOptional()
  @IsIn(['direct', 'coach'])
  mode?: 'direct' | 'coach';

  /** Coach guidance level 1 (least) – 5 (most). Ignored unless mode is coach. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  guidance?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HistoryEntryDto)
  history?: HistoryEntryDto[];
}
