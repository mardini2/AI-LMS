// staff see a course total; students load enrollments from the courses API on the client

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(input: { role: Role; userId: string }) {
    if (input.role === Role.INSTRUCTOR) {
      const courses = await this.prisma.course.count({
        where: {
          OR: [
            { createdById: input.userId },
            { instructorId: input.userId },
          ],
        },
      });
      return { courses };
    }

    // admin and reviewer use the full course catalog
    const courses = await this.prisma.course.count();
    return { courses };
  }
}
