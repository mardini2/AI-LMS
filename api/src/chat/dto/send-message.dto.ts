import {
  IsInt,
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  ValidateNested,
  IsIn,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

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

  @IsString()
  @MinLength(1)
  message: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HistoryEntryDto)
  history?: HistoryEntryDto[];
}
