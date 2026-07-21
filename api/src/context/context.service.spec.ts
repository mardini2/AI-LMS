import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import {
  ContextService,
  CourseContextDocument,
  CourseContextFilter,
  matchesSection,
  normalizeSection,
  relevanceScore,
  stripHtml,
} from './context.service';

describe('ContextService', () => {
  let service: ContextService;
  let cache: { get: jest.Mock; set: jest.Mock };
  let config: { get: jest.Mock };
  let callMoodleApi: jest.SpyInstance;
  let getCourseDocuments: jest.SpyInstance;

  beforeEach(() => {
    cache = {
      get: jest.fn(),
      set: jest.fn(),
    };
    config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          MOODLE_INTERNAL_URL: 'http://webserver',
          MOODLE_TOKEN: 'test-token',
          MOODLE_INTERNAL_HOST: 'localhost:8000',
        };
        return values[key];
      }),
    };

    service = new ContextService(
      config as unknown as ConfigService,
      cache as unknown as Cache,
    );

    callMoodleApi = jest.spyOn(
      service as unknown as { callMoodleApi: (...args: unknown[]) => Promise<unknown> },
      'callMoodleApi',
    );
    getCourseDocuments = jest.spyOn(
      service as unknown as {
        getCourseDocuments: (courseId: number) => Promise<CourseContextDocument[]>;
      },
      'getCourseDocuments',
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('resolveCourseName', () => {
    it('returns undefined for courseId <= 1 without calling Moodle', async () => {
      await expect(service.resolveCourseName(1)).resolves.toBeUndefined();
      await expect(service.resolveCourseName(0)).resolves.toBeUndefined();
      await expect(service.resolveCourseName(-5)).resolves.toBeUndefined();

      expect(cache.get).not.toHaveBeenCalled();
      expect(callMoodleApi).not.toHaveBeenCalled();
    });

    it('returns a trimmed providedName without cache or Moodle calls', async () => {
      const name = await service.resolveCourseName(12, '  Intro to Biology  ');

      expect(name).toBe('Intro to Biology');
      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
      expect(callMoodleApi).not.toHaveBeenCalled();
    });

    it('returns cached name on cache hit without calling Moodle', async () => {
      cache.get.mockResolvedValue('Cached Course');

      const name = await service.resolveCourseName(12);

      expect(name).toBe('Cached Course');
      expect(cache.get).toHaveBeenCalledWith('course_name_12');
      expect(callMoodleApi).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('on cache miss calls Moodle, caches the name, and returns it', async () => {
      cache.get.mockResolvedValue(undefined);
      callMoodleApi.mockResolvedValue([
        { id: 12, fullname: 'Organic Chemistry' },
        { id: 99, fullname: 'Other Course' },
      ]);

      const name = await service.resolveCourseName(12);

      expect(callMoodleApi).toHaveBeenCalledWith('core_course_get_courses', {
        options: { ids: [12] },
      });
      expect(cache.set).toHaveBeenCalledWith('course_name_12', 'Organic Chemistry');
      expect(name).toBe('Organic Chemistry');
    });

    it('catches Moodle failures, logs a warning, and returns undefined', async () => {
      cache.get.mockResolvedValue(undefined);
      callMoodleApi.mockRejectedValue(new Error('Moodle down'));
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const name = await service.resolveCourseName(12);

      expect(name).toBeUndefined();
      expect(cache.set).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve course name for 12'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Moodle down'),
      );
    });
  });

  describe('getEnrolledCourseNames', () => {
    it('returns cached names on cache hit without calling Moodle', async () => {
      cache.get.mockResolvedValue(['Course A', 'Course B']);

      const names = await service.getEnrolledCourseNames(42);

      expect(names).toEqual(['Course A', 'Course B']);
      expect(cache.get).toHaveBeenCalledWith('user_courses_42');
      expect(callMoodleApi).not.toHaveBeenCalled();
    });

    it('on cache miss calls Moodle, filters id <= 1, caches and returns names', async () => {
      cache.get.mockResolvedValue(undefined);
      callMoodleApi.mockResolvedValue([
        { id: 1, fullname: 'Site home' },
        { id: 0, fullname: 'Invalid' },
        { id: 5, fullname: 'Biology 101' },
        { id: 8, fullname: '' },
        { id: 9, fullname: 'History 200' },
      ]);

      const names = await service.getEnrolledCourseNames(42);

      expect(callMoodleApi).toHaveBeenCalledWith(
        'core_enrol_get_users_courses',
        { userid: 42 },
      );
      expect(names).toEqual(['Biology 101', 'History 200']);
      expect(cache.set).toHaveBeenCalledWith('user_courses_42', [
        'Biology 101',
        'History 200',
      ]);
    });

    it('catches Moodle failures and returns an empty array', async () => {
      cache.get.mockResolvedValue(undefined);
      callMoodleApi.mockRejectedValue(new Error('network error'));
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const names = await service.getEnrolledCourseNames(42);

      expect(names).toEqual([]);
      expect(names).not.toBeUndefined();
      expect(cache.set).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch enrolled courses for user 42'),
      );
    });
  });

  describe('getContext', () => {
    it('returns empty string for courseId <= 1 without fetching documents', async () => {
      await expect(service.getContext(1, 'What is photosynthesis?')).resolves.toBe(
        '',
      );
      await expect(service.getContext(0, 'Anything')).resolves.toBe('');

      expect(getCourseDocuments).not.toHaveBeenCalled();
      expect(cache.get).not.toHaveBeenCalled();
      expect(callMoodleApi).not.toHaveBeenCalled();
    });
  });
});

