import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ConversationType } from '../entities/conversation.entity';

export class OpenConversationDto {
  @IsInt()
  @Min(0)
  courseId: number;

  @IsInt()
  @Min(1)
  moodleUserId: number;

  @IsOptional()
  @IsIn(['general', 'section'])
  type?: Extract<ConversationType, 'general' | 'section'>;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sectionId?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sectionNumber?: number;

  @IsOptional()
  @IsString()
  sectionName?: string;
}
