jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn(),
}));

import { Logger } from '@nestjs/common';
import { ContextService } from '../../../src/context/context.service';
import type { CourseContextDocument } from '../../../src/context/context.types';

const SECTION_NUMBER_NOTE =
  'Note: resource/topic numbers in titles are not course week numbers; use course_section above.';

const COURSE_ID = 12;
const DOCUMENT_CACHE_KEY = `course_context_documents_v4_${COURSE_ID}`;

type PrivateService = {
  getCourseDocuments: (courseId: number) => Promise<CourseContextDocument[]>;
  fetchCourseDocuments: (courseId: number) => Promise<CourseContextDocument[]>;
  fetchPages: (courseId: number) => Promise<unknown[]>;
  fetchAssignments: (courseId: number) => Promise<unknown[]>;
  fetchForums: (courseId: number) => Promise<unknown[]>;
  fetchFileDocument: (
    ...args: unknown[]
  ) => Promise<CourseContextDocument | null>;
  fetchForumPosts: (forum: unknown) => Promise<unknown[]>;
};

function asPrivate(service: ContextService): PrivateService {
  return service as unknown as PrivateService;
}

type MoodleDouble = {
  callMoodleApi: jest.Mock;
  downloadMoodleFile: jest.Mock;
  toBrowserCitationUrl: jest.Mock;
};

type CacheDouble = { get: jest.Mock; set: jest.Mock };

function createService(): {
  service: ContextService;
  moodle: MoodleDouble;
  cache: CacheDouble;
} {
  const moodle: MoodleDouble = {
    callMoodleApi: jest.fn(),
    downloadMoodleFile: jest.fn(),
    toBrowserCitationUrl: jest.fn(),
  };
  const cache: CacheDouble = { get: jest.fn(), set: jest.fn() };
  const service = new ContextService(moodle as never, cache as never);
  return { service, moodle, cache };
}

function sectionDoc(
  sectionId: number,
  sectionNumber: number,
  sectionName: string | undefined,
): CourseContextDocument {
  return {
    courseId: COURSE_ID,
    sectionId,
    sectionNumber,
    sectionName,
    contentType: 'section_summary',
    text: `summary of section ${sectionNumber}`,
  };
}

describe('ContextService.getContext (context assembly)', () => {
  let service: ContextService;

  const bonding: CourseContextDocument = {
    courseId: COURSE_ID,
    courseName: 'Chemistry',
    sectionId: 101,
    sectionNumber: 2,
    sectionName: 'Week 2',
    moduleId: 55,
    moduleName: 'Bonding Notes',
    contentType: 'resource_pdf',
    fileName: 'bonding.pdf',
    source: 'https://moodle.test/pluginfile.php/1/bonding.pdf',
    lastUpdated: 1_700_000_000,
    text: 'Covalent bonds share electrons.',
  };

  const intro: CourseContextDocument = {
    courseId: COURSE_ID,
    courseName: 'Chemistry',
    sectionId: 100,
    sectionNumber: 1,
    sectionName: 'Week 1',
    contentType: 'section_summary',
    text: 'Introduction week.',
  };

  beforeEach(() => {
    ({ service } = createService());
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders every document as a metadata block, most relevant first', async () => {
    jest
      .spyOn(asPrivate(service), 'getCourseDocuments')
      .mockResolvedValue([intro, bonding]);

    const context = await service.getContext(
      COURSE_ID,
      'Explain covalent bonds',
    );

    expect(context).toBe(
      [
        '### Course section: Week 2 / Bonding Notes',
        SECTION_NUMBER_NOTE,
        `Metadata: type=resource_pdf; course=Chemistry; course_section=Week 2; module=Bonding Notes; file=bonding.pdf; source=https://moodle.test/pluginfile.php/1/bonding.pdf; updated=${new Date(1_700_000_000 * 1000).toISOString()}`,
        'Covalent bonds share electrons.',
        '',
        '### Course section: Week 1',
        SECTION_NUMBER_NOTE,
        'Metadata: type=section_summary; course=Chemistry; course_section=Week 1',
        'Introduction week.',
      ].join('\n'),
    );
  });

  it('puts documents from the filtered section first even when less relevant', async () => {
    jest
      .spyOn(asPrivate(service), 'getCourseDocuments')
      .mockResolvedValue([bonding, intro]);

    const context = await service.getContext(
      COURSE_ID,
      'Explain covalent bonds',
      { sectionNumber: 1 },
    );

    expect(context.indexOf('Introduction week.')).toBeLessThan(
      context.indexOf('Covalent bonds share electrons.'),
    );
  });

  it('omits out-of-scope documents entirely under a hard section scope', async () => {
    jest
      .spyOn(asPrivate(service), 'getCourseDocuments')
      .mockResolvedValue([bonding, intro]);

    const context = await service.getContext(
      COURSE_ID,
      'Explain covalent bonds',
      { sectionIds: [100], hardSectionScope: true },
    );

    expect(context).toContain('Introduction week.');
    expect(context).not.toContain('Covalent bonds share electrons.');
    expect(context).not.toContain('Week 2');
  });

  it('returns an empty string when the course has no documents', async () => {
    jest
      .spyOn(asPrivate(service), 'getCourseDocuments')
      .mockResolvedValue([]);

    await expect(service.getContext(COURSE_ID, 'anything')).resolves.toBe('');
  });

  it('returns an empty string when a hard scope excludes every document', async () => {
    jest
      .spyOn(asPrivate(service), 'getCourseDocuments')
      .mockResolvedValue([bonding, intro]);

    await expect(
      service.getContext(COURSE_ID, 'anything', {
        sectionNumbers: [42],
        hardSectionScope: true,
      }),
    ).resolves.toBe('');
  });
});

