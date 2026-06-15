import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ContextModule } from '../context/context.module';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [ContextModule, ConversationModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
