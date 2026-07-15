import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}