describe('ContextService document cache', () => {
  let service: ContextService;
  let cache: CacheDouble;
  let fetchCourseDocuments: jest.SpyInstance;

  const documents: CourseContextDocument[] = [
    {
      courseId: COURSE_ID,
      sectionName: 'Week 1',
      contentType: 'section_summary',
      text: 'Cached week one summary.',
    },
  ];

  beforeEach(() => {
    ({ service, cache } = createService());
    fetchCourseDocuments = jest.spyOn(
      asPrivate(service),
      'fetchCourseDocuments',
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the versioned cache key and skips Moodle on a cache hit', async () => {
    cache.get.mockResolvedValue(documents);

    const context = await service.getContext(COURSE_ID, 'week one');

    expect(cache.get).toHaveBeenCalledWith(DOCUMENT_CACHE_KEY);
    expect(context).toContain('Cached week one summary.');
    expect(fetchCourseDocuments).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('writes the fetched documents under the versioned key with no extra options', async () => {
    cache.get.mockResolvedValue(undefined);
    fetchCourseDocuments.mockResolvedValue(documents);

    await service.getContext(COURSE_ID, 'week one');

    expect(fetchCourseDocuments).toHaveBeenCalledWith(COURSE_ID);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set.mock.calls[0]).toEqual([DOCUMENT_CACHE_KEY, documents]);
  });

  it('shares one in-flight Moodle fetch between concurrent callers', async () => {
    cache.get.mockResolvedValue(undefined);
    let release!: (docs: CourseContextDocument[]) => void;
    fetchCourseDocuments.mockImplementation(
      () =>
        new Promise<CourseContextDocument[]>((resolve) => {
          release = resolve;
        }),
    );

    const first = service.getContext(COURSE_ID, 'week one');
    const second = service.resolveSectionsFromScope(COURSE_ID, 'week one');
    // Both callers get past the awaited cache read before either fetch starts.
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchCourseDocuments).toHaveBeenCalledTimes(1);

    release(documents);

    await expect(first).resolves.toContain('Cached week one summary.');
    await expect(second).resolves.toEqual({
      sectionIds: [],
      sectionNumbers: [],
    });
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it('releases the in-flight entry so a later caller fetches again', async () => {
    cache.get.mockResolvedValue(undefined);
    fetchCourseDocuments.mockResolvedValue(documents);

    await service.getContext(COURSE_ID, 'week one');
    await service.getContext(COURSE_ID, 'week one');

    expect(fetchCourseDocuments).toHaveBeenCalledTimes(2);
  });

  it('propagates a fetch failure and does not cache a poisoned in-flight promise', async () => {
    cache.get.mockResolvedValue(undefined);
    fetchCourseDocuments
      .mockRejectedValueOnce(new Error('Moodle API error: 500'))
      .mockResolvedValue(documents);

    await expect(service.getContext(COURSE_ID, 'week one')).rejects.toThrow(
      'Moodle API error: 500',
    );
    expect(cache.set).not.toHaveBeenCalled();

    await expect(service.getContext(COURSE_ID, 'week one')).resolves.toContain(
      'Cached week one summary.',
    );
    expect(fetchCourseDocuments).toHaveBeenCalledTimes(2);
  });
});

describe('ContextService.resolveSectionsFromScope', () => {
  let service: ContextService;
  let getCourseDocuments: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  /** Sections named by week, plus an unnamed one and a topic-only name. */
  const weekSections: CourseContextDocument[] = [
    sectionDoc(100, 0, 'General'),
    sectionDoc(101, 1, 'Week 1: Cell Biology'),
    sectionDoc(102, 2, 'Week 2: Photosynthesis'),
    sectionDoc(103, 3, 'Week 3: Genetics'),
    sectionDoc(104, 4, 'Respiration'),
    sectionDoc(105, 5, undefined),
  ];

  function withDocuments(documents: CourseContextDocument[]): void {
    getCourseDocuments.mockResolvedValue(documents);
  }

  beforeEach(() => {
    ({ service } = createService());
    getCourseDocuments = jest.spyOn(asPrivate(service), 'getCourseDocuments');
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns an empty scope for courseId <= 1 without fetching documents', async () => {
    await expect(service.resolveSectionsFromScope(1, 'week 2')).resolves.toEqual(
      { sectionIds: [], sectionNumbers: [] },
    );
    await expect(service.resolveSectionsFromScope(0, 'week 2')).resolves.toEqual(
      { sectionIds: [], sectionNumbers: [] },
    );
    expect(getCourseDocuments).not.toHaveBeenCalled();
  });

  it('returns an empty scope when the course has no sectioned documents', async () => {
    withDocuments([
      { courseId: COURSE_ID, contentType: 'course_summary', text: 'overview' },
    ]);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'week 2'),
    ).resolves.toEqual({ sectionIds: [], sectionNumbers: [] });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('resolves a single named week to that section only', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'Quiz me on week 2'),
    ).resolves.toEqual({ sectionIds: [102], sectionNumbers: [2] });
    expect(logSpy).toHaveBeenCalledWith(
      'Resolved quiz scope to [Week 2: Photosynthesis] for course 12',
    );
  });

  it('resolves a week range to every section in the range', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'weeks 1-3 review'),
    ).resolves.toEqual({
      sectionIds: [101, 102, 103],
      sectionNumbers: [1, 2, 3],
    });
  });

  it('matches "section N" against the Moodle topic index rather than the name', async () => {
    withDocuments(weekSections);

    // Topic index 4 is "Respiration"; nothing is named "Section 4".
    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'cover section 4'),
    ).resolves.toEqual({ sectionIds: [104], sectionNumbers: [4] });
  });

  it('labels an unnamed section by its topic index when logging', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'cover section 5'),
    ).resolves.toEqual({ sectionIds: [105], sectionNumbers: [5] });
    expect(logSpy).toHaveBeenCalledWith(
      'Resolved quiz scope to [section 5] for course 12',
    );
  });

  it('matches a section by its name when no week or index is mentioned', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'a quiz about respiration'),
    ).resolves.toEqual({ sectionIds: [104], sectionNumbers: [4] });
  });

  it('reports each section once when week and index references overlap', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'week 1 and section 1'),
    ).resolves.toEqual({ sectionIds: [101], sectionNumbers: [1] });
  });

  it('never falls back to the topic index for an unmatched week number', async () => {
    withDocuments([
      sectionDoc(200, 1, 'Cells'),
      sectionDoc(201, 2, 'Plants'),
      sectionDoc(202, 3, 'Genes'),
    ]);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'week 3'),
    ).resolves.toEqual({
      sectionIds: [],
      sectionNumbers: [],
      unresolvedSpecificScope: true,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Could not resolve scope "week 3" to Moodle sections for course 12 (weeks: 3)',
    );
  });

  it('flags an unresolvable topic index and names it in the warning', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'section 42'),
    ).resolves.toEqual({
      sectionIds: [],
      sectionNumbers: [],
      unresolvedSpecificScope: true,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Could not resolve scope "section 42" to Moodle sections for course 12 (section indexes: 42)',
    );
  });

  it('reports both weeks and topic indexes in the warning when both are unresolved', async () => {
    withDocuments(weekSections);

    await service.resolveSectionsFromScope(
      COURSE_ID,
      'week 9 and section 42 please',
    );

    expect(warnSpy).toHaveBeenCalledWith(
      'Could not resolve scope "week 9 and section 42 please" to Moodle sections for course 12 (weeks: 9) (section indexes: 42)',
    );
  });

  it('ignores the conversation hint when specific weeks were named but unresolved', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'week 9', {
        sectionId: 103,
      }),
    ).resolves.toEqual({
      sectionIds: [],
      sectionNumbers: [],
      unresolvedSpecificScope: true,
    });
  });

  it('prefers an explicitly named week over the conversation hint', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'week 1', {
        sectionId: 103,
      }),
    ).resolves.toEqual({ sectionIds: [101], sectionNumbers: [1] });
  });

  it('falls back to the conversation hint section id for a general scope', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'a broad review of everything', {
        sectionId: 102,
      }),
    ).resolves.toEqual({ sectionIds: [102], sectionNumbers: [2] });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('matches a section named in the scope even when a hint points elsewhere', async () => {
    withDocuments(weekSections);

    // "General" is a real section name, so a scope mentioning it wins over the hint.
    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'general review', {
        sectionId: 102,
      }),
    ).resolves.toEqual({ sectionIds: [100], sectionNumbers: [0] });
  });

  it('accepts a conversation hint for topic index 0', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'help me study', {
        sectionNumber: 0,
      }),
    ).resolves.toEqual({ sectionIds: [100], sectionNumbers: [0] });
  });

  it('matches a conversation hint section name case-insensitively', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'help me study', {
        sectionName: 'wEEk 3: gEnEtics',
      }),
    ).resolves.toEqual({ sectionIds: [103], sectionNumbers: [3] });
  });

  it('treats hint fields as alternatives, returning every section any field matches', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'help me study', {
        sectionId: 102,
        sectionNumber: 1,
      }),
    ).resolves.toEqual({ sectionIds: [101, 102], sectionNumbers: [1, 2] });
  });

  it('returns an empty scope when the conversation hint matches no section', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'help me study', {
        sectionId: 999,
      }),
    ).resolves.toEqual({ sectionIds: [], sectionNumbers: [] });
  });

  it('returns an empty scope for a general topic with no hint', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(COURSE_ID, 'osmosis and diffusion'),
    ).resolves.toEqual({ sectionIds: [], sectionNumbers: [] });
    await expect(
      service.resolveSectionsFromScope(COURSE_ID, '   '),
    ).resolves.toEqual({ sectionIds: [], sectionNumbers: [] });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('tolerates a missing scope summary from untyped callers', async () => {
    withDocuments(weekSections);

    await expect(
      service.resolveSectionsFromScope(
        COURSE_ID,
        undefined as unknown as string,
      ),
    ).resolves.toEqual({ sectionIds: [], sectionNumbers: [] });
  });
});

