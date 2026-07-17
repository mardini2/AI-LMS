import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type PendingActionType = 'practice_quiz';
export type PendingActionStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'expired';

export interface PracticeQuizPayload {
  title: string;
  scopeSummary: string;
  questionCount: number;
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
  quizId?: number;
  cmId?: number;
  viewUrl?: string;
  /** @deprecated Prefer explainedAttemptId */
  explainedAt?: string | null;
  explainedAttemptId?: number | null;
}

@Entity('pending_actions')
@Index(['conversationId', 'status'])
@Index(['moodleUserId', 'status'])
export class PendingAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ name: 'course_id' })
  courseId: number;

  @Column({ name: 'moodle_user_id' })
  moodleUserId: number;

  @Column({ type: 'varchar', length: 32 })
  type: PendingActionType;

  @Column({ type: 'jsonb' })
  payload: PracticeQuizPayload;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: PendingActionStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
