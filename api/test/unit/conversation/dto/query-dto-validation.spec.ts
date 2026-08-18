import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DeleteConversationQueryDto } from '../../../../src/conversation/dto/delete-conversation-query.dto';
import { FindActiveConversationQueryDto } from '../../../../src/conversation/dto/find-active-conversation-query.dto';
import { GetMessagesQueryDto } from '../../../../src/conversation/dto/get-messages-query.dto';
import { ListConversationsQueryDto } from '../../../../src/conversation/dto/list-conversations-query.dto';
import { SearchConversationsQueryDto } from '../../../../src/conversation/dto/search-conversations-query.dto';

function errorProperties(errors: Awaited<ReturnType<typeof validate>>): string[] {
  return errors.map((e) => e.property);
}

describe('query DTO validation (query-string → plainToInstance → validate)', () => {
  describe('DeleteConversationQueryDto', () => {
    it('transforms valid string input and produces no validation errors', async () => {
      const dto = plainToInstance(DeleteConversationQueryDto, {
        moodleUserId: '42',
      });

      expect(dto.moodleUserId).toBe(42);
      expect(typeof dto.moodleUserId).toBe('number');
      expect(await validate(dto)).toHaveLength(0);
    });

    it('errors on a non-numeric moodleUserId string', async () => {
      const dto = plainToInstance(DeleteConversationQueryDto, {
        moodleUserId: 'not-a-number',
      });

      const errors = await validate(dto);
      expect(errorProperties(errors)).toContain('moodleUserId');
    });
  });

  describe('FindActiveConversationQueryDto', () => {
    it('transforms valid string input and produces no validation errors', async () => {
      const dto = plainToInstance(FindActiveConversationQueryDto, {
        moodleUserId: '42',
        courseId: '7',
      });

      expect(dto.moodleUserId).toBe(42);
      expect(dto.courseId).toBe(7);
      expect(typeof dto.moodleUserId).toBe('number');
      expect(typeof dto.courseId).toBe('number');
      expect(await validate(dto)).toHaveLength(0);
    });

    it('errors on a non-numeric moodleUserId string', async () => {
      const dto = plainToInstance(FindActiveConversationQueryDto, {
        moodleUserId: 'abc',
        courseId: '7',
      });

      const errors = await validate(dto);
      expect(errorProperties(errors)).toContain('moodleUserId');
    });

    it('errors on a non-numeric courseId string', async () => {
      const dto = plainToInstance(FindActiveConversationQueryDto, {
        moodleUserId: '42',
        courseId: 'xyz',
      });

      const errors = await validate(dto);
      expect(errorProperties(errors)).toContain('courseId');
    });
  });

  describe('ListConversationsQueryDto', () => {
    it('transforms valid string input and produces no validation errors', async () => {
      const dto = plainToInstance(ListConversationsQueryDto, {
        moodleUserId: '42',
        courseId: '7',
      });

      expect(dto.moodleUserId).toBe(42);
      expect(dto.courseId).toBe(7);
      expect(typeof dto.moodleUserId).toBe('number');
      expect(typeof dto.courseId).toBe('number');
      expect(await validate(dto)).toHaveLength(0);
    });

    it('errors on a non-numeric moodleUserId string', async () => {
      const dto = plainToInstance(ListConversationsQueryDto, {
        moodleUserId: 'nope',
        courseId: '7',
      });

      const errors = await validate(dto);
      expect(errorProperties(errors)).toContain('moodleUserId');
    });

    it('errors on a non-numeric courseId string', async () => {
      const dto = plainToInstance(ListConversationsQueryDto, {
        moodleUserId: '42',
        courseId: 'nope',
      });

      const errors = await validate(dto);
      expect(errorProperties(errors)).toContain('courseId');
    });
  });

  describe('GetMessagesQueryDto', () => {
    it('transforms valid string input and produces no validation errors', async () => {
      const dto = plainToInstance(GetMessagesQueryDto, {
        moodleUserId: '42',
        limit: '30',
        before: '2026-01-15T12:00:00.000Z',
      });

      expect(dto.moodleUserId).toBe(42);
      expect(dto.limit).toBe(30);
      expect(typeof dto.moodleUserId).toBe('number');
      expect(typeof dto.limit).toBe('number');
      expect(dto.before).toBe('2026-01-15T12:00:00.000Z');
      expect(await validate(dto)).toHaveLength(0);
    });

    it('errors on a non-numeric moodleUserId string', async () => {
      const dto = plainToInstance(GetMessagesQueryDto, {
        moodleUserId: 'abc',
      });

      const errors = await validate(dto);
      expect(errorProperties(errors)).toContain('moodleUserId');
    });

    it('errors on a non-numeric limit string', async () => {
      const dto = plainToInstance(GetMessagesQueryDto, {
        moodleUserId: '42',
        limit: 'many',
      });

      const errors = await validate(dto);
      expect(errorProperties(errors)).toContain('limit');
    });

    it('accepts a valid ISO8601 before string', async () => {
      const dto = plainToInstance(GetMessagesQueryDto, {
        moodleUserId: '42',
        before: '2026-01-15T12:00:00.000Z',
      });

      expect(await validate(dto)).toHaveLength(0);
    });

    it('rejects an invalid before date string', async () => {
      const dto = plainToInstance(GetMessagesQueryDto, {
        moodleUserId: '42',
        before: 'not-a-date',
      });

      const errors = await validate(dto);
      expect(errorProperties(errors)).toContain('before');
    });

    it('allows before and limit to be omitted', async () => {
      const dto = plainToInstance(GetMessagesQueryDto, {
        moodleUserId: '42',
      });

      expect(dto.limit).toBeUndefined();
      expect(dto.before).toBeUndefined();
      expect(await validate(dto)).toHaveLength(0);
    });
  });

  describe('SearchConversationsQueryDto', () => {
    it('transforms valid string input and produces no validation errors', async () => {
      const dto = plainToInstance(SearchConversationsQueryDto, {
        moodleUserId: '42',
        courseId: '7',
        q: 'photosynthesis',
      });

      expect(dto.moodleUserId).toBe(42);
      expect(dto.courseId).toBe(7);
      expect(typeof dto.moodleUserId).toBe('number');
      expect(typeof dto.courseId).toBe('number');
      expect(dto.q).toBe('photosynthesis');
      expect(await validate(dto)).toHaveLength(0);
    });

    it('errors on a non-numeric moodleUserId string', async () => {
      const dto = plainToInstance(SearchConversationsQueryDto, {
        moodleUserId: 'abc',
        courseId: '7',
        q: 'week',
      });

      const errors = await validate(dto);
      expect(errorProperties(errors)).toContain('moodleUserId');
    });

    it('errors on a non-numeric courseId string', async () => {
      const dto = plainToInstance(SearchConversationsQueryDto, {
        moodleUserId: '42',
        courseId: 'abc',
        q: 'week',
      });

      const errors = await validate(dto);
      expect(errorProperties(errors)).toContain('courseId');
    });

    it('rejects an empty q string via @MinLength(1)', async () => {
      const dto = plainToInstance(SearchConversationsQueryDto, {
        moodleUserId: '42',
        courseId: '7',
        q: '',
      });

      const errors = await validate(dto);
      expect(errorProperties(errors)).toContain('q');
    });

    it('rejects a whitespace-only q string via @MinLength(1)', async () => {
      const dto = plainToInstance(SearchConversationsQueryDto, {
        moodleUserId: '42',
        courseId: '7',
        q: '   ',
      });

      expect(dto.q).toBe('');
      const errors = await validate(dto);
      expect(errorProperties(errors)).toContain('q');
    });
  });

  describe('ValidationPipe whitelist + forbidNonWhitelisted', () => {
    it('rejects unrecognized properties instead of silently stripping them', async () => {
      const dto = plainToInstance(ListConversationsQueryDto, {
        moodleUserId: '42',
        courseId: '7',
        hacked: 'true',
      });

      // Extra field is present on the instance (default plainToInstance behavior)
      expect((dto as ListConversationsQueryDto & { hacked?: string }).hacked).toBe(
        'true',
      );

      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errorProperties(errors)).toContain('hacked');
      expect(errors[0].constraints).toEqual(
        expect.objectContaining({
          whitelistValidation: expect.any(String),
        }),
      );
    });
  });
});
