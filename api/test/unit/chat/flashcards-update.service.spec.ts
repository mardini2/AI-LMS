import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FlashcardsUpdateService } from '../../../src/chat/flashcards-update.service';
import type { UpdateFlashcardsDto } from '../../../src/chat/dto/update-flashcards.dto';

interface UpdatePageInput {
  courseId: number;
  moodleUserId: number;
  cmId: number;
  contentHtml: string;
  name?: string;
}

interface RenameInput {
  courseId: number;
  moodleUserId: number;
  cmId: number;
  name: string;
}

const UPDATED_PAGE = {
  cmid: 42,
  pageid: 7,
  name: 'Flashcards: Old name',
  viewurl: 'https://moodle.test/mod/page/view.php?id=42',
};

function buildService(overrides: {
  updatePrivatePage?: (input: UpdatePageInput) => Promise<unknown>;
  renamePrivateActivity?: (input: RenameInput) => Promise<unknown>;
} = {}) {
  const studyGuideMoodle = {
    updatePrivatePage: jest.fn(
      overrides.updatePrivatePage ??
        ((_input: UpdatePageInput) => Promise.resolve(UPDATED_PAGE)),
    ),
  };
  const aiContentMoodle = {
    renamePrivateActivity: jest.fn(
      overrides.renamePrivateActivity ??
        ((input: RenameInput) =>
          Promise.resolve({ cmid: input.cmId, name: input.name })),
    ),
  };

  const service = new FlashcardsUpdateService(
    studyGuideMoodle as never,
    aiContentMoodle as never,
  );

  return { service, studyGuideMoodle, aiContentMoodle };
}

function cards(count: number, prefix = 'Q') {
  return Array.from({ length: count }, (_, i) => ({
    front: `${prefix}${i}`,
    back: `A${i}`,
  }));
}

function dto(overrides: Partial<UpdateFlashcardsDto> = {}): UpdateFlashcardsDto {
  return {
    courseId: 5,
    moodleUserId: 11,
    cmId: 42,
    title: 'Memory terms',
    cards: cards(8),
    ...overrides,
  } as UpdateFlashcardsDto;
}

