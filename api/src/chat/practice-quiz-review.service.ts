import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SchemaType } from '@google/generative-ai';
import { ContextService } from '../context/context.service';
import type { CourseContextFilter } from '../context/context.types';
import { PracticeQuizMoodleService } from '../context/practice-quiz-moodle.service';
import { ConversationService } from '../conversation/conversation.service';
import { buildWrongAnswerExplanationPrompt } from './chat.prompts';
import type {
  ChatResponse,
  ReviewBlockDto,
  ReviewOfferDto,
} from './chat.types';
import type { PracticeQuizPayload } from './entities/pending-action.entity';
import { GeminiClient } from './gemini.client';
import { PendingActionService } from './pending-action.service';
import {
  buildPracticeQuizContextFilter,
  buildReviewMessage,
} from './practice-quiz.helpers';

@Injectable()
export class PracticeQuizReviewService {
  private readonly logger = new Logger(PracticeQuizReviewService.name);

  constructor(
    private readonly gemini: GeminiClient,
    private readonly contextService: ContextService,
    private readonly practiceQuizMoodle: PracticeQuizMoodleService,
    private readonly conversationService: ConversationService,
    private readonly pendingActionService: PendingActionService,
  ) {}

  async getReviewOffer(
    conversationId: string,
    moodleUserId: number,
  ): Promise<ReviewOfferDto | null> {
    await this.conversationService.assertOwner(conversationId, moodleUserId);
    const action =
      await this.pendingActionService.getConfirmedPracticeQuizForConversation(
        conversationId,
        moodleUserId,
      );
    const payload = action?.payload as PracticeQuizPayload | undefined;
    if (!payload?.quizId) {
      return null;
    }

    try {
      const review = await this.practiceQuizMoodle.getPracticeAttemptReview(
        payload.quizId,
        moodleUserId,
      );
      if (!review.hasAttempt) {
        return null;
      }

      const explainedAttemptId = payload.explainedAttemptId ?? null;
      if (review.attemptId === explainedAttemptId) {
        return null;
      }

      const wrong = review.questions.filter((q) => !q.iscorrect);
      const total = review.questions.length || payload.questionCount;
      const score = Math.round(review.score);
      const maxScore = Math.round(review.maxScore) || total;

      if (wrong.length === 0) {
        // Perfect score — record this attempt so we don't keep prompting.
        await this.pendingActionService.markExplained(
          action!.id,
          review.attemptId,
        );
        return null;
      }

      return {
        actionId: action!.id,
        quizId: payload.quizId,
        title: payload.title,
        score,
        maxScore,
        wrongCount: wrong.length,
        total,
        scoreLabel: `${score}/${maxScore}`,
      };
    } catch (err) {
      this.logger.warn(
        `Failed to load review offer for conversation ${conversationId}: ${String(err)}`,
      );
      return null;
    }
  }

  async explainWrongAnswers(
    conversationId: string,
    moodleUserId: number,
  ): Promise<ChatResponse> {
    await this.conversationService.assertOwner(conversationId, moodleUserId);
    const action =
      await this.pendingActionService.getConfirmedPracticeQuizForConversation(
        conversationId,
        moodleUserId,
      );
    const payload = action?.payload as PracticeQuizPayload | undefined;
    if (!action || !payload?.quizId) {
      throw new BadRequestException(
        'No practice quiz ready for review in this conversation',
      );
    }

    const attempt = await this.practiceQuizMoodle.getPracticeAttemptReview(
      payload.quizId,
      moodleUserId,
    );
    if (!attempt.hasAttempt) {
      throw new BadRequestException(
        'Finish the practice quiz in Moodle first, then ask me to explain',
      );
    }

    const wrong = attempt.questions.filter((q) => !q.iscorrect);
    if (wrong.length === 0) {
      await this.pendingActionService.markExplained(
        action.id,
        attempt.attemptId,
      );
      const responseText =
        'Nice work — you got everything right on that practice quiz. Nothing to walk through!';
      await this.conversationService.appendMessages(conversationId, [
        { role: 'assistant', content: responseText },
      ]);
      return { response: responseText, conversationId };
    }

    const filter = await this.resolvePracticeQuizFilter({
      courseId: action.courseId,
      payload,
    });

    const reviewBlocks: ReviewBlockDto[] = [];
    for (const q of wrong) {
      const query = `${q.questiontext} ${q.rightanswer}`.trim();
      const [material, citation] = await Promise.all([
        this.contextService.getContext(action.courseId, query, filter),
        this.contextService.findBestCitation(action.courseId, query, filter),
      ]);
      const why = await this.generateWrongAnswerExplanation({
        questiontext: q.questiontext,
        studentanswer: q.studentanswer,
        rightanswer: q.rightanswer,
        courseMaterial: material,
      });

      reviewBlocks.push({
        slot: q.slot,
        question: q.questiontext || q.name,
        studentAnswer: q.studentanswer || '(no answer)',
        rightAnswer: q.rightanswer || '(unavailable)',
        why,
        citationTitle: citation?.title ?? 'Course material',
        citationSnippet: citation?.snippet,
        citationUrl: citation?.url,
      });
    }

    await this.pendingActionService.markExplained(
      action.id,
      attempt.attemptId,
    );

    const score = Math.round(attempt.score);
    const maxScore = Math.round(attempt.maxScore) || attempt.questions.length;
    const responseText = buildReviewMessage({
      title: payload.title,
      score,
      maxScore,
      blocks: reviewBlocks,
    });

    await this.conversationService.appendMessages(conversationId, [
      { role: 'assistant', content: responseText },
    ]);

    return {
      response: responseText,
      conversationId,
      review: reviewBlocks,
    };
  }

  /**
   * Prefer persisted sectionIds from confirm; re-resolve for older actions.
   */
  private async resolvePracticeQuizFilter(action: {
    courseId: number;
    payload: PracticeQuizPayload;
  }): Promise<CourseContextFilter> {
    const payload = action.payload;
    if (payload.sectionIds && payload.sectionIds.length > 0) {
      return buildPracticeQuizContextFilter(payload);
    }

    const resolved = await this.contextService.resolveSectionsFromScope(
      action.courseId,
      payload.scopeSummary,
      {
        sectionId: payload.sectionId,
        sectionNumber: payload.sectionNumber,
        sectionName: payload.sectionName,
      },
    );

    return buildPracticeQuizContextFilter({
      ...payload,
      sectionIds: resolved.sectionIds,
      sectionNumbers: resolved.sectionNumbers,
    });
  }

  private async generateWrongAnswerExplanation(input: {
    questiontext: string;
    studentanswer: string;
    rightanswer: string;
    courseMaterial: string;
  }): Promise<string> {
    const model = this.gemini.getGenerativeModel({
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            why: { type: SchemaType.STRING },
          },
          required: ['why'],
        },
      },
    });

    const prompt = buildWrongAnswerExplanationPrompt(input);

    const result = await model.generateContent(prompt);
    try {
      const parsed = JSON.parse(result.response.text()) as { why?: string };
      const why = (parsed.why ?? '').trim();
      if (why) {
        return why;
      }
    } catch {
      // fall through
    }
    return `The correct answer is "${input.rightanswer}". Your answer ("${input.studentanswer}") did not match. Review the related course section and try a similar question again.`;
  }
}
