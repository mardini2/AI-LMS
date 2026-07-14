import {
  Controller,
  Delete,
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
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { SearchConversationsQueryDto } from './dto/search-conversations-query.dto';
import { DeleteConversationQueryDto } from './dto/delete-conversation-query.dto';
import { OpenConversationDto } from './dto/open-conversation.dto';

@Controller('conversations')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  @Get()
  list(@Query() query: ListConversationsQueryDto) {
    return this.conversationService.listForCourse(
      query.moodleUserId,
      query.courseId,
    );
  }

  @Post()
  create(@Body() dto: CreateConversationDto) {
    return this.conversationService.create(dto.courseId, dto.moodleUserId, dto);
  }

  /**
   * Idempotently opens a general or section conversation. Manual conversations
   * are intentionally created through POST /conversations so they can duplicate
   * naturally as separate user-created chats.
   */
  @Post('open')
  open(@Body() dto: OpenConversationDto) {
    return this.conversationService.openConversation(
      dto.courseId,
      dto.moodleUserId,
      dto,
    );
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

  @Get('search')
  search(@Query() query: SearchConversationsQueryDto) {
    return this.conversationService.searchForCourse(
      query.moodleUserId,
      query.courseId,
      query.q,
    );
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
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteConversationQueryDto,
  ) {
    return this.conversationService.assertOwner(id, query.moodleUserId);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteConversationQueryDto,
  ) {
    await this.conversationService.deleteConversation(id, query.moodleUserId);
    return { deleted: true };
  }
}
