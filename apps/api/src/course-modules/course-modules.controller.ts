// goal: REST-style routes for listing and editing modules (paths include courseId or module id).

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CourseModulesService } from './course-modules.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateCourseModuleDto, UpdateCourseModuleDto } from './module.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';

// empty path prefix so routes are /courses/... and /modules/... as declared per method
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CourseModulesController {
  constructor(private readonly courseModulesService: CourseModulesService) {}

  @Get('courses/:courseId/modules')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async listByCourse(
    @Param('courseId') courseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.courseModulesService.listByCourse(courseId, {
      role: request.user.role as UserRole,
      userId: request.user.sub,
    });
  }

  @Post('courses/:courseId/modules')
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  async createModule(
    @Param('courseId') courseId: string,
    @Body() body: CreateCourseModuleDto,
  ) {
    return this.courseModulesService.createModule(
      courseId,
      body.title,
      body.description,
      body.learningOutcomes,
    );
  }

  @Get('modules/:id')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async getModule(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.courseModulesService.getModule(id, {
      role: request.user.role as UserRole,
      userId: request.user.sub,
    });
  }

  @Patch('modules/:id')
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  async updateModule(
    @Param('id') id: string,
    @Body() body: UpdateCourseModuleDto,
  ) {
    return this.courseModulesService.updateModule(
      id,
      body.title,
      body.description,
      body.learningOutcomes,
    );
  }

  @Delete('modules/:id')
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  async deleteModule(@Param('id') id: string) {
    return this.courseModulesService.deleteModule(id);
  }
}
