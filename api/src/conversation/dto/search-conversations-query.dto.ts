import { IsInt, IsString, Min, MinLength } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class SearchConversationsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  courseId: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  q: string;
}
