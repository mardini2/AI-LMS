import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import {
  CancelActionDto,
  ConfirmActionDto,
  ExplainReviewDto,
} from './dto/action.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * POST /chat/message
   */
  @Post('message')
  sendMessage(@Body() dto: SendMessageDto) {
    return this.chatService.sendMessage(dto);
  }

  /**
   * POST /chat/actions/confirm
   */
  @Post('actions/confirm')
  confirmAction(@Body() dto: ConfirmActionDto) {
    return this.chatService.confirmAction(dto.actionId, dto.moodleUserId, {
      title: dto.title,
      count: dto.count,
      difficulty: dto.difficulty,
    });
  }

  /**
   * POST /chat/actions/cancel
   */
  @Post('actions/cancel')
  cancelAction(@Body() dto: CancelActionDto) {
    return this.chatService.cancelAction(dto.actionId, dto.moodleUserId);
  }

  /**
   * GET /chat/actions/pending?conversationId=&moodleUserId=
   */
  @Get('actions/pending')
  async getPending(
    @Query('conversationId', ParseUUIDPipe) conversationId: string,
    @Query('moodleUserId', ParseIntPipe) moodleUserId: number,
  ) {
    const pendingAction = await this.chatService.getPendingAction(
      conversationId,
      moodleUserId,
    );
    return { pendingAction };
  }

  /**
   * GET /chat/actions/review-offer?conversationId=&moodleUserId=
   */
  @Get('actions/review-offer')
  async getReviewOffer(
    @Query('conversationId', ParseUUIDPipe) conversationId: string,
    @Query('moodleUserId', ParseIntPipe) moodleUserId: number,
  ) {
    const offer = await this.chatService.getReviewOffer(
      conversationId,
      moodleUserId,
    );
    return { offer };
  }

  /**
   * POST /chat/actions/review-explain
   */
  @Post('actions/review-explain')
  explainReview(@Body() dto: ExplainReviewDto) {
    return this.chatService.explainWrongAnswers(
      dto.conversationId,
      dto.moodleUserId,
    );
  }
}
