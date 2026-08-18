import { Logger } from '@nestjs/common';
import { AiContentMoodleService } from '../../../src/context/ai-content-moodle.service';

type MoodleDouble = {
  callMoodleApi: jest.Mock;
  toPublicMoodleUrl: jest.Mock;
};

type PlacementDouble = {
  ensureStudentPlacement: jest.Mock;
};

describe('AiContentMoodleService', () => {
  let moodle: MoodleDouble;
  let placement: PlacementDouble;
  let service: AiContentMoodleService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    moodle = {
      callMoodleApi: jest.fn(),
      toPublicMoodleUrl: jest.fn((raw: string) => `public:${raw}`),
    };
    placement = {
      ensureStudentPlacement: jest.fn().mockResolvedValue({
        sectionId: 7,
        sectionNum: 3,
        groupId: 21,
        groupName: 'AI Content',
        availabilityJson: '{}',
      }),
    };
    service = new AiContentMoodleService(moodle as never, placement as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('listPrivateContent', () => {
    it('POSTs local_syllentras_ai_list_private_content with courseid/userid', async () => {
      moodle.callMoodleApi.mockResolvedValue({ items: [] });

      await service.listPrivateContent({ courseId: 12, moodleUserId: 42 });

      expect(moodle.callMoodleApi).toHaveBeenCalledWith(
        'local_syllentras_ai_list_private_content',
        { courseid: 12, userid: 42 },
        'POST',
      );
    });

    it('maps items, normalizes kinds, and makes view URLs public', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        items: [
          {
            cmid: 601,
            modname: 'page',
            name: 'Study Guide: Week 1',
            kind: 'study_guide',
            viewurl: 'http://webserver/mod/page/view.php?id=601',
            sortorder: 5,
            timemodified: 1_700_000_000,
          },
          {
            cmid: 602,
            modname: 'quiz',
            name: 'Practice: Cells',
            kind: 'practice_quiz',
            viewurl: 'http://webserver/mod/quiz/view.php?id=602',
            sortorder: 6,
            timemodified: 1_700_000_100,
          },
          {
            cmid: 603,
            modname: 'page',
            name: 'Flashcards',
            kind: 'flashcards',
            viewurl: 'http://webserver/mod/page/view.php?id=603',
            sortorder: 7,
            timemodified: 1_700_000_200,
          },
        ],
      });

      await expect(
        service.listPrivateContent({ courseId: 12, moodleUserId: 42 }),
      ).resolves.toEqual([
        {
          cmId: 601,
          modname: 'page',
          name: 'Study Guide: Week 1',
          kind: 'study_guide',
          viewUrl: 'public:http://webserver/mod/page/view.php?id=601',
          sortOrder: 5,
          timeModified: 1_700_000_000,
        },
        {
          cmId: 602,
          modname: 'quiz',
          name: 'Practice: Cells',
          kind: 'practice_quiz',
          viewUrl: 'public:http://webserver/mod/quiz/view.php?id=602',
          sortOrder: 6,
          timeModified: 1_700_000_100,
        },
        {
          cmId: 603,
          modname: 'page',
          name: 'Flashcards',
          kind: 'flashcards',
          viewUrl: 'public:http://webserver/mod/page/view.php?id=603',
          sortOrder: 7,
          timeModified: 1_700_000_200,
        },
      ]);
    });

    it('maps an unrecognized kind to study_guide', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        items: [
          {
            cmid: 604,
            modname: 'page',
            name: 'Mystery',
            kind: 'something_else',
            viewurl: 'http://webserver/mod/page/view.php?id=604',
            sortorder: 0,
            timemodified: 1,
          },
        ],
      });

      const items = await service.listPrivateContent({
        courseId: 12,
        moodleUserId: 42,
      });

      expect(items[0].kind).toBe('study_guide');
    });

    it('falls back to the array index for sortOrder and 0 for timeModified', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        items: [
          {
            cmid: 601,
            modname: 'page',
            name: 'First',
            kind: 'study_guide',
            viewurl: 'http://webserver/a',
          },
          {
            cmid: 602,
            modname: 'page',
            name: 'Second',
            kind: 'study_guide',
            viewurl: 'http://webserver/b',
            sortorder: '9',
            timemodified: '123',
          },
        ],
      });

      const items = await service.listPrivateContent({
        courseId: 12,
        moodleUserId: 42,
      });

      expect(items[0].sortOrder).toBe(0);
      expect(items[0].timeModified).toBe(0);
      // Non-number sortorder/timemodified are rejected by the typeof guard.
      expect(items[1].sortOrder).toBe(1);
      expect(items[1].timeModified).toBe(0);
    });

    it('returns an empty array when Moodle omits or nulls the items field', async () => {
      moodle.callMoodleApi.mockResolvedValue({});
      await expect(
        service.listPrivateContent({ courseId: 12, moodleUserId: 42 }),
      ).resolves.toEqual([]);

      moodle.callMoodleApi.mockResolvedValue({ items: null });
      await expect(
        service.listPrivateContent({ courseId: 12, moodleUserId: 42 }),
      ).resolves.toEqual([]);
    });

    it('rejects courseId <= 1 and moodleUserId < 1 without calling Moodle', async () => {
      await expect(
        service.listPrivateContent({ courseId: 1, moodleUserId: 42 }),
      ).rejects.toThrow('courseId must be a real course (greater than 1)');
      await expect(
        service.listPrivateContent({ courseId: 12, moodleUserId: 0 }),
      ).rejects.toThrow('moodleUserId must be a positive integer');
      expect(moodle.callMoodleApi).not.toHaveBeenCalled();
    });

    it('propagates Moodle failures unchanged', async () => {
      moodle.callMoodleApi.mockRejectedValue(
        new Error('Moodle API exception: nopermissions'),
      );

      await expect(
        service.listPrivateContent({ courseId: 12, moodleUserId: 42 }),
      ).rejects.toThrow('Moodle API exception: nopermissions');
    });
  });

  describe('renamePrivateActivity', () => {
    beforeEach(() => {
      moodle.callMoodleApi.mockResolvedValue({
        cmid: 601,
        modname: 'page',
        name: 'Renamed Guide',
        kind: 'study_guide',
        viewurl: 'http://webserver/mod/page/view.php?id=601',
      });
    });

    it('ensures placement then POSTs the trimmed name with cmid/userid', async () => {
      await service.renamePrivateActivity({
        courseId: 12,
        moodleUserId: 42,
        cmId: 601,
        name: '  Renamed Guide  ',
      });

      expect(placement.ensureStudentPlacement).toHaveBeenCalledWith(12, 42);
      expect(moodle.callMoodleApi).toHaveBeenCalledWith(
        'local_syllentras_ai_rename_private_activity',
        { cmid: 601, userid: 42, name: 'Renamed Guide' },
        'POST',
      );
    });

    it('maps the response into RenamedAiContent', async () => {
      await expect(
        service.renamePrivateActivity({
          courseId: 12,
          moodleUserId: 42,
          cmId: 601,
          name: 'Renamed Guide',
        }),
      ).resolves.toEqual({
        cmId: 601,
        modname: 'page',
        name: 'Renamed Guide',
        kind: 'study_guide',
        viewUrl: 'public:http://webserver/mod/page/view.php?id=601',
      });
    });

    it('rejects cmId < 1 and blank names before ensuring placement', async () => {
      await expect(
        service.renamePrivateActivity({
          courseId: 12,
          moodleUserId: 42,
          cmId: 0,
          name: 'Guide',
        }),
      ).rejects.toThrow('cmId must be a positive integer');

      await expect(
        service.renamePrivateActivity({
          courseId: 12,
          moodleUserId: 42,
          cmId: 601,
          name: '   ',
        }),
      ).rejects.toThrow('name is required');

      expect(placement.ensureStudentPlacement).not.toHaveBeenCalled();
      expect(moodle.callMoodleApi).not.toHaveBeenCalled();
    });

    it('rejects an invalid course/user pair', async () => {
      await expect(
        service.renamePrivateActivity({
          courseId: 1,
          moodleUserId: 42,
          cmId: 601,
          name: 'Guide',
        }),
      ).rejects.toThrow('courseId must be a real course (greater than 1)');
    });

    it('does not rename when placement fails', async () => {
      placement.ensureStudentPlacement.mockRejectedValue(
        new Error('placement failed'),
      );

      await expect(
        service.renamePrivateActivity({
          courseId: 12,
          moodleUserId: 42,
          cmId: 601,
          name: 'Guide',
        }),
      ).rejects.toThrow('placement failed');

      expect(moodle.callMoodleApi).not.toHaveBeenCalled();
    });
  });

  describe('deletePrivateActivity', () => {
    it('POSTs local_syllentras_ai_delete_private_activity with cmid/userid only', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        cmid: 601,
        courseid: 12,
        modname: 'page',
        kind: 'study_guide',
        deleted: true,
      });

      await service.deletePrivateActivity({
        courseId: 12,
        moodleUserId: 42,
        cmId: 601,
      });

      expect(moodle.callMoodleApi).toHaveBeenCalledWith(
        'local_syllentras_ai_delete_private_activity',
        { cmid: 601, userid: 42 },
        'POST',
      );
    });

    it('maps the response and coerces deleted to a boolean', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        cmid: 601,
        courseid: 12,
        modname: 'quiz',
        kind: 'practice_quiz',
        deleted: 1,
      });

      await expect(
        service.deletePrivateActivity({
          courseId: 12,
          moodleUserId: 42,
          cmId: 601,
        }),
      ).resolves.toEqual({
        cmId: 601,
        courseId: 12,
        modname: 'quiz',
        kind: 'practice_quiz',
        deleted: true,
      });

      moodle.callMoodleApi.mockResolvedValue({
        cmid: 601,
        courseid: 12,
        modname: 'quiz',
        kind: 'practice_quiz',
        deleted: 0,
      });

      await expect(
        service.deletePrivateActivity({
          courseId: 12,
          moodleUserId: 42,
          cmId: 601,
        }),
      ).resolves.toMatchObject({ deleted: false });
    });

    it('rejects cmId < 1 and invalid course/user without calling Moodle', async () => {
      await expect(
        service.deletePrivateActivity({
          courseId: 12,
          moodleUserId: 42,
          cmId: 0,
        }),
      ).rejects.toThrow('cmId must be a positive integer');
      await expect(
        service.deletePrivateActivity({
          courseId: 0,
          moodleUserId: 42,
          cmId: 601,
        }),
      ).rejects.toThrow('courseId must be a real course (greater than 1)');
      expect(moodle.callMoodleApi).not.toHaveBeenCalled();
    });

    it('propagates Moodle failures unchanged', async () => {
      moodle.callMoodleApi.mockRejectedValue(
        new Error('Moodle API exception: invalidcoursemodule'),
      );

      await expect(
        service.deletePrivateActivity({
          courseId: 12,
          moodleUserId: 42,
          cmId: 601,
        }),
      ).rejects.toThrow('Moodle API exception: invalidcoursemodule');
    });
  });

  describe('deletePrivateActivities', () => {
    it('deduplicates, drops non-positive/non-integer ids, and sends userid + cmids', async () => {
      moodle.callMoodleApi.mockResolvedValue({ deleted: [], failed: [] });

      await service.deletePrivateActivities({
        courseId: 12,
        moodleUserId: 42,
        cmIds: [601, 601, 602, 0, -3, 2.5, Number.NaN],
      });

      expect(moodle.callMoodleApi).toHaveBeenCalledWith(
        'local_syllentras_ai_delete_private_activities',
        { userid: 42, cmids: [601, 602] },
        'POST',
      );
    });

    it('partitions the response into mapped deleted and failed entries', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        deleted: [
          {
            cmid: 601,
            courseid: 12,
            modname: 'page',
            kind: 'flashcards',
            deleted: true,
          },
          {
            cmid: 602,
            courseid: 12,
            modname: 'quiz',
            kind: 'unknown_kind',
            deleted: 1,
          },
        ],
        failed: [
          { cmid: 603, message: 'No permission' },
          { cmid: 604, message: '' },
        ],
      });

      await expect(
        service.deletePrivateActivities({
          courseId: 12,
          moodleUserId: 42,
          cmIds: [601, 602, 603, 604],
        }),
      ).resolves.toEqual({
        deleted: [
          {
            cmId: 601,
            courseId: 12,
            modname: 'page',
            kind: 'flashcards',
            deleted: true,
          },
          {
            cmId: 602,
            courseId: 12,
            modname: 'quiz',
            kind: 'study_guide',
            deleted: true,
          },
        ],
        failed: [
          { cmId: 603, message: 'No permission' },
          { cmId: 604, message: 'Could not delete' },
        ],
      });
    });

    it('returns empty deleted/failed lists when Moodle omits both arrays', async () => {
      moodle.callMoodleApi.mockResolvedValue({});

      await expect(
        service.deletePrivateActivities({
          courseId: 12,
          moodleUserId: 42,
          cmIds: [601],
        }),
      ).resolves.toEqual({ deleted: [], failed: [] });
    });

    it('rejects when no valid ids remain after filtering', async () => {
      await expect(
        service.deletePrivateActivities({
          courseId: 12,
          moodleUserId: 42,
          cmIds: [],
        }),
      ).rejects.toThrow('cmIds must include at least one id');

      await expect(
        service.deletePrivateActivities({
          courseId: 12,
          moodleUserId: 42,
          cmIds: [0, -1, 1.5],
        }),
      ).rejects.toThrow('cmIds must include at least one id');

      await expect(
        service.deletePrivateActivities({
          courseId: 12,
          moodleUserId: 42,
          cmIds: undefined as unknown as number[],
        }),
      ).rejects.toThrow('cmIds must include at least one id');

      expect(moodle.callMoodleApi).not.toHaveBeenCalled();
    });

    it('accepts exactly 50 ids but rejects 51', async () => {
      moodle.callMoodleApi.mockResolvedValue({ deleted: [], failed: [] });
      const fifty = Array.from({ length: 50 }, (_, i) => i + 1);

      await expect(
        service.deletePrivateActivities({
          courseId: 12,
          moodleUserId: 42,
          cmIds: fifty,
        }),
      ).resolves.toEqual({ deleted: [], failed: [] });

      await expect(
        service.deletePrivateActivities({
          courseId: 12,
          moodleUserId: 42,
          cmIds: [...fifty, 51],
        }),
      ).rejects.toThrow('At most 50 items can be deleted at once');

      expect(moodle.callMoodleApi).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid course/user pair before validating ids', async () => {
      await expect(
        service.deletePrivateActivities({
          courseId: 1,
          moodleUserId: 42,
          cmIds: [],
        }),
      ).rejects.toThrow('courseId must be a real course (greater than 1)');
    });
  });

  describe('exportPrivateContent', () => {
    it('POSTs local_syllentras_ai_get_private_content_export with cmid/userid', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        cmid: 601,
        modname: 'page',
        kind: 'study_guide',
        name: 'Guide',
        coursename: 'Biology 101',
        contenthtml: '<p>Body</p>',
      });

      await service.exportPrivateContent({
        courseId: 12,
        moodleUserId: 42,
        cmId: 601,
      });

      expect(moodle.callMoodleApi).toHaveBeenCalledWith(
        'local_syllentras_ai_get_private_content_export',
        { cmid: 601, userid: 42 },
        'POST',
      );
    });

    it('maps quiz exports including questions and answers', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        cmid: 602,
        modname: 'quiz',
        kind: 'practice_quiz',
        name: 'Practice: Cells',
        coursename: 'Biology 101',
        contenthtml: '<p>Intro</p>',
        questions: [
          {
            number: 1,
            qtype: 'multichoice',
            questiontext: 'What is 2 + 2?',
            answers: [
              { text: '4', fraction: 1 },
              { text: '5', fraction: 0 },
            ],
          },
        ],
      });

      await expect(
        service.exportPrivateContent({
          courseId: 12,
          moodleUserId: 42,
          cmId: 602,
        }),
      ).resolves.toEqual({
        cmId: 602,
        modname: 'quiz',
        kind: 'practice_quiz',
        name: 'Practice: Cells',
        courseName: 'Biology 101',
        contentHtml: '<p>Intro</p>',
        questions: [
          {
            number: 1,
            qtype: 'multichoice',
            questiontext: 'What is 2 + 2?',
            answers: [
              { text: '4', fraction: 1 },
              { text: '5', fraction: 0 },
            ],
          },
        ],
      });
    });

    it('defaults missing course name, content, questions, answers, and fractions', async () => {
      moodle.callMoodleApi.mockResolvedValue({
        cmid: 601,
        modname: 'page',
        kind: 'weird',
        name: 'Guide',
        questions: [
          { number: 1, qtype: 'essay' },
          {
            number: 2,
            qtype: 'multichoice',
            questiontext: '',
            answers: [{ text: '', fraction: 'not-a-number' }],
          },
        ],
      });

      await expect(
        service.exportPrivateContent({
          courseId: 12,
          moodleUserId: 42,
          cmId: 601,
        }),
      ).resolves.toEqual({
        cmId: 601,
        modname: 'page',
        kind: 'study_guide',
        name: 'Guide',
        courseName: '',
        contentHtml: '',
        questions: [
          { number: 1, qtype: 'essay', questiontext: '', answers: [] },
          {
            number: 2,
            qtype: 'multichoice',
            questiontext: '',
            answers: [{ text: '', fraction: 0 }],
          },
        ],
      });
    });

    it('rejects cmId < 1 and invalid course/user without calling Moodle', async () => {
      await expect(
        service.exportPrivateContent({
          courseId: 12,
          moodleUserId: 42,
          cmId: 0,
        }),
      ).rejects.toThrow('cmId must be a positive integer');
      await expect(
        service.exportPrivateContent({
          courseId: 12,
          moodleUserId: -1,
          cmId: 601,
        }),
      ).rejects.toThrow('moodleUserId must be a positive integer');
      expect(moodle.callMoodleApi).not.toHaveBeenCalled();
    });

    it('propagates Moodle failures unchanged', async () => {
      moodle.callMoodleApi.mockRejectedValue(
        new Error('Moodle API exception: invalidrecord'),
      );

      await expect(
        service.exportPrivateContent({
          courseId: 12,
          moodleUserId: 42,
          cmId: 601,
        }),
      ).rejects.toThrow('Moodle API exception: invalidrecord');
    });
  });

  describe('updatePrivatePage', () => {
    beforeEach(() => {
      moodle.callMoodleApi.mockResolvedValue({
        pageid: 77,
        cmid: 601,
        name: 'Updated Guide',
        viewurl: 'http://webserver/mod/page/view.php?id=601',
      });
    });

    it('POSTs local_syllentras_ai_update_private_page without a name by default', async () => {
      await service.updatePrivatePage({
        courseId: 12,
        moodleUserId: 42,
        cmId: 601,
        contentHtml: '<p>Updated</p>',
      });

      expect(moodle.callMoodleApi).toHaveBeenCalledWith(
        'local_syllentras_ai_update_private_page',
        { cmid: 601, userid: 42, content: '<p>Updated</p>' },
        'POST',
      );
      expect(placement.ensureStudentPlacement).not.toHaveBeenCalled();
    });

    it('includes a trimmed name when supplied and omits blank names', async () => {
      await service.updatePrivatePage({
        courseId: 12,
        moodleUserId: 42,
        cmId: 601,
        contentHtml: '<p>Updated</p>',
        name: '  Updated Guide  ',
      });
      expect(moodle.callMoodleApi.mock.calls[0][1]).toEqual({
        cmid: 601,
        userid: 42,
        content: '<p>Updated</p>',
        name: 'Updated Guide',
      });

      await service.updatePrivatePage({
        courseId: 12,
        moodleUserId: 42,
        cmId: 601,
        contentHtml: '<p>Updated</p>',
        name: '  ',
      });
      expect(moodle.callMoodleApi.mock.calls[1][1]).toEqual({
        cmid: 601,
        userid: 42,
        content: '<p>Updated</p>',
      });
    });

    it('maps the response into CreatedStudyGuide with a public view URL', async () => {
      await expect(
        service.updatePrivatePage({
          courseId: 12,
          moodleUserId: 42,
          cmId: 601,
          contentHtml: '<p>Updated</p>',
        }),
      ).resolves.toEqual({
        pageId: 77,
        cmId: 601,
        name: 'Updated Guide',
        viewUrl: 'public:http://webserver/mod/page/view.php?id=601',
      });
    });

    it('rejects invalid course/user, cmId < 1, and blank content', async () => {
      const base = {
        courseId: 12,
        moodleUserId: 42,
        cmId: 601,
        contentHtml: '<p>Updated</p>',
      };

      await expect(
        service.updatePrivatePage({ ...base, courseId: 1 }),
      ).rejects.toThrow('courseId must be a real course (greater than 1)');
      await expect(
        service.updatePrivatePage({ ...base, cmId: 0 }),
      ).rejects.toThrow('cmId must be a positive integer');
      await expect(
        service.updatePrivatePage({ ...base, contentHtml: '\n\t ' }),
      ).rejects.toThrow('contentHtml is required');

      expect(moodle.callMoodleApi).not.toHaveBeenCalled();
    });
  });
});
