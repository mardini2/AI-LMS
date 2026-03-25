// goal: merge DB calendar events with synthetic rows from assignment due dates.

import { Injectable } from '@nestjs/common';
import { Role } from '../common/enums/role.enum';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async listEvents(input: { role: Role; userId: string }) {
    const manualEvents = await this.prisma.calendarEvent.findMany({
      orderBy: { startsAt: 'asc' },
    });

    if (input.role !== Role.STUDENT) {
      return manualEvents;
    }

    // students also see deadlines from enrolled courses as pseudo-events
    const dueItems = await this.prisma.contentItem.findMany({
      where: {
        dueAt: { not: null },
        module: {
          course: {
            enrollments: {
              some: { studentId: input.userId },
            },
          },
        },
      },
      include: {
        module: {
          include: {
            course: true,
          },
        },
      },
      orderBy: { dueAt: 'asc' },
    });

    return [
      ...manualEvents,
      ...dueItems.map((item) => ({
        id: item.id,
        title: `${item.title} due`,
        description: `${item.module.course.title} • ${item.module.title}`,
        startsAt: item.dueAt,
        endsAt: item.dueAt,
        createdById: null,
        createdAt: item.updatedAt,
      })),
    ];
  }

  async createEvent(input: {
    title: string;
    description?: string;
    startsAt: string;
    endsAt?: string;
    createdById: string;
  }) {
    return this.prisma.calendarEvent.create({
      data: {
        title: input.title,
        description: input.description,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        createdById: input.createdById,
      },
    });
  }
}
