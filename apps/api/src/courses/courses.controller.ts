// goal: HTTP routes for courses and announcements with role-based list/detail behavior.

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
import { CoursesService } from './courses.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateAnnouncementDto,
  CreateCourseDto,
  DeleteCourseDto,
  UpdateCourseDto,
} from './course.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';
import { AuditLogService } from '../audit-log/audit-log.service';

@Controller('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CoursesController {
  constructor(
    private readonly coursesService: CoursesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  // students only see enrolled courses; instructors see their own creations
  async listCourses(@Req() request: AuthenticatedRequest) {
    if (request.user.role === Role.STUDENT) {
      return this.coursesService.listStudentCourses(request.user.sub);
    }
    if (request.user.role === Role.INSTRUCTOR) {
      return this.coursesService.listInstructorCourses(request.user.sub);
    }
    return this.coursesService.listCourses();
  }

  @Get('my-enrollments')
  @Roles(Role.STUDENT)
  async myEnrollments(@Req() request: AuthenticatedRequest) {
    return this.coursesService.listStudentCourses(request.user.sub);
  }

  @Post()
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  async createCourse(
    @Body() body: CreateCourseDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const course = await this.coursesService.createCourse(
      request.user.sub,
      body.title,
      body.description,
      body.backgroundImage,
    );

    // immutable trail for compliance / debugging
    await this.auditLogService.write({
      actorId: request.user.sub,
      action: 'COURSE_CREATED',
      entityType: 'Course',
      entityId: course.id,
    });

    return course;
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async getCourse(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.user.role === Role.STUDENT) {
      await this.coursesService.assertStudentEnrollment(id, request.user.sub);
    }
    return this.coursesService.getCourse(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  async updateCourse(@Param('id') id: string, @Body() body: UpdateCourseDto) {
    return this.coursesService.updateCourse(
      id,
      body.title,
      body.description,
      body.backgroundImage,
    );
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  async deleteCourse(@Param('id') id: string, @Body() body: DeleteCourseDto) {
    return this.coursesService.deleteCourse(id, body.confirmTitle);
  }

  @Get(':id/announcements')
  @Roles(Role.ADMIN, Role.INSTRUCTOR, Role.REVIEWER, Role.STUDENT)
  async listAnnouncements(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.user.role === Role.STUDENT) {
      await this.coursesService.assertStudentEnrollment(id, request.user.sub);
    }
    return this.coursesService.listAnnouncements(id);
  }

  @Post(':id/announcements')
  @Roles(Role.ADMIN, Role.INSTRUCTOR)
  async createAnnouncement(
    @Param('id') id: string,
    @Body() body: CreateAnnouncementDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.coursesService.createAnnouncement(
      id,
      request.user.sub,
      body.title,
      body.body,
    );
  }
}