describe('stripHtml', () => {
  it('strips script and style tags', () => {
    expect(
      stripHtml(
        'Hello<script>alert(1)</script> world<style>.x{color:red}</style>!',
      ),
    ).toBe('Hello world !');
  });

  it('strips remaining HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('decodes HTML entities', () => {
    expect(
      stripHtml('A &amp; B &lt;C&gt; &quot;quoted&quot; &#39;apos&#39; &nbsp; end'),
    ).toBe('A & B <C> "quoted" \'apos\' end');
  });

  it('collapses whitespace', () => {
    expect(stripHtml('one   \n\t  two')).toBe('one two');
  });
});

describe('normalizeSection', () => {
  it('falls back to General for section 0 when name is $@NULL@$', () => {
    expect(
      normalizeSection({ id: 10, section: 0, name: '$@NULL@$' }),
    ).toMatchObject({
      sectionId: 10,
      sectionNumber: 0,
      sectionName: 'General',
    });
  });

  it('falls back to General for section 0 when name is empty', () => {
    expect(normalizeSection({ id: 10, section: 0, name: '   ' })).toMatchObject({
      sectionName: 'General',
    });
  });

  it('falls back to Section N for non-zero sections with null/empty names', () => {
    expect(
      normalizeSection({ id: 11, section: 3, name: '$@NULL@$' }),
    ).toMatchObject({ sectionName: 'Section 3' });
    expect(normalizeSection({ id: 11, section: 2, name: '' })).toMatchObject({
      sectionName: 'Section 2',
    });
  });

  it('uses a real trimmed name as-is', () => {
    expect(
      normalizeSection({
        id: 12,
        section: 1,
        name: '  Week 1: Intro  ',
        summary: '<p>Overview</p>',
      }),
    ).toEqual({
      sectionId: 12,
      sectionNumber: 1,
      sectionName: 'Week 1: Intro',
      summary: 'Overview',
    });
  });
});

describe('matchesSection', () => {
  const doc: CourseContextDocument = {
    courseId: 5,
    sectionId: 100,
    sectionNumber: 2,
    sectionName: 'Week Two',
    contentType: 'section_summary',
    text: 'content',
  };

  it('matches on sectionId', () => {
    const filter: CourseContextFilter = { sectionId: 100 };
    expect(matchesSection(doc, filter)).toBe(true);
  });

  it('matches on sectionNumber when sectionId does not match', () => {
    expect(
      matchesSection(doc, { sectionId: 999, sectionNumber: 2 }),
    ).toBe(true);
  });

  it('matches on case-insensitive sectionName', () => {
    expect(matchesSection(doc, { sectionName: 'week two' })).toBe(true);
    expect(matchesSection(doc, { sectionName: 'WEEK TWO' })).toBe(true);
  });

  it('returns false when nothing in the filter matches', () => {
    expect(matchesSection(doc, {})).toBe(false);
    expect(
      matchesSection(doc, {
        sectionId: 1,
        sectionNumber: 9,
        sectionName: 'Other',
      }),
    ).toBe(false);
  });
});

describe('relevanceScore', () => {
  const doc: CourseContextDocument = {
    courseId: 5,
    sectionName: 'Cell Biology',
    moduleName: 'Mitosis Lab',
    fileName: 'division.pdf',
    contentType: 'resource_pdf',
    text: 'Chromosomes separate during anaphase.',
  };

  it('counts how many question terms appear in the concatenated fields', () => {
    expect(
      relevanceScore(doc, ['biology', 'mitosis', 'anaphase', 'meiosis']),
    ).toBe(3);
  });

  it('matches terms case-insensitively against document fields', () => {
    // Callers (formatDocumentsForPrompt) lowercase terms before scoring;
    // the haystack is lowercased inside relevanceScore.
    expect(relevanceScore(doc, ['biology', 'mitosis'])).toBe(2);
  });

  it('returns 0 when no terms appear', () => {
    expect(relevanceScore(doc, ['photosynthesis', 'gravity'])).toBe(0);
  });
});
