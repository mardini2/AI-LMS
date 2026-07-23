import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AiContentCourseUserQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2)
  courseId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;
}

export class RenameAiContentDto {
  @Type(() => Number)
  @IsInt()
  @Min(2)
  courseId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  cmId: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;
}

export class DeleteAiContentDto {
  @Type(() => Number)
  @IsInt()
  @Min(2)
  courseId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  cmId: number;
}

export class UpdateAiContentPageDto {
  @Type(() => Number)
  @IsInt()
  @Min(2)
  courseId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  cmId: number;

  @IsString()
  @MinLength(1)
  contentHtml: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}
