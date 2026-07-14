import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListConversationsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  courseId: number;
}
