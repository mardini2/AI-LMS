// goal: verify calendar routes forward auth context into CalendarService.

import { Role } from '../common/enums/role.enum';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

describe('CalendarController', () => {
  const calendarService = {
    listEvents: jest.fn(),
    createEvent: jest.fn(),
  } as unknown as CalendarService;

  let controller: CalendarController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new CalendarController(calendarService);
  });

  it('delegates list events with role and user id', async () => {
    (calendarService.listEvents as jest.Mock).mockResolvedValue([]);

    await controller.listEvents({
      user: { role: Role.STUDENT, sub: 's1' },
    } as never);

    expect(calendarService.listEvents).toHaveBeenCalledWith({
      role: Role.STUDENT,
      userId: 's1',
    });
  });

  it('injects createdById from auth user on createEvent', async () => {
    (calendarService.createEvent as jest.Mock).mockResolvedValue({ id: 'e1' });

    await expect(
      controller.createEvent(
        {
          title: 'Midterm',
          startsAt: '2026-04-01T08:00:00.000Z',
          endsAt: '2026-04-01T09:00:00.000Z',
        },
        { user: { sub: 'a1' } } as never,
      ),
    ).resolves.toEqual({ id: 'e1' });

    expect(calendarService.createEvent).toHaveBeenCalledWith({
      title: 'Midterm',
      startsAt: '2026-04-01T08:00:00.000Z',
      endsAt: '2026-04-01T09:00:00.000Z',
      createdById: 'a1',
    });
  });
});
