// goal: admin CRUD for users, enrollments, and role changes (JWT + Roles guards).

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { UpdateUserRoleDto } from './dto-update-role.dto';
import { ManageEnrollmentDto } from './dto-manage-enrollment.dto';
import { CreateUserDto } from './dto-create-user.dto';
import { DeleteUserDto } from './dto-delete-user.dto';

@Controller('users')
// every route here needs a valid JWT then passes RolesGuard
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.ADMIN)
  async listUsers() {
    return this.usersService.listUsers();
  }

  @Post()
  @Roles(Role.ADMIN)
  async createUser(@Body() body: CreateUserDto) {
    return this.usersService.createUser(body);
  }

  @Patch(':id/role')
  @Roles(Role.ADMIN)
  async updateRole(@Param('id') id: string, @Body() body: UpdateUserRoleDto) {
    return this.usersService.updateRole(id, body.role);
  }

  @Get(':id/enrollments')
  @Roles(Role.ADMIN)
  async studentEnrollments(@Param('id') id: string) {
    return this.usersService.studentEnrollments(id);
  }

  @Patch(':id/enrollments/add')
  @Roles(Role.ADMIN)
  async addStudentToCourse(
    @Param('id') id: string,
    @Body() body: ManageEnrollmentDto,
  ) {
    return this.usersService.addStudentToCourse(id, body.courseId);
  }

  @Patch(':id/enrollments/remove')
  @Roles(Role.ADMIN)
  async removeStudentFromCourse(
    @Param('id') id: string,
    @Body() body: ManageEnrollmentDto,
  ) {
    return this.usersService.removeStudentFromCourse(id, body.courseId);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async deleteUser(@Param('id') id: string, @Body() body: DeleteUserDto) {
    return this.usersService.deleteUser(id, body.confirmFullName);
  }
}