describe('ContextService.findBestCitation', () => {
  let service: ContextService;
  let moodle: MoodleDouble;
  let getCourseDocuments: jest.SpyInstance;

  const inScope: CourseContextDocument = {
    courseId: COURSE_ID,
    sectionId: 100,
    sectionNumber: 1,
    sectionName: 'Week 1',
    moduleName: 'Bonding Notes',
    contentType: 'resource_pdf',
    fileName: 'bonding.pdf',
    source: 'http://webserver/webservice/pluginfile.php/1/bonding.pdf',
    text: 'Covalent bonds share electrons between atoms.',
  };

  const outOfScope: CourseContextDocument = {
    courseId: COURSE_ID,
    sectionId: 101,
    sectionNumber: 2,
    sectionName: 'Week 2',
    contentType: 'section_summary',
    source: 'section:101',
    text: 'Covalent bonds electrons atoms orbitals hybridisation overview.',
  };

  beforeEach(() => {
    ({ service, moodle } = createService());
    getCourseDocuments = jest.spyOn(asPrivate(service), 'getCourseDocuments');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns null for courseId <= 1 without fetching documents', async () => {
    await expect(service.findBestCitation(1, 'bonds')).resolves.toBeNull();
    expect(getCourseDocuments).not.toHaveBeenCalled();
  });

  it('returns null when the course has no documents', async () => {
    getCourseDocuments.mockResolvedValue([]);

    await expect(
      service.findBestCitation(COURSE_ID, 'bonds'),
    ).resolves.toBeNull();
  });

  it('returns null when the best document has no usable text', async () => {
    getCourseDocuments.mockResolvedValue([
      { ...inScope, text: '   \n\t ' },
    ]);

    await expect(
      service.findBestCitation(COURSE_ID, 'bonds'),
    ).resolves.toBeNull();
  });

  it('returns null when a hard section scope excludes every document', async () => {
    getCourseDocuments.mockResolvedValue([inScope, outOfScope]);

    await expect(
      service.findBestCitation(COURSE_ID, 'bonds', {
        sectionNumbers: [9],
        hardSectionScope: true,
      }),
    ).resolves.toBeNull();
  });

  it('builds the citation title from section and resource and rewrites the file URL', async () => {
    getCourseDocuments.mockResolvedValue([inScope]);
    moodle.toBrowserCitationUrl.mockReturnValue(
      'http://webserver/pluginfile.php/1/bonding.pdf',
    );

    await expect(
      service.findBestCitation(COURSE_ID, 'covalent bonds'),
    ).resolves.toEqual({
      title: 'Week 1 \u2014 Bonding Notes',
      url: 'http://webserver/pluginfile.php/1/bonding.pdf',
      snippet: 'Covalent bonds share electrons between atoms.',
    });
    expect(moodle.toBrowserCitationUrl).toHaveBeenCalledWith(
      'http://webserver/webservice/pluginfile.php/1/bonding.pdf',
    );
  });

  it('omits the url for a non-http source', async () => {
    getCourseDocuments.mockResolvedValue([outOfScope]);

    const citation = await service.findBestCitation(
      COURSE_ID,
      'covalent bonds',
    );

    expect(citation).toEqual({
      title: 'Week 2',
      url: undefined,
      snippet: 'Covalent bonds electrons atoms orbitals hybridisation overview.',
    });
    expect(moodle.toBrowserCitationUrl).not.toHaveBeenCalled();
  });

  it('honours the section filter when choosing the document to cite', async () => {
    getCourseDocuments.mockResolvedValue([outOfScope, inScope]);
    moodle.toBrowserCitationUrl.mockImplementation((url: string) => url);

    const citation = await service.findBestCitation(
      COURSE_ID,
      'covalent bonds electrons atoms orbitals hybridisation',
      { sectionNumber: 1 },
    );

    expect(citation?.title).toBe('Week 1 \u2014 Bonding Notes');
  });

  it('collapses whitespace in the snippet', async () => {
    getCourseDocuments.mockResolvedValue([
      { ...outOfScope, text: '  Multiple   spaces\n\nand\tnewlines  ' },
    ]);

    const citation = await service.findBestCitation(COURSE_ID, 'spaces');

    expect(citation?.snippet).toBe('Multiple spaces and newlines');
  });

  it('keeps a snippet of exactly 220 characters intact', async () => {
    const text = 'y'.repeat(220);
    getCourseDocuments.mockResolvedValue([{ ...outOfScope, text }]);

    const citation = await service.findBestCitation(COURSE_ID, 'anything');

    expect(citation?.snippet).toBe(text);
    expect(citation?.snippet).toHaveLength(220);
  });

  it('truncates a snippet longer than 220 characters', async () => {
    getCourseDocuments.mockResolvedValue([
      { ...outOfScope, text: `${'x'.repeat(219)}END` },
    ]);

    const citation = await service.findBestCitation(COURSE_ID, 'anything');

    expect(citation?.snippet).toBe(`${'x'.repeat(219)}E`);
    expect(citation?.snippet).toHaveLength(220);
  });
});

