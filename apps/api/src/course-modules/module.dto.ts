// goal: validate module create/update bodies (title required; other fields optional).

import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCourseModuleDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  learningOutcomes?: string;
}

export class UpdateCourseModuleDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  learningOutcomes?: string;
}
