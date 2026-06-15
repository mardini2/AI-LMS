import { Controller, Post, Body } from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * POST /chat/message
   * Accepts a student message and returns an AI-generated response grounded
   * in the course material. Creates a new conversation if no conversationId
   * is supplied, and always persists both turns to the database.
   *
   * Body: { courseId, message, conversationId?, history? }
   * Returns: { response, conversationId }
   */
  @Post('message')
  sendMessage(@Body() dto: SendMessageDto) {
    return this.chatService.sendMessage(dto);
  }
}
