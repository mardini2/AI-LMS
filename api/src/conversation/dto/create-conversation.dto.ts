import { IsInt, IsOptional, Min } from 'class-validator';

export class CreateConversationDto {
  @IsInt()
  @Min(0)
  courseId: number;

  @IsOptional()
  @IsInt()
  moodleUserId?: number;
}
