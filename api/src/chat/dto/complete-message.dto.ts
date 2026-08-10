import {
  IsInt,
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  IsIn,
  Min,
  Max,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AI_PROVIDER_IDS } from '../providers/provider.types';
import { CHAT_ATTACHMENT_MAX_FILES } from '../attachments/attachment.constants';

/**
 * Finish a persist-first turn: generate + save the assistant reply for a
 * user message already created by POST /chat/message/start.
 */
export class CompleteMessageDto {
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

  @IsUUID()
  conversationId: string;

  @IsUUID()
  userMessageId: string;

  /**
   * Raw student text (same as start). Used for LLM / gratitude / link-fetch.
   * Optional when the turn was attachment-only.
   */
  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHAT_ATTACHMENT_MAX_FILES)
  @IsUUID('4', { each: true })
  attachmentIds?: string[];

  @IsOptional()
  @IsIn([...AI_PROVIDER_IDS])
  provider?: string;

  @IsOptional()
  @IsIn(['direct', 'coach'])
  mode?: 'direct' | 'coach';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  guidance?: number;
}
