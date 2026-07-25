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
import { PendingAction } from './chat/entities/pending-action.entity';
import { CourseChunk } from './context/entities/course-chunk.entity';
import { RagModule } from './rag/rag.module';
import { AddRagStorage1784959200000 } from './migrations/1784959200000-AddRagStorage';

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
        // Provider keys are optional — availability is checked at request time.
        GEMINI_API_KEY: Joi.string().allow('').optional(),
        OPENAI_API_KEY: Joi.string().allow('').optional(),
        ANTHROPIC_API_KEY: Joi.string().allow('').optional(),
        XAI_API_KEY: Joi.string().allow('').optional(),
        MISTRAL_API_KEY: Joi.string().allow('').optional(),
        GEMINI_MODEL: Joi.string().allow('').optional(),
        OPENAI_MODEL: Joi.string().allow('').optional(),
        ANTHROPIC_MODEL: Joi.string().allow('').optional(),
        XAI_MODEL: Joi.string().allow('').optional(),
        MISTRAL_MODEL: Joi.string().allow('').optional(),
        RAG_GEMINI_EMBEDDING_MODEL: Joi.string().allow('').optional(),
        RAG_OPENAI_EMBEDDING_MODEL: Joi.string().allow('').optional(),
        CORS_ORIGIN: Joi.string().required(),
      }),
    }),

    // ── Database ─────────────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [Conversation, Message, PendingAction, CourseChunk],
        migrations: [AddRagStorage1784959200000],
        migrationsRun: config.get('NODE_ENV') === 'production',
        synchronize: config.get('NODE_ENV') !== 'production',
        ssl:
          config.get('NODE_ENV') === 'production'
            ? { rejectUnauthorized: false }
            : false,
      }),
      inject: [ConfigService],
    }),

    // ── In-memory cache for Moodle course content ─────────────────────────
    CacheModule.register({
      isGlobal: true,
      ttl: 15 * 60 * 1000, // 15 minutes (cache-manager v6 uses ms)
    }),

    // ── Feature modules ───────────────────────────────────────────────────
    RagModule,
    ContextModule,
    ConversationModule,
    ChatModule,
  ],
})
export class AppModule {}
