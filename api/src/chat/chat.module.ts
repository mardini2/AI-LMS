import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { PendingActionService } from './pending-action.service';
import { PendingAction } from './entities/pending-action.entity';
import { ContextModule } from '../context/context.module';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [
    ContextModule,
    ConversationModule,
    TypeOrmModule.forFeature([PendingAction]),
  ],
  controllers: [ChatController],
  providers: [ChatService, PendingActionService],
})
export class ChatModule {}
