import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message, MessageRole } from './entities/message.entity';

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

  async getHistory(
    conversationId: string,
  ): Promise<Array<{ role: MessageRole; content: string }>> {
    const messages = await this.messageRepo
      .createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', { conversationId })
      .orderBy('m.created_at', 'ASC')
      // User/assistant pairs saved in the same millisecond must stay in turn order.
      .addOrderBy("CASE WHEN m.role = 'user' THEN 0 ELSE 1 END", 'ASC')
      .getMany();

    return messages.map((m) => ({ role: m.role, content: m.content }));
  }

  async appendMessages(
    conversationId: string,
    pairs: Array<{ role: MessageRole; content: string }>,
  ): Promise<void> {
    // Save sequentially so created_at reflects turn order (user before assistant).
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
