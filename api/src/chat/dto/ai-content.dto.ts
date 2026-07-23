import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
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

  /** Bare title without kind prefix (e.g. "Week 3 - 4"). */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsIn(['study_guide', 'flashcards', 'practice_quiz'])
  kind: 'study_guide' | 'flashcards' | 'practice_quiz';
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

export class DeleteManyAiContentDto {
  @Type(() => Number)
  @IsInt()
  @Min(2)
  courseId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  cmIds: number[];
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
