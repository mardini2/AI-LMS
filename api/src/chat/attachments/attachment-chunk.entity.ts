import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Attachment } from './attachment.entity';

@Entity('chat_attachment_chunks')
export class AttachmentChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'attachment_id', type: 'uuid' })
  attachmentId: string;

  @ManyToOne(() => Attachment, (attachment) => attachment.chunks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'attachment_id' })
  attachment: Attachment;

  @Column({ name: 'chunk_index', type: 'int' })
  chunkIndex: number;

  /** Extracted text for this chunk (not the original binary). */
  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'char_count', type: 'int' })
  charCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
