import { Injectable } from '@nestjs/common';
import type {
  CreatedPracticeQuiz,
  PracticeAttemptReview,
  PracticeQuizQuestion,
  StudentPlacement,
} from './context.types';
import { MoodleClient } from './moodle-client.service';

@Injectable()
export class PracticeQuizMoodleService {
  constructor(private readonly moodle: MoodleClient) {}

  /**
   * Ensure the shared AI Content section and private student group exist.
   * Idempotent Moodle write used by Path A (and later Path B quiz creation).
   */
  async ensureStudentPlacement(
    courseId: number,
    moodleUserId: number,
  ): Promise<StudentPlacement> {
    if (courseId <= 1) {
      throw new Error('courseId must be a real course (greater than 1)');
    }
    if (moodleUserId < 1) {
      throw new Error('moodleUserId must be a positive integer');
    }

    const result = await this.moodle.callMoodleApi<{
      sectionid: number;
      sectionnum: number;
      groupid: number;
      groupname: string;
      availabilityjson: string;
    }>('local_syllentras_ai_ensure_student_placement', {
      courseid: courseId,
      userid: moodleUserId,
    });

    return {
      sectionId: result.sectionid,
      sectionNum: result.sectionnum,
      groupId: result.groupid,
      groupName: result.groupname,
      availabilityJson: result.availabilityjson,
    };
  }

  /**
   * Create a private practice quiz for one student in the AI Content section.
   */
  async createPracticeQuiz(input: {
    courseId: number;
    moodleUserId: number;
    name: string;
    intro?: string;
    questions: PracticeQuizQuestion[];
  }): Promise<CreatedPracticeQuiz> {
    if (input.courseId <= 1) {
      throw new Error('courseId must be a real course (greater than 1)');
    }
    if (input.moodleUserId < 1) {
      throw new Error('moodleUserId must be a positive integer');
    }
    if (!input.questions.length) {
      throw new Error('At least one question is required');
    }

    await this.ensureStudentPlacement(input.courseId, input.moodleUserId);

    const result = await this.moodle.callMoodleApi<{
      quizid: number;
      cmid: number;
      name: string;
      viewurl: string;
    }>(
      'local_syllentras_ai_create_practice_quiz',
      {
        courseid: input.courseId,
        userid: input.moodleUserId,
        name: input.name,
        intro: input.intro ?? '',
        questions: input.questions.map((q) => ({
          type: q.type,
          name: q.name,
          questiontext: q.questiontext,
          answers: q.answers.map((a) => ({
            text: a.text,
            fraction: a.fraction,
          })),
        })),
      },
      'POST',
    );

    return {
      quizId: result.quizid,
      cmId: result.cmid,
      name: result.name,
      viewUrl: this.moodle.toPublicMoodleUrl(result.viewurl),
    };
  }

  /**
   * Latest finished attempt review for a practice quiz (including wrong answers).
   */
  async getPracticeAttemptReview(
    quizId: number,
    moodleUserId: number,
  ): Promise<PracticeAttemptReview> {
    if (quizId < 1) {
      throw new Error('quizId must be a positive integer');
    }
    if (moodleUserId < 1) {
      throw new Error('moodleUserId must be a positive integer');
    }

    const result = await this.moodle.callMoodleApi<{
      hasattempt: boolean | number;
      attemptid: number;
      state: string;
      score: number;
      maxscore: number;
      questions: Array<{
        slot: number;
        name: string;
        questiontext: string;
        studentanswer: string;
        rightanswer: string;
        iscorrect: boolean | number;
        mark: number;
        maxmark: number;
      }>;
    }>('local_syllentras_ai_get_practice_attempt_review', {
      quizid: quizId,
      userid: moodleUserId,
    });

    return {
      hasAttempt: Boolean(result.hasattempt),
      attemptId: result.attemptid,
      state: result.state ?? '',
      score: Number(result.score) || 0,
      maxScore: Number(result.maxscore) || 0,
      questions: (result.questions ?? []).map((q) => ({
        slot: q.slot,
        name: q.name,
        questiontext: q.questiontext,
        studentanswer: q.studentanswer,
        rightanswer: q.rightanswer,
        iscorrect: Boolean(q.iscorrect),
        mark: Number(q.mark) || 0,
        maxmark: Number(q.maxmark) || 0,
      })),
    };
  }
}
