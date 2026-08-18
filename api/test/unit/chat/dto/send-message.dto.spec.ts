import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HistoryEntryDto, SendMessageDto } from '../../../../src/chat/dto/send-message.dto';

function makeSendMessage(data: Record<string, unknown>): SendMessageDto {
  const dto = Object.assign(new SendMessageDto(), data);
  if (Array.isArray(data.history)) {
    dto.history = data.history.map((entry) =>
      Object.assign(new HistoryEntryDto(), entry as Record<string, unknown>),
    );
  }
  return dto;
}

function errorProperties(errors: Awaited<ReturnType<typeof validate>>): string[] {
  return errors.map((e) => e.property);
}

describe('SendMessageDto', () => {
  const valid = {
    courseId: 12,
    courseName: 'Organic Chemistry',
    moodleUserId: 42,
    userFirstName: 'Alex',
    message: 'What is a covalent bond?',
    conversationId: '550e8400-e29b-41d4-a716-446655440000',
    history: [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
    ],
  };

  it('accepts valid complete data', async () => {
    const errors = await validate(makeSendMessage(valid));
    expect(errors).toHaveLength(0);
  });

  it('errors when required courseId is missing', async () => {
    const { courseId: _omit, ...rest } = valid;
    const errors = await validate(makeSendMessage(rest));
    expect(errorProperties(errors)).toContain('courseId');
  });

  it('errors when required message is missing', async () => {
    const { message: _omit, ...rest } = valid;
    const errors = await validate(makeSendMessage(rest));
    expect(errorProperties(errors)).toContain('message');
  });

  it('errors on an invalid history role enum value', async () => {
    const errors = await validate(
      makeSendMessage({
        ...valid,
        history: [{ role: 'not-a-real-type', content: 'Hi' }],
      }),
    );

    expect(errorProperties(errors)).toContain('history');
    const historyError = errors.find((e) => e.property === 'history');
    expect(historyError?.children?.[0]?.children?.map((c) => c.property)).toContain(
      'role',
    );
  });

  it('errors when courseId is the wrong type', async () => {
    const errors = await validate(makeSendMessage({ ...valid, courseId: '12' }));
    expect(errorProperties(errors)).toContain('courseId');
  });

  it('errors when message is the wrong type', async () => {
    const errors = await validate(makeSendMessage({ ...valid, message: 123 }));
    expect(errorProperties(errors)).toContain('message');
  });

  it('errors when conversationId is not a UUID', async () => {
    const errors = await validate(
      makeSendMessage({ ...valid, conversationId: 'not-a-uuid' }),
    );
    expect(errorProperties(errors)).toContain('conversationId');
  });

  it('allows optional fields to be omitted', async () => {
    const errors = await validate(
      makeSendMessage({ courseId: 12, message: 'Hello' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('errors when a nested history entry is missing content', async () => {
    const errors = await validate(
      makeSendMessage({
        ...valid,
        history: [{ role: 'user' }],
      }),
    );

    expect(errorProperties(errors)).toContain('history');
    const historyError = errors.find((e) => e.property === 'history');
    expect(historyError?.children?.[0]?.children?.map((c) => c.property)).toContain(
      'content',
    );
  });

  it('transforms nested history via @Type when using plainToInstance', async () => {
    const dto = plainToInstance(SendMessageDto, {
      courseId: 12,
      message: 'Hello',
      history: [{ role: 'user', content: 'Prior turn' }],
    });

    expect(dto.history?.[0]).toBeInstanceOf(HistoryEntryDto);

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});

describe('HistoryEntryDto', () => {
  it('accepts valid data', async () => {
    const errors = await validate(
      Object.assign(new HistoryEntryDto(), {
        role: 'assistant',
        content: 'Answer',
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('errors when required role is missing', async () => {
    const errors = await validate(
      Object.assign(new HistoryEntryDto(), { content: 'Answer' }),
    );
    expect(errorProperties(errors)).toContain('role');
  });

  it('errors when required content is missing', async () => {
    const errors = await validate(
      Object.assign(new HistoryEntryDto(), { role: 'user' }),
    );
    expect(errorProperties(errors)).toContain('content');
  });

  it('errors on an invalid role enum value', async () => {
    const errors = await validate(
      Object.assign(new HistoryEntryDto(), {
        role: 'system',
        content: 'Nope',
      }),
    );
    expect(errorProperties(errors)).toContain('role');
  });

  it('errors when content is the wrong type', async () => {
    const errors = await validate(
      Object.assign(new HistoryEntryDto(), {
        role: 'user',
        content: 99,
      }),
    );
    expect(errorProperties(errors)).toContain('content');
  });
});
