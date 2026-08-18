import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ScheduleModule } from '@nestjs/schedule';
import * as Joi from 'joi';

import { ChatModule } from './chat/chat.module';
import { ConversationModule } from './conversation/conversation.module';
import { ContextModule } from './context/context.module';
import { AttachmentModule } from './chat/attachments/attachment.module';
import { SpeechModule } from './speech/speech.module';
import { Conversation } from './conversation/entities/conversation.entity';
import { Message } from './conversation/entities/message.entity';
import { PendingAction } from './chat/entities/pending-action.entity';
import { Attachment } from './chat/attachments/attachment.entity';
import { AttachmentChunk } from './chat/attachments/attachment-chunk.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        PORT: Joi.number().default(3000),
        DATABASE_URL: Joi.string().required(),
        MOODLE_INTERNAL_URL: Joi.string().uri().required(),
        MOODLE_PUBLIC_URL: Joi.string().uri().allow('').optional(),
        MOODLE_TOKEN: Joi.string().required(),
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
        CORS_ORIGIN: Joi.string().required(),
        // Behat/Selenium: in-process LLM stub. Never enable in production.
        STUB_LLM: Joi.boolean().truthy('true', '1').falsy('false', '0', '').optional(),
        ATTACHMENT_STORAGE_PATH: Joi.string().default('/app/uploads'),
        ATTACHMENT_USER_QUOTA_BYTES: Joi.number().default(2147483648),
        ATTACHMENT_ABANDONED_HOURS: Joi.number().default(24),
        ATTACHMENT_RETENTION_DAYS: Joi.number().default(30),
        // Cloud TTS — leave enabled=false to stick with browser speechSynthesis.
        AZURE_TTS_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
        AZURE_SPEECH_KEY: Joi.string().allow('').optional(),
        AZURE_SPEECH_REGION: Joi.string().allow('').optional(),
      }),
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [
          Conversation,
          Message,
          PendingAction,
          Attachment,
          AttachmentChunk,
        ],
        synchronize: config.get('NODE_ENV') !== 'production',
        ssl: config.get('NODE_ENV') === 'production'
          ? { rejectUnauthorized: false }
          : false,
      }),
      inject: [ConfigService],
    }),

    CacheModule.register({
      isGlobal: true,
      ttl: 15 * 60 * 1000,
    }),

    ScheduleModule.forRoot(),

    ContextModule,
    ConversationModule,
    AttachmentModule,
    ChatModule,
    SpeechModule,
  ],
})
export class AppModule {}
