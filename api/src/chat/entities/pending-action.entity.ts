import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type PendingActionType =
  | 'practice_quiz'
  | 'study_guide'
  | 'flashcards';
export type PendingActionStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'expired';

export type QuizDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface PracticeQuizPayload {
  title: string;
  scopeSummary: string;
  questionCount: number;
  /** Whole-quiz difficulty for generation. Defaults to medium when omitted. */
  difficulty?: QuizDifficulty;
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
  /** Resolved Moodle section ids when the quiz is hard-scoped to specific weeks/modules. */
  sectionIds?: number[];
  sectionNumbers?: number[];
  quizId?: number;
  cmId?: number;
  viewUrl?: string;
  /** @deprecated Prefer explainedAttemptId */
  explainedAt?: string | null;
  explainedAttemptId?: number | null;
}

export interface StudyGuidePayload {
  title: string;
  scopeSummary: string;
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
  sectionIds?: number[];
  sectionNumbers?: number[];
  pageId?: number;
  cmId?: number;
  viewUrl?: string;
}

export interface FlashcardsPayload {
  title: string;
  scopeSummary: string;
  cardCount: number;
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
  sectionIds?: number[];
  sectionNumbers?: number[];
  pageId?: number;
  cmId?: number;
  viewUrl?: string;
}

export type PendingActionPayload =
  | PracticeQuizPayload
  | StudyGuidePayload
  | FlashcardsPayload;

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
  payload: PendingActionPayload;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: PendingActionStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
