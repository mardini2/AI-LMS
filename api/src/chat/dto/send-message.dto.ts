import {
  IsInt,
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  ValidateNested,
  IsIn,
  Min,
  Max,
  MinLength,
  ArrayMaxSize,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AI_PROVIDER_IDS } from '../providers/provider.types';
import { CHAT_ATTACHMENT_MAX_FILES } from '../attachments/attachment.constants';

export class HistoryEntryDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  content: string;
}

export class SendMessageDto {
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

  /**
   * Student message text. Optional when attachmentIds are present.
   */
  @ValidateIf((o: SendMessageDto) => !o.attachmentIds?.length)
  @IsString()
  @MinLength(1)
  message: string;

  /** Persistent attachment IDs from POST /chat/attachments. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHAT_ATTACHMENT_MAX_FILES)
  @IsUUID('4', { each: true })
  attachmentIds?: string[];

  @IsOptional()
  @IsUUID()
  conversationId?: string;

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HistoryEntryDto)
  history?: HistoryEntryDto[];
}
