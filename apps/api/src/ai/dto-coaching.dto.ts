// goal: validate coaching chat and student guidance POST bodies.

import { IsString, MinLength } from 'class-validator';
import { IsOptional } from 'class-validator';

export class CoachingQuestionDto {
  @IsString()
  @MinLength(3)
  question!: string;

  @IsOptional()
  @IsString()
  studentDraft?: string;
}

export class StudentGuidanceDto {
  @IsString()
  @MinLength(3)
  question!: string;
}
