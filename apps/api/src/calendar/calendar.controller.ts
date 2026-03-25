// goal: list calendar entries for the current role and let admins create events.

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CalendarService } from './calendar.service';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';

// inline DTO keeps this small controller self-contained
class CreateCalendarEventDto {
  @IsString()
  @MinLength(3)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  startsAt!: string;

  @IsOptional()
  @IsString()
  endsAt?: string;
}

@Controller('calendar-events')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async listEvents(@Req() request: AuthenticatedRequest) {
    return this.calendarService.listEvents({
      role: request.user.role as Role,
      userId: request.user.sub,
    });
  }

  @Post()
  @Roles(Role.ADMIN)
  async createEvent(
    @Body() body: CreateCalendarEventDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.calendarService.createEvent({
      ...body,
      createdById: request.user.sub,
    });
  }
}
