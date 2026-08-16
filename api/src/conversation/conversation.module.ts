import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { AttachmentModule } from '../chat/attachments/attachment.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message]),
    forwardRef(() => AttachmentModule),
  ],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
