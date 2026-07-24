import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QUIZ_DIFFICULTIES } from '../practice-quiz.helpers';
import { AI_PROVIDER_IDS } from '../providers/provider.types';

export class ConfirmActionDto {
  @IsUUID()
  actionId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count?: number;

  @IsOptional()
  @IsString()
  @IsIn([...QUIZ_DIFFICULTIES])
  difficulty?: string;

  @IsOptional()
  @IsIn([...AI_PROVIDER_IDS])
  provider?: string;
}

export class CancelActionDto {
  @IsUUID()
  actionId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;
}

export class ExplainReviewDto {
  @IsUUID()
  conversationId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;

  @IsOptional()
  @IsIn([...AI_PROVIDER_IDS])
  provider?: string;
}
