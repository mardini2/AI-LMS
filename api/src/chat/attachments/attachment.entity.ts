import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AttachmentChunk } from './attachment-chunk.entity';

export type AttachmentProcessingStatus =
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'failed';

@Entity('chat_attachments')
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  /** Opaque object key in StorageService — never expose to clients. */
  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  storageKey: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 127 })
  mimeType: string;

  @Column({ name: 'byte_length', type: 'int' })
  byteLength: number;

  @Index()
  @Column({ name: 'moodle_user_id', type: 'int' })
  moodleUserId: number;

  @Index()
  @Column({ name: 'course_id', type: 'int' })
  courseId: number;

  @Index()
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  @Index()
  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId: string | null;

  @Column({ type: 'varchar', length: 16, default: 'uploaded' })
  status: AttachmentProcessingStatus;

  @Column({ name: 'processing_error', type: 'text', nullable: true })
  processingError: string | null;

  /**
   * JSON array of chunk IDs (or count summary). Kept for quick reference;
   * authoritative chunks live in chat_attachment_chunks.
   */
  @Column({ name: 'chunk_refs', type: 'jsonb', nullable: true })
  chunkRefs: string[] | null;

  /** Extension without dot, lowercased. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  extension: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => AttachmentChunk, (chunk) => chunk.attachment, {
    cascade: true,
  })
  chunks?: AttachmentChunk[];
}
