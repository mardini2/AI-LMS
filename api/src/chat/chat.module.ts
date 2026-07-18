import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { PendingAction } from './entities/pending-action.entity';
import { GeminiClient } from './gemini.client';
import { PendingActionService } from './pending-action.service';
import { PracticeQuizGenerationService } from './practice-quiz-generation.service';
import { PracticeQuizReviewService } from './practice-quiz-review.service';
import { ContextModule } from '../context/context.module';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [
    ContextModule,
    ConversationModule,
    TypeOrmModule.forFeature([PendingAction]),
  ],
  controllers: [ChatController],
  providers: [
    GeminiClient,
    ChatService,
    PendingActionService,
    PracticeQuizGenerationService,
    PracticeQuizReviewService,
  ],
})
export class ChatModule {}
