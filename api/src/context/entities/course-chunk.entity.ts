import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface CourseChunkMetadata {
  indexVersion: number;
  courseName?: string;
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
  moduleId?: number;
  moduleName?: string;
  contentType: string;
  fileName?: string;
  source?: string;
  lastUpdated?: number;
  chunkIndex: number;
}

@Entity('course_context_chunks')
@Index(['courseId', 'fingerprint'], { unique: true })
export class CourseChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'course_id', type: 'integer' })
  courseId: number;

  @Column({ type: 'varchar', length: 64 })
  fingerprint: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'jsonb' })
  metadata: CourseChunkMetadata;

  @Column({ type: 'jsonb', nullable: true })
  embedding?: number[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
