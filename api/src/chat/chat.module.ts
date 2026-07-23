import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { FlashcardsController } from './flashcards.controller';
import { AiContentController } from './ai-content.controller';
import { ChatService } from './chat.service';
import { PendingAction } from './entities/pending-action.entity';
import { GeminiClient } from './gemini.client';
import { PendingActionService } from './pending-action.service';
import { PracticeQuizGenerationService } from './practice-quiz-generation.service';
import { PracticeQuizReviewService } from './practice-quiz-review.service';
import { StudyGuideGenerationService } from './study-guide-generation.service';
import { FlashcardsGenerationService } from './flashcards-generation.service';
import { FlashcardsUpdateService } from './flashcards-update.service';
import { AiContentService } from './ai-content.service';
import { TopicSuggestionsService } from './topic-suggestions.service';
import { ContextModule } from '../context/context.module';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [
    ContextModule,
    ConversationModule,
    TypeOrmModule.forFeature([PendingAction]),
  ],
  controllers: [ChatController, FlashcardsController, AiContentController],
  providers: [
    GeminiClient,
    ChatService,
    PendingActionService,
    PracticeQuizGenerationService,
    PracticeQuizReviewService,
    StudyGuideGenerationService,
    FlashcardsGenerationService,
    FlashcardsUpdateService,
    AiContentService,
    TopicSuggestionsService,
  ],
})
export class ChatModule {}
