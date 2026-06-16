import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message, MessageRole } from './entities/message.entity';

export interface MessagePageItem {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
}

export interface MessagesPageResult {
  messages: MessagePageItem[];
  hasMore: boolean;
}

@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  async create(courseId: number, moodleUserId?: number): Promise<Conversation> {
    const conversation = this.conversationRepo.create({ courseId, moodleUserId });
    return this.conversationRepo.save(conversation);
  }

  async findById(id: string): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id },
      relations: ['messages'],
      order: { messages: { createdAt: 'ASC' } },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }

    return conversation;
  }

  async findLatestForUserCourse(
    moodleUserId: number,
    courseId: number,
  ): Promise<Conversation | null> {
    return this.conversationRepo
      .createQueryBuilder('c')
      .where('c.moodle_user_id = :moodleUserId', { moodleUserId })
      .andWhere('c.course_id = :courseId', { courseId })
      .orderBy('c.created_at', 'DESC')
      .getOne();
  }

  private async assertConversationOwner(
    conversationId: string,
    moodleUserId: number,
  ): Promise<Conversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    if (conversation.moodleUserId !== moodleUserId) {
      throw new ForbiddenException('Not allowed to access this conversation');
    }

    return conversation;
  }

  async getMessagesPage(
    conversationId: string,
    moodleUserId: number,
    limit = 30,
    before?: Date,
  ): Promise<MessagesPageResult> {
    await this.assertConversationOwner(conversationId, moodleUserId);

    const cappedLimit = Math.min(Math.max(limit, 1), 100);

    let qb = this.messageRepo
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', { conversationId });

    if (before) {
      qb = qb.andWhere('m.created_at < :before', { before });
    }

    const rows = await qb
      .orderBy('m.created_at', 'DESC')
      .addOrderBy("CASE WHEN m.role = 'user' THEN 0 ELSE 1 END", 'DESC')
      .take(cappedLimit + 1)
      .getMany();

    const hasMore = rows.length > cappedLimit;
    const page = (hasMore ? rows.slice(0, cappedLimit) : rows).reverse();

    return {
      messages: page.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
      hasMore,
    };
  }

  async getHistory(
    conversationId: string,
  ): Promise<Array<{ role: MessageRole; content: string }>> {
    const messages = await this.messageRepo
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', { conversationId })
      .orderBy('m.created_at', 'ASC')
      .addOrderBy("CASE WHEN m.role = 'user' THEN 0 ELSE 1 END", 'ASC')
      .getMany();

    return messages.map((m) => ({ role: m.role, content: m.content }));
  }

  async getRecentHistory(
    conversationId: string,
    maxTurns = 20,
  ): Promise<Array<{ role: MessageRole; content: string }>> {
    const maxMessages = maxTurns * 2;

    const messages = await this.messageRepo
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', { conversationId })
      .orderBy('m.created_at', 'DESC')
      .addOrderBy("CASE WHEN m.role = 'user' THEN 0 ELSE 1 END", 'DESC')
      .take(maxMessages)
      .getMany();

    messages.reverse();

    return messages.map((m) => ({ role: m.role, content: m.content }));
  }

  async appendMessages(
    conversationId: string,
    pairs: Array<{ role: MessageRole; content: string }>,
  ): Promise<void> {
    for (const p of pairs) {
      await this.messageRepo.save(
        this.messageRepo.create({
          conversationId,
          role: p.role,
          content: p.content,
        }),
      );
    }
  }
}
