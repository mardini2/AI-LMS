import { Body, Controller, Post } from '@nestjs/common';
import { UpdateFlashcardsDto } from './dto/update-flashcards.dto';
import { FlashcardsUpdateService } from './flashcards-update.service';

@Controller('flashcards')
export class FlashcardsController {
  constructor(private readonly flashcardsUpdate: FlashcardsUpdateService) {}

  /**
   * POST /flashcards/update
   * Persist an edited flashcards deck to the student's private Moodle Page.
   */
  @Post('update')
  update(@Body() dto: UpdateFlashcardsDto) {
    return this.flashcardsUpdate.updateDeck(dto);
  }
}
