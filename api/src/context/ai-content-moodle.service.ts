import { Injectable } from '@nestjs/common';
import type {
  AiContentItem,
  AiContentKind,
  CreatedStudyGuide,
  DeletedAiContent,
  RenamedAiContent,
} from './context.types';
import { MoodleClient } from './moodle-client.service';
import { PracticeQuizMoodleService } from './practice-quiz-moodle.service';

@Injectable()
export class AiContentMoodleService {
  constructor(
    private readonly moodle: MoodleClient,
    private readonly placement: PracticeQuizMoodleService,
  ) {}

  async listPrivateContent(input: {
    courseId: number;
    moodleUserId: number;
  }): Promise<AiContentItem[]> {
    this.assertCourseUser(input.courseId, input.moodleUserId);

    const result = await this.moodle.callMoodleApi<{
      items: Array<{
        cmid: number;
        modname: string;
        name: string;
        kind: string;
        viewurl: string;
      }>;
    }>(
      'local_syllentras_ai_list_private_content',
      {
        courseid: input.courseId,
        userid: input.moodleUserId,
      },
      'POST',
    );

    return (result.items ?? []).map((item) => ({
      cmId: item.cmid,
      modname: item.modname,
      name: item.name,
      kind: this.normalizeKind(item.kind),
      viewUrl: this.moodle.toPublicMoodleUrl(item.viewurl),
    }));
  }

  async renamePrivateActivity(input: {
    courseId: number;
    moodleUserId: number;
    cmId: number;
    name: string;
  }): Promise<RenamedAiContent> {
    this.assertCourseUser(input.courseId, input.moodleUserId);
    if (input.cmId < 1) {
      throw new Error('cmId must be a positive integer');
    }
    const name = input.name.trim();
    if (!name) {
      throw new Error('name is required');
    }

    await this.placement.ensureStudentPlacement(
      input.courseId,
      input.moodleUserId,
    );

    const result = await this.moodle.callMoodleApi<{
      cmid: number;
      modname: string;
      name: string;
      kind: string;
      viewurl: string;
    }>(
      'local_syllentras_ai_rename_private_activity',
      {
        cmid: input.cmId,
        userid: input.moodleUserId,
        name,
      },
      'POST',
    );

    return {
      cmId: result.cmid,
      modname: result.modname,
      name: result.name,
      kind: this.normalizeKind(result.kind),
      viewUrl: this.moodle.toPublicMoodleUrl(result.viewurl),
    };
  }

  async deletePrivateActivity(input: {
    courseId: number;
    moodleUserId: number;
    cmId: number;
  }): Promise<DeletedAiContent> {
    this.assertCourseUser(input.courseId, input.moodleUserId);
    if (input.cmId < 1) {
      throw new Error('cmId must be a positive integer');
    }

    const result = await this.moodle.callMoodleApi<{
      cmid: number;
      courseid: number;
      modname: string;
      kind: string;
      deleted: boolean;
    }>(
      'local_syllentras_ai_delete_private_activity',
      {
        cmid: input.cmId,
        userid: input.moodleUserId,
      },
      'POST',
    );

    return {
      cmId: result.cmid,
      courseId: result.courseid,
      modname: result.modname,
      kind: this.normalizeKind(result.kind),
      deleted: !!result.deleted,
    };
  }

  async updatePrivatePage(input: {
    courseId: number;
    moodleUserId: number;
    cmId: number;
    contentHtml: string;
    name?: string;
  }): Promise<CreatedStudyGuide> {
    this.assertCourseUser(input.courseId, input.moodleUserId);
    if (input.cmId < 1) {
      throw new Error('cmId must be a positive integer');
    }
    if (!input.contentHtml.trim()) {
      throw new Error('contentHtml is required');
    }

    const args: Record<string, string | number> = {
      cmid: input.cmId,
      userid: input.moodleUserId,
      content: input.contentHtml,
    };
    if (input.name?.trim()) {
      args.name = input.name.trim();
    }

    const result = await this.moodle.callMoodleApi<{
      pageid: number;
      cmid: number;
      name: string;
      viewurl: string;
    }>('local_syllentras_ai_update_private_page', args, 'POST');

    return {
      pageId: result.pageid,
      cmId: result.cmid,
      name: result.name,
      viewUrl: this.moodle.toPublicMoodleUrl(result.viewurl),
    };
  }

  private assertCourseUser(courseId: number, moodleUserId: number): void {
    if (courseId <= 1) {
      throw new Error('courseId must be a real course (greater than 1)');
    }
    if (moodleUserId < 1) {
      throw new Error('moodleUserId must be a positive integer');
    }
  }

  private normalizeKind(kind: string): AiContentKind {
    if (kind === 'flashcards' || kind === 'practice_quiz') {
      return kind;
    }
    return 'study_guide';
  }
}
