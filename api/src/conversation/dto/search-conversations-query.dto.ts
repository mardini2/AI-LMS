import { IsInt, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchConversationsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  courseId: number;

  @IsString()
  @MinLength(1)
  q: string;
}
