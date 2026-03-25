// goal: test student merge logic and date parsing on create.

import { Role } from '../common/enums/role.enum';
import { CalendarService } from './calendar.service';

describe('CalendarService', () => {
  const prisma = {
    calendarEvent: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    contentItem: {
      findMany: jest.fn(),
    },
  };

  let service: CalendarService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CalendarService(prisma as never);
  });

  it('returns manual events only for non-student roles', async () => {
    prisma.calendarEvent.findMany.mockResolvedValue([{ id: 'm1' }]);

    await expect(
      service.listEvents({ role: Role.ADMIN, userId: 'a1' }),
    ).resolves.toEqual([{ id: 'm1' }]);
    expect(prisma.contentItem.findMany).not.toHaveBeenCalled();
  });

  it('merges due content items into student calendar view', async () => {
    const dueAt = new Date('2026-03-30T12:00:00.000Z');
    prisma.calendarEvent.findMany.mockResolvedValue([
      { id: 'm1', title: 'Manual' },
    ]);
    prisma.contentItem.findMany.mockResolvedValue([
      {
        id: 'c1',
        title: 'Quiz 1',
        dueAt,
        updatedAt: new Date('2026-03-20T10:00:00.000Z'),
        module: {
          title: 'Module 1',
          course: { title: 'Data Literacy' },
        },
      },
    ]);

    await expect(
      service.listEvents({ role: Role.STUDENT, userId: 's1' }),
    ).resolves.toEqual(
      expect.arrayContaining([
        { id: 'm1', title: 'Manual' },
        expect.objectContaining({
          id: 'c1',
          title: 'Quiz 1 due',
          description: 'Data Literacy • Module 1',
          startsAt: dueAt,
          endsAt: dueAt,
          createdById: null,
        }),
      ]),
    );
  });

  it('converts ISO date strings when creating events', async () => {
    prisma.calendarEvent.create.mockResolvedValue({ id: 'e1' });

    await service.createEvent({
      title: 'Event',
      description: 'Desc',
      startsAt: '2026-04-01T08:00:00.000Z',
      endsAt: '2026-04-01T09:00:00.000Z',
      createdById: 'a1',
    });

    expect(prisma.calendarEvent.create).toHaveBeenCalledWith({
      data: {
        title: 'Event',
        description: 'Desc',
        startsAt: new Date('2026-04-01T08:00:00.000Z'),
        endsAt: new Date('2026-04-01T09:00:00.000Z'),
        createdById: 'a1',
      },
    });
  });
});