describe('ContextService.fetchCourseDocuments module metadata', () => {
  let service: ContextService;
  let moodle: MoodleDouble;
  let fetchAssignments: jest.SpyInstance;
  let fetchFileDocument: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  function mockMoodle(options: {
    course?: { id: number; fullname: string; summary?: string } | Error;
    sections?: unknown[];
  }): void {
    moodle.callMoodleApi.mockImplementation(async (wsfunction: string) => {
      if (wsfunction === 'core_course_get_courses') {
        if (options.course instanceof Error) {
          throw options.course;
        }
        return options.course ? [options.course] : [];
      }
      if (wsfunction === 'core_course_get_contents') {
        return options.sections ?? [];
      }
      throw new Error(`Unexpected wsfunction ${wsfunction}`);
    });
  }

  function fetchCourseDocuments(): Promise<CourseContextDocument[]> {
    return asPrivate(service).fetchCourseDocuments(COURSE_ID);
  }

  beforeEach(() => {
    ({ service, moodle } = createService());
    jest.spyOn(asPrivate(service), 'fetchPages').mockResolvedValue([]);
    fetchAssignments = jest
      .spyOn(asPrivate(service), 'fetchAssignments')
      .mockResolvedValue([]);
    jest.spyOn(asPrivate(service), 'fetchForums').mockResolvedValue([]);
    jest.spyOn(asPrivate(service), 'fetchForumPosts').mockResolvedValue([]);
    fetchFileDocument = jest.spyOn(asPrivate(service), 'fetchFileDocument');
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('takes lastUpdated from the first module date that has a timestamp', async () => {
    mockMoodle({
      course: { id: COURSE_ID, fullname: 'Chem' },
      sections: [
        {
          id: 100,
          section: 1,
          name: 'Week 1',
          modules: [
            {
              id: 50,
              name: 'Lab Guide',
              modname: 'resource',
              description: '<p>Read first</p>',
              dates: [{}, { timestamp: 1_700_000_555 }, { timestamp: 1 }],
            },
          ],
        },
      ],
    });

    const docs = await fetchCourseDocuments();

    expect(docs).toHaveLength(1);
    expect(docs[0].lastUpdated).toBe(1_700_000_555);
  });

  it('leaves lastUpdated undefined when no module date carries a timestamp', async () => {
    mockMoodle({
      course: { id: COURSE_ID, fullname: 'Chem' },
      sections: [
        {
          id: 100,
          section: 1,
          name: 'Week 1',
          modules: [
            {
              id: 50,
              name: 'Lab Guide',
              modname: 'resource',
              description: '<p>Read first</p>',
              dates: [{}, { timestamp: 0 }],
            },
          ],
        },
      ],
    });

    const docs = await fetchCourseDocuments();

    expect(docs).toHaveLength(1);
    expect(docs[0].lastUpdated).toBeUndefined();
  });

  it('ingests assignment intro attachments and skips attachments without a file url', async () => {
    const attachmentDoc: CourseContextDocument = {
      courseId: COURSE_ID,
      contentType: 'assign_pdf',
      fileName: 'rubric.pdf',
      text: 'Grading rubric',
    };
    fetchFileDocument.mockResolvedValue(attachmentDoc);
    fetchAssignments.mockResolvedValue([
      {
        cmid: 70,
        name: 'Homework 1',
        introattachments: [
          { filename: 'no-url.pdf', filepath: '/', mimetype: 'application/pdf' },
          {
            filename: 'rubric.pdf',
            filepath: '/',
            fileurl: 'http://webserver/pluginfile.php/1/rubric.pdf',
            mimetype: 'application/pdf',
            timemodified: 1_700_000_777,
          },
        ],
      },
    ]);

    mockMoodle({
      course: { id: COURSE_ID, fullname: 'Chem' },
      sections: [
        {
          id: 100,
          section: 1,
          name: 'Week 1',
          modules: [{ id: 70, name: 'Homework 1', modname: 'assign' }],
        },
      ],
    });

    const docs = await fetchCourseDocuments();

    expect(fetchFileDocument).toHaveBeenCalledTimes(1);
    expect(fetchFileDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: COURSE_ID,
        moduleId: 70,
        sectionId: 100,
        sectionName: 'Week 1',
      }),
      {
        type: 'file',
        filename: 'rubric.pdf',
        filepath: '/',
        fileurl: 'http://webserver/pluginfile.php/1/rubric.pdf',
        mimetype: 'application/pdf',
        timemodified: 1_700_000_777,
      },
      'assign',
    );
    expect(docs).toEqual([attachmentDoc]);
  });

  it('drops an attachment whose file document could not be built', async () => {
    fetchFileDocument.mockResolvedValue(null);
    fetchAssignments.mockResolvedValue([
      {
        cmid: 70,
        name: 'Homework 1',
        introattachments: [
          {
            filename: 'rubric.pdf',
            fileurl: 'http://webserver/pluginfile.php/1/rubric.pdf',
            mimetype: 'application/pdf',
          },
        ],
      },
    ]);

    mockMoodle({
      course: { id: COURSE_ID, fullname: 'Chem' },
      sections: [
        {
          id: 100,
          section: 1,
          name: 'Week 1',
          modules: [{ id: 70, name: 'Homework 1', modname: 'assign' }],
        },
      ],
    });

    expect(await fetchCourseDocuments()).toEqual([]);
    expect(fetchFileDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps ingesting sections when the course summary lookup fails', async () => {
    mockMoodle({
      course: new Error('course lookup failed'),
      sections: [
        {
          id: 100,
          section: 1,
          name: 'Week 1',
          summary: '<p>Week overview</p>',
          modules: [],
        },
      ],
    });

    const docs = await fetchCourseDocuments();

    expect(docs).toHaveLength(1);
    expect(docs[0]).toEqual(
      expect.objectContaining({
        contentType: 'section_summary',
        sectionId: 100,
        text: 'Week overview',
      }),
    );
    expect(docs[0].courseName).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to fetch course summary: course lookup failed',
    );
  });
});

