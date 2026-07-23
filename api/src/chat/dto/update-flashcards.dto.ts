import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { FLASHCARD_COUNT_EXPLICIT_MAX } from '../flashcards.helpers';
export class FlashcardCardDto {
  @IsString()
  @MaxLength(2000)
  front: string;

  @IsString()
  @MaxLength(8000)
  back: string;
}

export class UpdateFlashcardsDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FLASHCARD_COUNT_EXPLICIT_MAX)
  @ValidateNested({ each: true })
  @Type(() => FlashcardCardDto)
  cards: FlashcardCardDto[];
}
