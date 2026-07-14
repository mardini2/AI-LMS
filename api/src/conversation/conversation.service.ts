import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  Conversation,
  ConversationType,
} from './entities/conversation.entity';
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

export interface ConversationOpenOptions {
  type?: ConversationType;
  title?: string;
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
}

export interface ConversationSummary {
  id: string;
  courseId: number;
  moodleUserId?: number;
  type: ConversationType;
  title: string;
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
  tag: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationSearchResult {
  conversation: ConversationSummary;
  matchedMessage?: {
    id: string;
    role: MessageRole;
    content: string;
    createdAt: Date;
  };
}

@Injectable()
export class ConversationService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  async create(
    courseId: number,
    moodleUserId?: number,
    options: ConversationOpenOptions = {},
  ): Promise<Conversation> {
    const type = options.type ?? 'general';
    const sectionName = cleanText(options.sectionName);
    const requestedTitle = cleanText(options.title);
    if (type === 'manual' && !requestedTitle) {
      throw new BadRequestException('Manual conversations require a title');
    }

    const title = requestedTitle || defaultTitle(type, sectionName);
    const conversation = this.conversationRepo.create({
      courseId,
      moodleUserId,
      type,
      title,
      sectionId: options.sectionId,
      sectionNumber: options.sectionNumber,
      sectionName,
      tag: tagForConversation(type, sectionName ?? title),
    });

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
      .andWhere("COALESCE(c.type, 'general') = 'general'")
      .orderBy('c.created_at', 'DESC')
      .getOne();
  }

  async openConversation(
    courseId: number,
    moodleUserId: number,
    options: ConversationOpenOptions = {},
  ): Promise<Conversation> {
    const type = options.type ?? 'general';
    const sectionName = cleanText(options.sectionName);
    const title = cleanText(options.title) || defaultTitle(type, sectionName);

    let existing: Conversation | null = null;
    if (type === 'general') {
      existing = await this.findGeneralConversation(moodleUserId, courseId);
    } else if (type === 'section') {
      existing = await this.findSectionConversation(
        moodleUserId,
        courseId,
        options.sectionId,
        options.sectionNumber,
      );
    }

    if (existing) {
      existing.title = title;
      existing.sectionName = sectionName ?? existing.sectionName;
      existing.sectionId = options.sectionId ?? existing.sectionId;
      existing.sectionNumber = options.sectionNumber ?? existing.sectionNumber;
      existing.tag = tagForConversation(existing.type, existing.sectionName ?? existing.title);
      return this.conversationRepo.save(existing);
    }

    const conversation = await this.create(courseId, moodleUserId, {
      ...options,
      type,
      title,
      sectionName,
    });

    if (type === 'section' && sectionName) {
      await this.appendMessages(conversation.id, [
        {
          role: 'assistant',
          content: `What would you like to know about ${sectionName}?`,
        },
      ]);
    }

    return this.findById(conversation.id);
  }

  async listForCourse(
    moodleUserId: number,
    courseId: number,
  ): Promise<ConversationSummary[]> {
    const conversations = await this.conversationRepo.find({
      where: { moodleUserId, courseId },
      order: {
        type: 'ASC',
        sectionNumber: 'ASC',
        createdAt: 'ASC',
      },
    });

    return conversations.map(toSummary);
  }

  async searchForCourse(
    moodleUserId: number,
    courseId: number,
    rawQuery: string,
  ): Promise<ConversationSearchResult[]> {
    const query = `%${rawQuery.trim()}%`;
    if (query === '%%') {
      return [];
    }

    const conversations = await this.conversationRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.messages', 'm')
      .where('c.moodle_user_id = :moodleUserId', { moodleUserId })
      .andWhere('c.course_id = :courseId', { courseId })
      .andWhere(
        new Brackets((qb) => {
          qb.where('c.title ILIKE :query', { query })
            .orWhere('c.tag ILIKE :query', { query })
            .orWhere('c.section_name ILIKE :query', { query })
            .orWhere('m.content ILIKE :query', { query });
        }),
      )
      .orderBy('c.updated_at', 'DESC')
      .addOrderBy('m.created_at', 'DESC')
      .getMany();

    return conversations.map((conversation) => {
      const matchedMessage = conversation.messages?.find((message) =>
        message.content.toLowerCase().includes(rawQuery.trim().toLowerCase()),
      );

      return {
        conversation: toSummary(conversation),
        matchedMessage: matchedMessage
          ? {
              id: matchedMessage.id,
              role: matchedMessage.role,
              content: matchedMessage.content,
              createdAt: matchedMessage.createdAt,
            }
          : undefined,
      };
    });
  }

