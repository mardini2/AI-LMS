// goal: validate PATCH body when a human approves or rejects an AI review.

import { HumanDecisionType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ReviewDecisionDto {
  @IsEnum(HumanDecisionType)
  decision!: HumanDecisionType;

  @IsOptional()
  @IsString()
  notes?: string;
}
