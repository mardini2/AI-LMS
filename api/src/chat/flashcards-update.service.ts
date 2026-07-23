import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { AiContentMoodleService } from '../context/ai-content-moodle.service';
import { StudyGuideMoodleService } from '../context/study-guide-moodle.service';
import {
  FLASHCARD_COUNT_EXPLICIT_MAX,
  FLASHCARD_COUNT_MIN,
  normalizeFlashcardsDocument,
  renderFlashcardsHtml,
} from './flashcards.helpers';
import { withKindTitlePrefix, stripKindTitlePrefix } from './ai-content-title';
import type { UpdateFlashcardsDto } from './dto/update-flashcards.dto';

@Injectable()
export class FlashcardsUpdateService {
  constructor(
    private readonly studyGuideMoodle: StudyGuideMoodleService,
    private readonly aiContentMoodle: AiContentMoodleService,
  ) {}

  async updateDeck(dto: UpdateFlashcardsDto) {
    const title =
      stripKindTitlePrefix((dto.title ?? '').trim()) || 'Key terms';
    const doc = normalizeFlashcardsDocument(
      { title, cards: dto.cards },
      FLASHCARD_COUNT_EXPLICIT_MAX,
    );

    if (!doc) {
      throw new BadRequestException(
        'Flashcards must include a title and at least one card with front and back text',
      );
    }

    if (doc.cards.length < FLASHCARD_COUNT_MIN) {
      throw new BadRequestException(
        `Flashcards must have at least ${FLASHCARD_COUNT_MIN} cards with both sides filled`,
      );
    }

    if (doc.cards.length > FLASHCARD_COUNT_EXPLICIT_MAX) {
      throw new BadRequestException(
        `Flashcards cannot have more than ${FLASHCARD_COUNT_EXPLICIT_MAX} cards`,
      );
    }

    const contentHtml = renderFlashcardsHtml(doc);
    const activityName = withKindTitlePrefix(title, 'flashcards');

    try {
      const updated = await this.studyGuideMoodle.updatePrivatePage({
        courseId: dto.courseId,
        moodleUserId: dto.moodleUserId,
        cmId: dto.cmId,
        contentHtml,
      });

      if (dto.title?.trim()) {
        try {
          await this.aiContentMoodle.renamePrivateActivity({
            courseId: dto.courseId,
            moodleUserId: dto.moodleUserId,
            cmId: dto.cmId,
            name: activityName,
          });
        } catch {
          // Content update succeeded; name sync is best-effort.
        }
      }

      return {
        ...updated,
        cardCount: doc.cards.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpException(message, HttpStatus.BAD_GATEWAY);
    }
  }
}
