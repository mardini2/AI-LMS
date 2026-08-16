import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class EnsurePlacementDto {
  @Type(() => Number)
  @IsInt()
  @Min(2)
  courseId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  moodleUserId: number;
}
