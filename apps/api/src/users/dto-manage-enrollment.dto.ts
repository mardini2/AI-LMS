// goal: carry the course id for add/remove enrollment actions.

import { IsNotEmpty, IsString } from 'class-validator';

export class ManageEnrollmentDto {
  @IsString()
  @IsNotEmpty()
  courseId!: string;
}
