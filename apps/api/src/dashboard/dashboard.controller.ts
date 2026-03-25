// goal: HTTP endpoints for dashboard counts and recent review activity.

import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER)
  async overview(@Req() request: AuthenticatedRequest) {
    return this.dashboardService.overview({
      role: request.user.role as Role,
      userId: request.user.sub,
    });
  }

  @Get('recent-activity')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER)
  async recentActivity(@Req() request: AuthenticatedRequest) {
    return this.dashboardService.recentActivity({
      role: request.user.role as Role,
      userId: request.user.sub,
    });
  }
}
