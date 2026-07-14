import {
  Index,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Message } from './message.entity';

export type ConversationType = 'general' | 'section' | 'manual';

@Entity('conversations')
@Index(['moodleUserId', 'courseId', 'type'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'course_id' })
  courseId: number;

  @Column({ name: 'moodle_user_id', nullable: true })
  moodleUserId: number;

  @Column({ type: 'varchar', length: 16, default: 'general' })
  type: ConversationType;

  @Column({ type: 'varchar', length: 255, default: 'Main' })
  title: string;

  @Column({ name: 'section_id', nullable: true })
  sectionId?: number;

  @Column({ name: 'section_number', nullable: true })
  sectionNumber?: number;

  @Column({ name: 'section_name', type: 'varchar', length: 255, nullable: true })
  sectionName?: string;

  @Column({ type: 'varchar', length: 128, default: '#main' })
  tag: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Message, (message) => message.conversation, {
    cascade: true,
  })
  messages: Message[];
}
