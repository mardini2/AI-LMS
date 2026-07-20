import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  PendingAction,
  PracticeQuizPayload,
  StudyGuidePayload,
} from './entities/pending-action.entity';

const PENDING_TTL_MS = 20 * 60 * 1000;

@Injectable()
export class PendingActionService {
  constructor(
    @InjectRepository(PendingAction)
    private readonly repo: Repository<PendingAction>,
  ) {}

  private async cancelOtherPending(conversationId: string): Promise<void> {
    await this.repo.update(
      {
        conversationId,
        status: 'pending',
      },
      { status: 'cancelled' },
    );
  }

  async createPracticeQuizProposal(input: {
    conversationId: string;
    courseId: number;
    moodleUserId: number;
    payload: PracticeQuizPayload;
  }): Promise<PendingAction> {
    await this.cancelOtherPending(input.conversationId);

    const action = this.repo.create({
      conversationId: input.conversationId,
      courseId: input.courseId,
      moodleUserId: input.moodleUserId,
      type: 'practice_quiz',
      payload: input.payload,
      status: 'pending',
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    });
    return this.repo.save(action);
  }

  async createStudyGuideProposal(input: {
    conversationId: string;
    courseId: number;
    moodleUserId: number;
    payload: StudyGuidePayload;
  }): Promise<PendingAction> {
    await this.cancelOtherPending(input.conversationId);

    const action = this.repo.create({
      conversationId: input.conversationId,
      courseId: input.courseId,
      moodleUserId: input.moodleUserId,
      type: 'study_guide',
      payload: input.payload,
      status: 'pending',
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    });
    return this.repo.save(action);
  }

  async getPendingForConversation(
    conversationId: string,
    moodleUserId: number,
  ): Promise<PendingAction | null> {
    const actions = await this.repo.find({
      where: {
        conversationId,
        moodleUserId,
        status: 'pending',
        type: In(['practice_quiz', 'study_guide']),
      },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    const action = actions[0];
    if (!action) {
      return null;
    }
    if (action.expiresAt.getTime() <= Date.now()) {
      action.status = 'expired';
      await this.repo.save(action);
      return null;
    }
    return action;
  }

  async assertPendingOwned(
    actionId: string,
    moodleUserId: number,
  ): Promise<PendingAction> {
    const action = await this.repo.findOne({ where: { id: actionId } });
    if (!action) {
      throw new NotFoundException('Pending action not found');
    }
    if (action.moodleUserId !== moodleUserId) {
      throw new BadRequestException('Pending action does not belong to this user');
    }
    if (action.status !== 'pending') {
      throw new BadRequestException(`Action is already ${action.status}`);
    }
    if (action.expiresAt.getTime() <= Date.now()) {
      action.status = 'expired';
      await this.repo.save(action);
      throw new BadRequestException('Pending action has expired');
    }
    return action;
  }

  async markConfirmed(actionId: string): Promise<void> {
    await this.repo.update({ id: actionId }, { status: 'confirmed' });
  }

  async markConfirmedWithQuiz(
    actionId: string,
    quiz: {
      quizId: number;
      cmId: number;
      viewUrl: string;
      sectionIds?: number[];
      sectionNumbers?: number[];
    },
  ): Promise<PendingAction> {
    const action = await this.repo.findOne({ where: { id: actionId } });
    if (!action) {
      throw new NotFoundException('Pending action not found');
    }
    if (action.type !== 'practice_quiz') {
      throw new BadRequestException('Action is not a practice quiz');
    }
    const payload = action.payload as PracticeQuizPayload;
    action.status = 'confirmed';
    action.payload = {
      ...payload,
      quizId: quiz.quizId,
      cmId: quiz.cmId,
      viewUrl: quiz.viewUrl,
      ...(quiz.sectionIds !== undefined
        ? { sectionIds: quiz.sectionIds }
        : {}),
      ...(quiz.sectionNumbers !== undefined
        ? { sectionNumbers: quiz.sectionNumbers }
        : {}),
      explainedAt: null,
      explainedAttemptId: null,
    };
    action.expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return this.repo.save(action);
  }

  async markConfirmedWithPage(
    actionId: string,
    page: {
      pageId: number;
      cmId: number;
      viewUrl: string;
      sectionIds?: number[];
      sectionNumbers?: number[];
    },
  ): Promise<PendingAction> {
    const action = await this.repo.findOne({ where: { id: actionId } });
    if (!action) {
      throw new NotFoundException('Pending action not found');
    }
    if (action.type !== 'study_guide') {
      throw new BadRequestException('Action is not a study guide');
    }
    const payload = action.payload as StudyGuidePayload;
    action.status = 'confirmed';
    action.payload = {
      ...payload,
      pageId: page.pageId,
      cmId: page.cmId,
      viewUrl: page.viewUrl,
      ...(page.sectionIds !== undefined
        ? { sectionIds: page.sectionIds }
        : {}),
      ...(page.sectionNumbers !== undefined
        ? { sectionNumbers: page.sectionNumbers }
        : {}),
    };
    action.expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return this.repo.save(action);
  }

  async getConfirmedPracticeQuizForConversation(
    conversationId: string,
    moodleUserId: number,
  ): Promise<PendingAction | null> {
    const actions = await this.repo.find({
      where: {
        conversationId,
        moodleUserId,
        status: 'confirmed',
        type: 'practice_quiz',
      },
      order: { createdAt: 'DESC' },
      take: 5,
    });

    return (
      actions.find((a) => {
        const payload = a.payload as PracticeQuizPayload;
        return typeof payload.quizId === 'number' && payload.quizId > 0;
      }) ?? null
    );
  }

  async markExplained(actionId: string, attemptId: number): Promise<void> {
    const action = await this.repo.findOne({ where: { id: actionId } });
    if (!action) {
      throw new NotFoundException('Pending action not found');
    }
    if (action.type !== 'practice_quiz') {
      throw new BadRequestException('Action is not a practice quiz');
    }
    const payload = action.payload as PracticeQuizPayload;
    action.payload = {
      ...payload,
      explainedAttemptId: attemptId,
      explainedAt: new Date().toISOString(),
    };
    await this.repo.save(action);
  }

  async markCancelled(actionId: string): Promise<void> {
    await this.repo.update({ id: actionId }, { status: 'cancelled' });
  }
}
