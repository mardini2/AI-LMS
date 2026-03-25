// goal: require typing the user's full name before destructive delete.

import { IsString, MinLength } from 'class-validator';

export class DeleteUserDto {
  @IsString()
  @MinLength(1)
  confirmFullName!: string;
}
