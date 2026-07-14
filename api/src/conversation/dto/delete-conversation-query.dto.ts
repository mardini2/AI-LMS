import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class DeleteConversationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;
}
