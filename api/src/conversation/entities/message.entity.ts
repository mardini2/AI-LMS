import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';

export type MessageRole = 'user' | 'assistant';

/** Chat teaching style for a turn. Null on legacy rows. */
export type ChatMode = 'direct' | 'coach';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Conversation, (conversation) => conversation.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ name: 'conversation_id' })
  conversationId: string;

  @Column({ type: 'varchar', length: 16 })
  role: MessageRole;

  @Column({ type: 'text' })
  content: string;

  /** Semantic vector used to retrieve relevant conversation memory. */
  @Column({ type: 'jsonb', nullable: true })
  embedding?: number[] | null;

  /** Teaching mode used for this turn (`direct` | `coach`). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  mode?: ChatMode | null;

  /** Coach guidance level 1–5; null for direct / legacy. */
  @Column({ type: 'smallint', nullable: true })
  guidance?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
