import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PendingAction,
  PracticeQuizPayload,
} from './entities/pending-action.entity';

const PENDING_TTL_MS = 20 * 60 * 1000;

@Injectable()
export class PendingActionService {
  constructor(
    @InjectRepository(PendingAction)
    private readonly repo: Repository<PendingAction>,
  ) {}

  async createPracticeQuizProposal(input: {
    conversationId: string;
    courseId: number;
    moodleUserId: number;
    payload: PracticeQuizPayload;
  }): Promise<PendingAction> {
    await this.repo.update(
      {
        conversationId: input.conversationId,
        status: 'pending',
      },
      { status: 'cancelled' },
    );

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

    async getPendingForConversation(
    conversationId: string,
    moodleUserId: number,
  ): Promise<PendingAction | null> {
    const actions = await this.repo.find({
      where: {
        conversationId,
        moodleUserId,
        status: 'pending',
        type: 'practice_quiz',
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

  async markCancelled(actionId: string): Promise<void> {
    await this.repo.update({ id: actionId }, { status: 'cancelled' });
  }
}