describe('ContextService.fetchForumPosts discussion ids', () => {
  let service: ContextService;
  let moodle: MoodleDouble;

  beforeEach(() => {
    ({ service, moodle } = createService());
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('skips discussions with a missing or zero discussion id', async () => {
    moodle.callMoodleApi.mockImplementation(
      async (wsfunction: string, params: Record<string, unknown>) => {
        if (wsfunction === 'mod_forum_get_forum_discussions') {
          return {
            discussions: [
              {},
              { id: 0 },
              { id: 7, discussion: 300, subject: 'Real' },
            ],
          };
        }
        if (
          wsfunction === 'mod_forum_get_discussion_posts' &&
          params.discussionid === 300
        ) {
          return { posts: [{ id: 900, subject: 'Real', message: 'Body' }] };
        }
        throw new Error(`Unexpected ${wsfunction}`);
      },
    );

    const posts = await asPrivate(service).fetchForumPosts({
      id: 8,
      cmid: 80,
      name: 'Course forum',
    });

    expect(posts).toEqual([
      { id: 900, subject: 'Real', message: 'Body', discussionId: 300 },
    ]);
    expect(moodle.callMoodleApi).toHaveBeenCalledTimes(2);
    expect(moodle.callMoodleApi).toHaveBeenCalledWith(
      'mod_forum_get_discussion_posts',
      { discussionid: 300 },
    );
  });
});