  async deleteConversation(id: string, moodleUserId: number): Promise<void> {
    await this.assertConversationOwner(id, moodleUserId);
    await this.conversationRepo.delete({ id });
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

  async assertOwner(
    conversationId: string,
    moodleUserId: number,
  ): Promise<Conversation> {
    return this.assertConversationOwner(conversationId, moodleUserId);
  }

  async getMessagesPage(
    conversationId: string,
    moodleUserId: number,
    limit = 30,
    before?: Date,
  ): Promise<MessagesPageResult> {
    const conversation = await this.assertConversationOwner(
      conversationId,
      moodleUserId,
    );

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
    const page = filterSyntheticMainWelcome(
      hasMore ? rows.slice(0, cappedLimit) : rows,
      conversation,
    ).reverse();

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

    return filterSyntheticMainWelcome(messages, undefined).map((m) => ({
      role: m.role,
      content: m.content,
    }));
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

    return filterSyntheticMainWelcome(messages, undefined).map((m) => ({
      role: m.role,
      content: m.content,
    }));
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

  private async findGeneralConversation(
    moodleUserId: number,
    courseId: number,
  ): Promise<Conversation | null> {
    return this.conversationRepo
      .createQueryBuilder('c')
      .where('c.moodle_user_id = :moodleUserId', { moodleUserId })
      .andWhere('c.course_id = :courseId', { courseId })
      .andWhere("COALESCE(c.type, 'general') = 'general'")
      .orderBy('c.created_at', 'ASC')
      .getOne();
  }

  private async findSectionConversation(
    moodleUserId: number,
    courseId: number,
    sectionId?: number,
    sectionNumber?: number,
  ): Promise<Conversation | null> {
    const qb = this.conversationRepo
      .createQueryBuilder('c')
      .where('c.moodle_user_id = :moodleUserId', { moodleUserId })
      .andWhere('c.course_id = :courseId', { courseId })
      .andWhere('c.type = :type', { type: 'section' });

    if (sectionId) {
      qb.andWhere('c.section_id = :sectionId', { sectionId });
    } else if (sectionNumber !== undefined) {
      qb.andWhere('c.section_number = :sectionNumber', { sectionNumber });
    } else {
      return null;
    }

    return qb.orderBy('c.created_at', 'ASC').getOne();
  }
}

function toSummary(conversation: Conversation): ConversationSummary {
  const type = conversation.type ?? 'general';
  const title = type === 'general'
    ? defaultTitle(type)
    : conversation.title || defaultTitle(type, conversation.sectionName);

  return {
    id: conversation.id,
    courseId: conversation.courseId,
    moodleUserId: conversation.moodleUserId,
    type,
    title,
    sectionId: conversation.sectionId,
    sectionNumber: conversation.sectionNumber,
    sectionName: conversation.sectionName,
    tag: tagForConversation(type, type === 'section' ? conversation.sectionName ?? title : title),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function defaultTitle(type: ConversationType, sectionName?: string): string {
  if (type === 'section' && sectionName) {
    return `${sectionName} chat`;
  }

  if (type === 'manual') {
    return 'New conversation';
  }

  return 'Main';
}

function tagForConversation(type: ConversationType, label?: string): string {
  if (type === 'general') {
    return '#main';
  }

  return `#${slugTag(label || type)}`;
}

function slugTag(label: string): string {
  const normalized = label
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim();
  const week = normalized.match(/^week\s+(\d+)/);
  if (week) {
    return `week${week[1]}`;
  }

  return normalized.replace(/\s+/g, '-').replace(/-+/g, '-') || 'conversation';
}

function cleanText(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function filterSyntheticMainWelcome<T extends { role: MessageRole; content: string }>(
  messages: T[],
  conversation?: Conversation,
): T[] {
  if (conversation && (conversation.type ?? 'general') !== 'general') {
    return messages;
  }

  return messages.filter(
    (message) =>
      !(
        message.role === 'assistant' &&
        message.content === 'What would you like to know about this course?'
      ),
  );
}
