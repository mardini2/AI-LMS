import { Controller, Get, Post, Body, Param, ParseUUIDPipe } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { CreateConversationDto } from './dto/create-conversation.dto';

@Controller('conversations')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  /**
   * POST /conversations
   * Start a new conversation for a given course.
   * The chat endpoint calls this automatically when no conversationId is supplied,
   * but clients can also call it directly to pre-create a conversation.
   */
  @Post()
  create(@Body() dto: CreateConversationDto) {
    return this.conversationService.create(dto.courseId, dto.moodleUserId);
  }

  /**
   * GET /conversations/:id
   * Retrieve a full conversation including all messages, ordered by time.
   */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversationService.findById(id);
  }
}
