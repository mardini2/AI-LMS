import { IsInt, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ConfirmActionDto {
  @IsUUID()
  actionId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;
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
}
