import { Injectable } from '@nestjs/common';
import type { CreatedStudyGuide } from './context.types';
import { MoodleClient } from './moodle-client.service';
import { PracticeQuizMoodleService } from './practice-quiz-moodle.service';

@Injectable()
export class StudyGuideMoodleService {
  constructor(
    private readonly moodle: MoodleClient,
    private readonly placement: PracticeQuizMoodleService,
  ) {}

  /**
   * Create a private AI Content Page for one student (study guide, flashcards, etc.).
   */
  async createPrivatePage(input: {
    courseId: number;
    moodleUserId: number;
    name: string;
    intro?: string;
    contentHtml: string;
  }): Promise<CreatedStudyGuide> {
    return this.createStudyGuide(input);
  }

  /**
   * @deprecated Prefer createPrivatePage — same Moodle WS.
   */
  async createStudyGuide(input: {
    courseId: number;
    moodleUserId: number;
    name: string;
    intro?: string;
    contentHtml: string;
  }): Promise<CreatedStudyGuide> {
    if (input.courseId <= 1) {
      throw new Error('courseId must be a real course (greater than 1)');
    }
    if (input.moodleUserId < 1) {
      throw new Error('moodleUserId must be a positive integer');
    }
    if (!input.contentHtml.trim()) {
      throw new Error('contentHtml is required');
    }

    await this.placement.ensureStudentPlacement(
      input.courseId,
      input.moodleUserId,
    );

    const result = await this.moodle.callMoodleApi<{
      pageid: number;
      cmid: number;
      name: string;
      viewurl: string;
    }>(
      'local_syllentras_ai_create_study_guide',
      {
        courseid: input.courseId,
        userid: input.moodleUserId,
        name: input.name,
        intro: input.intro ?? '',
        content: input.contentHtml,
      },
      'POST',
    );

    return {
      pageId: result.pageid,
      cmId: result.cmid,
      name: result.name,
      viewUrl: this.moodle.toPublicMoodleUrl(result.viewurl),
    };
  }

  /**
   * Update HTML content of an existing private AI Content Page.
   */
  async updatePrivatePage(input: {
    courseId: number;
    moodleUserId: number;
    cmId: number;
    contentHtml: string;
  }): Promise<CreatedStudyGuide> {
    if (input.courseId <= 1) {
      throw new Error('courseId must be a real course (greater than 1)');
    }
    if (input.moodleUserId < 1) {
      throw new Error('moodleUserId must be a positive integer');
    }
    if (input.cmId < 1) {
      throw new Error('cmId must be a positive integer');
    }
    if (!input.contentHtml.trim()) {
      throw new Error('contentHtml is required');
    }

    const result = await this.moodle.callMoodleApi<{
      pageid: number;
      cmid: number;
      name: string;
      viewurl: string;
    }>(
      'local_syllentras_ai_update_private_page',
      {
        cmid: input.cmId,
        userid: input.moodleUserId,
        content: input.contentHtml,
      },
      'POST',
    );

    return {
      pageId: result.pageid,
      cmId: result.cmid,
      name: result.name,
      viewUrl: this.moodle.toPublicMoodleUrl(result.viewurl),
    };
  }
}
