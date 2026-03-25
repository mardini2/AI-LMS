// goal: HTTP endpoints for password login and reading the current JWT user.

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/authenticated-request.type';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  // stricter than global throttle to slow password guessing
  @Throttle({ default: { limit: 8, ttl: 60000 } })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  // sub comes from validated JWT payload attached by JwtStrategy
  async me(@Req() request: AuthenticatedRequest) {
    return this.authService.me(request.user.sub);
  }
}
