// goal: validate bodies for creating/editing content items, submissions, and grades.

import { ContentStatus, ContentType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateContentItemDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title!: string;

  @IsEnum(ContentType)
  contentType!: ContentType;

  @IsString()
  @MinLength(10)
  body!: string;

  @IsOptional()
  @IsString()
  rubricText?: string;

  @IsOptional()
  @IsString()
  dueAt?: string;
}

export class UpdateContentItemDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsEnum(ContentType)
  contentType?: ContentType;

  @IsOptional()
  @IsString()
  @MinLength(10)
  body?: string;

  @IsOptional()
  @IsString()
  rubricText?: string;

  @IsOptional()
  @IsString()
  dueAt?: string;

  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus;
}

export class StudentSubmissionDto {
  @IsString()
  @MinLength(5)
  answerText!: string;
}

export class GradeSubmissionDto {
  @IsOptional()
  @IsInt()
  score?: number;

  @IsOptional()
  @IsString()
  feedback?: string;
}
