// goal: register all feature modules, env validation, and global rate limiting.

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import Joi from 'joi';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CoursesModule } from './courses/courses.module';
import { CourseModulesModule } from './course-modules/course-modules.module';
import { ContentItemsModule } from './content-items/content-items.module';
import { ReviewsModule } from './reviews/reviews.module';
import { AiModule } from './ai/ai.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { HealthModule } from './health/health.module';
import { CalendarModule } from './calendar/calendar.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      // fail fast if required secrets or URLs are missing or malformed
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'test', 'production')
          .default('development'),
        PORT: Joi.number().integer().min(1).max(65535).default(3000),
        WEB_ORIGIN: Joi.string().required(),
        DATABASE_URL: Joi.string().uri().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().default('1d'),
        OLLAMA_BASE_URL: Joi.string().uri().required(),
        OLLAMA_MODEL: Joi.string().required(),
        TRUST_PROXY: Joi.string().valid('0', '1', 'true', 'false').optional(),
      }),
    }),
    // global request budget per window (helps blunt abuse)
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 120,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    CoursesModule,
    CourseModulesModule,
    ContentItemsModule,
    ReviewsModule,
    AiModule,
    DashboardModule,
    AuditLogModule,
    HealthModule,
    CalendarModule,
    NotificationsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      // applies throttler to every route unless a handler opts out
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