describe('FlashcardsUpdateService.updateDeck', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  describe('persisting an edited deck', () => {
    it('writes the re-rendered deck to the same page and returns the card count', async () => {
      const { service, studyGuideMoodle } = buildService();

      const result = await service.updateDeck(dto());

      expect(studyGuideMoodle.updatePrivatePage).toHaveBeenCalledTimes(1);
      const payload = studyGuideMoodle.updatePrivatePage.mock
        .calls[0][0] as UpdatePageInput;
      expect(payload.courseId).toBe(5);
      expect(payload.moodleUserId).toBe(11);
      expect(payload.cmId).toBe(42);
      expect(payload.contentHtml).toContain(
        '<div class="syll-fc" data-syll-fc-study="1">',
      );
      expect(payload.contentHtml).toContain('Card: 1 / 8');
      expect(payload.contentHtml).toContain(
        '<span class="syll-fc-prompt">Q0</span>',
      );
      expect(result).toEqual({ ...UPDATED_PAGE, cardCount: 8 });
    });

    it('persists cards in the submitted order after a reorder', async () => {
      const { service, studyGuideMoodle } = buildService();
      const reordered = [...cards(8)].reverse();

      await service.updateDeck(dto({ cards: reordered }));

      const html = (
        studyGuideMoodle.updatePrivatePage.mock.calls[0][0] as UpdatePageInput
      ).contentHtml;
      expect(html.indexOf('>Q7<')).toBeLessThan(html.indexOf('>Q0<'));
      expect(html).toContain('<div class="syll-fc-card" data-card-index="0">');
      expect(html).toContain('<div class="syll-fc-card" data-card-index="7">');
    });

    it('reflects removed and added cards in the count and the markup', async () => {
      const { service, studyGuideMoodle } = buildService();

      const result = await service.updateDeck(
        dto({ cards: [...cards(9), { front: 'New front', back: 'New back' }] }),
      );

      const html = (
        studyGuideMoodle.updatePrivatePage.mock.calls[0][0] as UpdatePageInput
      ).contentHtml;
      expect(result.cardCount).toBe(10);
      expect(html).toContain('Card: 1 / 10');
      expect(html).toContain('<span class="syll-fc-prompt">New front</span>');
      expect(html.match(/class="syll-fc-card"/g)).toHaveLength(10);
    });

    it('escapes and scrubs edited card text before persisting', async () => {
      const { service, studyGuideMoodle } = buildService();

      await service.updateDeck(
        dto({
          cards: [
            {
              front: '<script>alert(1)</script> A & B',
              back: 'See https://evil.com/x now',
            },
            ...cards(7),
          ],
        }),
      );

      const html = (
        studyGuideMoodle.updatePrivatePage.mock.calls[0][0] as UpdatePageInput
      ).contentHtml;
      expect(html).toContain(
        '<span class="syll-fc-prompt">alert(1) A &amp; B</span>',
      );
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('evil.com');
    });

    it('drops half-filled cards before counting, provided enough remain', async () => {
      const { service } = buildService();

      const result = await service.updateDeck(
        dto({ cards: [...cards(8), { front: 'lonely', back: '   ' }] }),
      );

      expect(result.cardCount).toBe(8);
    });

    it('truncates a deck larger than the 40-card cap instead of failing', async () => {
      const { service, studyGuideMoodle } = buildService();

      const result = await service.updateDeck(dto({ cards: cards(45) }));

      const html = (
        studyGuideMoodle.updatePrivatePage.mock.calls[0][0] as UpdatePageInput
      ).contentHtml;
      expect(result.cardCount).toBe(40);
      expect(html).toContain('Card: 1 / 40');
      expect(html).not.toContain('>Q40<');
    });
  });

  describe('renaming the activity', () => {
    it('renames with the canonical Flashcards prefix when a title is supplied', async () => {
      const { service, aiContentMoodle } = buildService();

      await service.updateDeck(dto({ title: 'Memory terms' }));

      expect(aiContentMoodle.renamePrivateActivity).toHaveBeenCalledTimes(1);
      expect(
        aiContentMoodle.renamePrivateActivity.mock.calls[0][0],
      ).toEqual({
        courseId: 5,
        moodleUserId: 11,
        cmId: 42,
        name: 'Flashcards: Memory terms',
      });
    });

    it('does not stack a second Flashcards prefix on an already-prefixed title', async () => {
      const { service, aiContentMoodle } = buildService();

      await service.updateDeck(dto({ title: 'Flashcards: Memory terms' }));

      expect(
        (aiContentMoodle.renamePrivateActivity.mock.calls[0][0] as RenameInput)
          .name,
      ).toBe('Flashcards: Memory terms');
    });

    it('clips the activity name to 200 characters', async () => {
      const { service, aiContentMoodle } = buildService();

      await service.updateDeck(dto({ title: 'B'.repeat(250) }));

      const name = (
        aiContentMoodle.renamePrivateActivity.mock.calls[0][0] as RenameInput
      ).name;
      expect(name).toBe('Flashcards: ' + 'B'.repeat(188));
      expect(name).toHaveLength(200);
    });

    it('skips the rename when no title is supplied', async () => {
      const { service, aiContentMoodle, studyGuideMoodle } = buildService();

      const result = await service.updateDeck(dto({ title: undefined }));

      expect(aiContentMoodle.renamePrivateActivity).not.toHaveBeenCalled();
      expect(studyGuideMoodle.updatePrivatePage).toHaveBeenCalledTimes(1);
      expect(result.cardCount).toBe(8);
    });

    it('skips the rename when the title is only whitespace', async () => {
      const { service, aiContentMoodle } = buildService();

      const result = await service.updateDeck(dto({ title: '   ' }));

      expect(aiContentMoodle.renamePrivateActivity).not.toHaveBeenCalled();
      expect(result.cardCount).toBe(8);
    });

    it('still succeeds when the rename fails, since it is best effort', async () => {
      const { service } = buildService({
        renamePrivateActivity: () => Promise.reject(new Error('rename denied')),
      });

      const result = await service.updateDeck(dto());

      expect(result).toEqual({ ...UPDATED_PAGE, cardCount: 8 });
    });
  });

  describe('validation', () => {
    it('rejects a deck where no card has both sides filled', async () => {
      const { service, studyGuideMoodle } = buildService();

      await expect(
        service.updateDeck(
          dto({ cards: [{ front: 'only front', back: '' }, { front: '', back: 'only back' }] }),
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Flashcards must include a title and at least one card with front and back text',
        ),
      );
      expect(studyGuideMoodle.updatePrivatePage).not.toHaveBeenCalled();
    });

    it('rejects a deck with fewer than eight usable cards', async () => {
      const { service, studyGuideMoodle } = buildService();

      await expect(service.updateDeck(dto({ cards: cards(7) }))).rejects.toThrow(
        new BadRequestException(
          'Flashcards must have at least 8 cards with both sides filled',
        ),
      );
      expect(studyGuideMoodle.updatePrivatePage).not.toHaveBeenCalled();
    });

    it('rejects a deck that falls under eight cards only after scrubbing', async () => {
      const { service } = buildService();

      await expect(
        service.updateDeck(
          dto({
            cards: [
              ...cards(7),
              { front: 'https://evil.com/x', back: 'still a card?' },
            ],
          }),
        ),
      ).rejects.toThrow(
        'Flashcards must have at least 8 cards with both sides filled',
      );
    });

    it('accepts exactly eight cards', async () => {
      const { service } = buildService();

      const result = await service.updateDeck(dto({ cards: cards(8) }));

      expect(result.cardCount).toBe(8);
    });
  });

  describe('Moodle failures', () => {
    it('maps an update failure to a 502 carrying the underlying message', async () => {
      const { service, aiContentMoodle } = buildService({
        updatePrivatePage: () =>
          Promise.reject(new Error('cmId must be a positive integer')),
      });

      const err = (await service
        .updateDeck(dto())
        .catch((e: unknown) => e)) as HttpException;

      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(err.message).toBe('cmId must be a positive integer');
      expect(aiContentMoodle.renamePrivateActivity).not.toHaveBeenCalled();
    });

    it('stringifies a non-Error rejection into the 502 message', async () => {
      const { service } = buildService({
        updatePrivatePage: () => Promise.reject('moodle offline'),
      });

      const err = (await service
        .updateDeck(dto())
        .catch((e: unknown) => e)) as HttpException;

      expect(err.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(err.message).toBe('moodle offline');
    });
  });
});
