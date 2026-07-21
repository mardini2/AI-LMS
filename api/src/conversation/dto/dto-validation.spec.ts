import { validate } from 'class-validator';
import { CreateConversationDto } from './create-conversation.dto';
import { OpenConversationDto } from './open-conversation.dto';
import { UpdateConversationDto } from './update-conversation.dto';

function makeCreate(data: Record<string, unknown>): CreateConversationDto {
  return Object.assign(new CreateConversationDto(), data);
}

function makeOpen(data: Record<string, unknown>): OpenConversationDto {
  return Object.assign(new OpenConversationDto(), data);
}

function makeUpdate(data: Record<string, unknown>): UpdateConversationDto {
  return Object.assign(new UpdateConversationDto(), data);
}

function errorProperties(errors: Awaited<ReturnType<typeof validate>>): string[] {
  return errors.map((e) => e.property);
}

describe('CreateConversationDto', () => {
  const valid = {
    courseId: 12,
    moodleUserId: 42,
    type: 'manual',
    title: 'My chat',
    sectionId: 10,
    sectionNumber: 1,
    sectionName: 'Week 1',
  };

  it('accepts valid complete data', async () => {
    const errors = await validate(makeCreate(valid));
    expect(errors).toHaveLength(0);
  });

  it('errors when required courseId is missing', async () => {
    const { courseId: _omit, ...rest } = valid;
    const errors = await validate(makeCreate(rest));
    expect(errorProperties(errors)).toContain('courseId');
  });

  it('errors on an invalid type enum value', async () => {
    const errors = await validate(
      makeCreate({ ...valid, type: 'not-a-real-type' }),
    );
    expect(errorProperties(errors)).toContain('type');
  });

  it('errors when courseId is the wrong type', async () => {
    const errors = await validate(makeCreate({ ...valid, courseId: '12' }));
    expect(errorProperties(errors)).toContain('courseId');
  });

  it('errors when optional moodleUserId is the wrong type', async () => {
    const errors = await validate(
      makeCreate({ ...valid, moodleUserId: '42' }),
    );
    expect(errorProperties(errors)).toContain('moodleUserId');
  });

  it('allows optional fields to be omitted', async () => {
    const errors = await validate(makeCreate({ courseId: 12 }));
    expect(errors).toHaveLength(0);
  });
});

describe('OpenConversationDto', () => {
  const valid = {
    courseId: 12,
    moodleUserId: 42,
    type: 'section',
    title: 'Week 1 chat',
    sectionId: 10,
    sectionNumber: 1,
    sectionName: 'Week 1',
  };

  it('accepts valid complete data', async () => {
    const errors = await validate(makeOpen(valid));
    expect(errors).toHaveLength(0);
  });

  it('errors when required courseId is missing', async () => {
    const { courseId: _omit, ...rest } = valid;
    const errors = await validate(makeOpen(rest));
    expect(errorProperties(errors)).toContain('courseId');
  });

  it('errors when required moodleUserId is missing', async () => {
    const { moodleUserId: _omit, ...rest } = valid;
    const errors = await validate(makeOpen(rest));
    expect(errorProperties(errors)).toContain('moodleUserId');
  });

  it('errors on an invalid type enum value', async () => {
    const errors = await validate(
      makeOpen({ ...valid, type: 'not-a-real-type' }),
    );
    expect(errorProperties(errors)).toContain('type');
  });

  it('errors when type is manual (not allowed for open)', async () => {
    const errors = await validate(makeOpen({ ...valid, type: 'manual' }));
    expect(errorProperties(errors)).toContain('type');
  });

  it('errors when courseId is the wrong type', async () => {
    const errors = await validate(makeOpen({ ...valid, courseId: '12' }));
    expect(errorProperties(errors)).toContain('courseId');
  });

  it('errors when moodleUserId is the wrong type', async () => {
    const errors = await validate(
      makeOpen({ ...valid, moodleUserId: '42' }),
    );
    expect(errorProperties(errors)).toContain('moodleUserId');
  });

  it('allows optional fields to be omitted', async () => {
    const errors = await validate(
      makeOpen({ courseId: 12, moodleUserId: 42 }),
    );
    expect(errors).toHaveLength(0);
  });
});

describe('UpdateConversationDto', () => {
  const valid = {
    title: 'Renamed chat',
    pinned: true,
  };

  it('accepts valid complete data', async () => {
    const errors = await validate(makeUpdate(valid));
    expect(errors).toHaveLength(0);
  });

  it('has no required fields — empty object is valid', async () => {
    const errors = await validate(makeUpdate({}));
    expect(errors).toHaveLength(0);
  });

  it('errors when title is the wrong type', async () => {
    const errors = await validate(makeUpdate({ title: 123 }));
    expect(errorProperties(errors)).toContain('title');
  });

  it('errors when pinned is the wrong type', async () => {
    const errors = await validate(makeUpdate({ pinned: 'yes' }));
    expect(errorProperties(errors)).toContain('pinned');
  });

  it('allows optional fields to be omitted individually', async () => {
    expect(await validate(makeUpdate({ title: 'Only title' }))).toHaveLength(0);
    expect(await validate(makeUpdate({ pinned: false }))).toHaveLength(0);
  });
});
