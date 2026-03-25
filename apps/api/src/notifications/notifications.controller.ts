// goal: list notifications, unread badge count, and mark-all-read for the session user.

import { Controller, Get, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { NotificationsService } from './notifications.service';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async listMine(
    @Req() request: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    // clamp happens in the service; NaN falls back there too
    const parsedLimit = limit ? Number(limit) : 5;
    return this.notificationsService.listForUser(request.user.sub, parsedLimit);
  }

  @Get('unread-count')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async unreadCount(@Req() request: AuthenticatedRequest) {
    const count = await this.notificationsService.unreadCount(request.user.sub);
    return { count };
  }

  @Patch('mark-all-read')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async markAllRead(@Req() request: AuthenticatedRequest) {
    return this.notificationsService.markAllRead(request.user.sub);
  }
}
