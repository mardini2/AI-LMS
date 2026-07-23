import { Injectable } from '@nestjs/common';
import type {
  AiContentItem,
  AiContentKind,
  CreatedStudyGuide,
  DeletedAiContent,
  DeletedAiContentBatch,
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
        sortorder?: number;
        timemodified?: number;
      }>;
    }>(
      'local_syllentras_ai_list_private_content',
      {
        courseid: input.courseId,
        userid: input.moodleUserId,
      },
      'POST',
    );

    return (result.items ?? []).map((item, index) => ({
      cmId: item.cmid,
      modname: item.modname,
      name: item.name,
      kind: this.normalizeKind(item.kind),
      viewUrl: this.moodle.toPublicMoodleUrl(item.viewurl),
      sortOrder:
        typeof item.sortorder === 'number' ? item.sortorder : index,
      timeModified:
        typeof item.timemodified === 'number' ? item.timemodified : 0,
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

  async deletePrivateActivities(input: {
    courseId: number;
    moodleUserId: number;
    cmIds: number[];
  }): Promise<DeletedAiContentBatch> {
    this.assertCourseUser(input.courseId, input.moodleUserId);
    const cmIds = [
      ...new Set(
        (input.cmIds ?? [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ];
    if (cmIds.length < 1) {
      throw new Error('cmIds must include at least one id');
    }
    if (cmIds.length > 50) {
      throw new Error('At most 50 items can be deleted at once');
    }

    const result = await this.moodle.callMoodleApi<{
      deleted: Array<{
        cmid: number;
        courseid: number;
        modname: string;
        kind: string;
        deleted: boolean;
      }>;
      failed: Array<{
        cmid: number;
        message: string;
      }>;
    }>(
      'local_syllentras_ai_delete_private_activities',
      {
        userid: input.moodleUserId,
        cmids: cmIds,
      },
      'POST',
    );

    return {
      deleted: (result.deleted ?? []).map((item) => ({
        cmId: item.cmid,
        courseId: item.courseid,
        modname: item.modname,
        kind: this.normalizeKind(item.kind),
        deleted: !!item.deleted,
      })),
      failed: (result.failed ?? []).map((item) => ({
        cmId: item.cmid,
        message: item.message || 'Could not delete',
      })),
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
