import { IsInt, IsISO8601, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetMessagesQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  /** ISO-8601 timestamp — return messages older than this cursor. */
  @IsOptional()
  @IsISO8601()
  before?: string;
}
