import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { FindActiveConversationQueryDto } from './dto/find-active-conversation-query.dto';

@Controller('conversations')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Post()
  create(@Body() dto: CreateConversationDto) {
    return this.conversationService.create(dto.courseId, dto.moodleUserId);
  }

  /**
   * GET /conversations/active?moodleUserId=&courseId=
   * Returns the most recent conversation id for a user+course pair.
   */
  @Get('active')
  async findActive(@Query() query: FindActiveConversationQueryDto) {
    const conversation = await this.conversationService.findLatestForUserCourse(
      query.moodleUserId,
      query.courseId,
    );

    return { conversationId: conversation?.id ?? null };
  }

  /**
   * GET /conversations/:id/messages?moodleUserId=&limit=30&before=<iso>
   * Paginated messages, newest page first; use `before` to load older pages.
   */
  @Get(':id/messages')
  getMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GetMessagesQueryDto,
  ) {
    return this.conversationService.getMessagesPage(
      id,
      query.moodleUserId,
      query.limit ?? 30,
      query.before ? new Date(query.before) : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversationService.findById(id);
  }
}
