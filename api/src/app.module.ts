import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import * as Joi from 'joi';

import { ChatModule } from './chat/chat.module';
import { ConversationModule } from './conversation/conversation.module';
import { ContextModule } from './context/context.module';
import { Conversation } from './conversation/entities/conversation.entity';
import { Message } from './conversation/entities/message.entity';

@Module({
  imports: [
    // ── Config — validates required env vars at startup ─────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        PORT: Joi.number().default(3000),
        DATABASE_URL: Joi.string().required(),
        MOODLE_INTERNAL_URL: Joi.string().uri().required(),
        MOODLE_TOKEN: Joi.string().required(),
        GEMINI_API_KEY: Joi.string().required(),
        CORS_ORIGIN: Joi.string().required(),
      }),
    }),

    // ── Database ─────────────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [Conversation, Message],
        synchronize: config.get('NODE_ENV') !== 'production',
        ssl: config.get('NODE_ENV') === 'production'
          ? { rejectUnauthorized: false }
          : false,
      }),
      inject: [ConfigService],
    }),

    // ── In-memory cache for Moodle course content ─────────────────────────
    CacheModule.register({
      isGlobal: true,
      ttl: 60 * 15, // 15 minutes
    }),

    // ── Feature modules ───────────────────────────────────────────────────
    ContextModule,
    ConversationModule,
    ChatModule,
  ],
})
export class AppModule {}
