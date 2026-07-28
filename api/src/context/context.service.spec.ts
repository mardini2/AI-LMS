jest.mock('node:http');
jest.mock('node:https');
jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn(),
}));

import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { PDFParse } from 'pdf-parse';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import {
  ContextService,
  CourseContextDocument,
  CourseContextFilter,
  formatDocument,
  formatDocumentsForPrompt,
  formatForumPostText,
  looksLikePdf,
  matchesSection,
  normalizeSection,
  parseMoodleJsonError,
  relevanceScore,
  stripHtml,
} from './context.service';

const MockedPDFParse = PDFParse as unknown as jest.Mock;

const mockedHttpRequest = httpRequest as unknown as jest.Mock;
const mockedHttpsRequest = httpsRequest as unknown as jest.Mock;

type MockRequestOptions = {
  hostname?: string;
  port?: string | number;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
};

/**
 * Simulates Node's http(s).request: calling .end() delivers a response
 * (or emits 'error' on the request) on nextTick.
 */
function mockNodeRequestResponse(options: {
  statusCode: number;
  body: string | Buffer;
  /** Split the body across multiple 'data' events to exercise chunk reassembly. */
  chunked?: boolean;
  /** Emit an error on the ClientRequest instead of delivering a response. */
  requestError?: Error;
  protocol?: 'http' | 'https';
}): jest.Mock {
  const requestFn =
    options.protocol === 'https' ? mockedHttpsRequest : mockedHttpRequest;

  requestFn.mockImplementation(
    (
      _opts: MockRequestOptions,
      callback?: (res: EventEmitter & { statusCode: number }) => void,
    ) => {
      const req = new EventEmitter() as EventEmitter & {
        end: () => void;
      };

      req.end = jest.fn(() => {
        process.nextTick(() => {
          if (options.requestError) {
            req.emit('error', options.requestError);
            return;
          }

          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
          };
          res.statusCode = options.statusCode;
          callback?.(res);

          const buffer = Buffer.isBuffer(options.body)
            ? options.body
            : Buffer.from(options.body);

          if (options.chunked && buffer.length > 1) {
            const mid = Math.ceil(buffer.length / 2);
            res.emit('data', buffer.subarray(0, mid));
            res.emit('data', buffer.subarray(mid));
          } else {
            res.emit('data', buffer);
          }
          res.emit('end');
        });
      });

      return req;
    },
  );

  return requestFn;
}

function lastHttpRequestOptions(): MockRequestOptions {
  const calls = mockedHttpRequest.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as MockRequestOptions;
}

describe('ContextService', () => {
  let service: ContextService;
  let cache: { get: jest.Mock; set: jest.Mock };
  let config: { get: jest.Mock };
  let callMoodleApi: jest.SpyInstance;
  let getCourseDocuments: jest.SpyInstance;

  beforeEach(() => {
    mockedHttpRequest.mockReset();
    mockedHttpsRequest.mockReset();

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

describe('formatDocument', () => {
  it('formats a full document with heading, present metadata fields, and body', () => {
    const doc: CourseContextDocument = {
      courseId: 12,
      courseName: 'Organic Chemistry',
      sectionName: 'Week 1',
      moduleName: 'Lecture Notes',
      contentType: 'resource_pdf',
      fileName: 'bonds.pdf',
      source: 'https://moodle.example/pluginfile.php/1',
      lastUpdated: 1_700_000_000,
      text: 'Covalent bonds share electrons.',
    };

    const result = formatDocument(doc);

    expect(result).toBe(
      [
        '### Week 1 / Lecture Notes',
        `Metadata: type=resource_pdf; course=Organic Chemistry; section=Week 1; module=Lecture Notes; file=bonds.pdf; source=https://moodle.example/pluginfile.php/1; updated=${new Date(1_700_000_000 * 1000).toISOString()}`,
        'Covalent bonds share electrons.',
      ].join('\n'),
    );
  });

  it('formats a minimal document with only present metadata fields', () => {
    const doc: CourseContextDocument = {
      courseId: 12,
      contentType: 'course_summary',
      text: 'Course overview text.',
    };

    const result = formatDocument(doc);

    expect(result).toBe(
      [
        '### Course',
        'Metadata: type=course_summary',
        'Course overview text.',
      ].join('\n'),
    );
    expect(result).not.toContain('course=');
    expect(result).not.toContain('section=');
    expect(result).not.toContain('module=');
    expect(result).not.toContain('file=');
    expect(result).not.toContain('source=');
    expect(result).not.toContain('updated=');
  });
});

describe('formatForumPostText', () => {
  it('joins Subject and Author lines with the stripped message when present', () => {
    expect(
      formatForumPostText({
        id: 1,
        discussionId: 10,
        subject: '<b>Lab help</b>',
        userfullname: 'Alex &amp; Sam',
        message: '<p>How do I submit?</p>',
      }),
    ).toBe(['Subject: Lab help', 'Author: Alex & Sam', 'How do I submit?'].join('\n'));
  });

  it('omits Subject and Author lines when absent', () => {
    expect(
      formatForumPostText({
        id: 2,
        discussionId: 10,
        message: '<p>Just the body</p>',
      }),
    ).toBe('Just the body');
  });
});

describe('looksLikePdf', () => {
  it("returns true for a buffer starting with '%PDF-'", () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7 binary junk'))).toBe(true);
  });

  it('returns false otherwise', () => {
    expect(looksLikePdf(Buffer.from('Not a PDF'))).toBe(false);
    expect(looksLikePdf(Buffer.from('{"error":"x"}'))).toBe(false);
    expect(looksLikePdf(Buffer.from(''))).toBe(false);
  });
});

describe('parseMoodleJsonError', () => {
  it("returns null when the buffer does not start with '{'", () => {
    expect(parseMoodleJsonError(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(parseMoodleJsonError(Buffer.from('plain text'))).toBeNull();
  });

  it('returns null for invalid JSON that starts with {', () => {
    expect(parseMoodleJsonError(Buffer.from('{not-json'))).toBeNull();
  });

  it('returns error over message over exception', () => {
    expect(
      parseMoodleJsonError(
        Buffer.from(
          JSON.stringify({
            error: 'access denied',
            message: 'ignored message',
            exception: 'ignored exception',
          }),
        ),
      ),
    ).toBe('access denied');

    expect(
      parseMoodleJsonError(
        Buffer.from(
          JSON.stringify({
            message: 'file missing',
            exception: 'ignored exception',
          }),
        ),
      ),
    ).toBe('file missing');

    expect(
      parseMoodleJsonError(
        Buffer.from(JSON.stringify({ exception: 'dml_exception' })),
      ),
    ).toBe('dml_exception');
  });

  it('returns null when valid JSON has none of those fields', () => {
    expect(
      parseMoodleJsonError(Buffer.from(JSON.stringify({ status: 'ok' }))),
    ).toBeNull();
  });
});

describe('formatDocumentsForPrompt', () => {
  function doc(
    overrides: Partial<CourseContextDocument> &
      Pick<CourseContextDocument, 'text' | 'contentType'>,
  ): CourseContextDocument {
    return {
      courseId: 12,
      ...overrides,
    };
  }

  it('orders matching documents before non-matching, each group by relevance desc', () => {
    const documents: CourseContextDocument[] = [
      doc({
        contentType: 'other',
        sectionName: 'Week 2',
        sectionNumber: 2,
        text: 'unrelated low score',
      }),
      doc({
        contentType: 'match_low',
        sectionName: 'Week 1',
        sectionNumber: 1,
        text: 'mentions mitosis once',
      }),
      doc({
        contentType: 'match_high',
        sectionName: 'Week 1',
        sectionNumber: 1,
        moduleName: 'Mitosis Lab',
        text: 'mitosis chromosomes anaphase detailed',
      }),
      doc({
        contentType: 'other_high',
        sectionName: 'Week 3',
        sectionNumber: 3,
        text: 'mitosis chromosomes anaphase also relevant elsewhere',
      }),
    ];

    const result = formatDocumentsForPrompt(
      documents,
      { sectionNumber: 1 },
      'What happens during mitosis and anaphase of chromosomes?',
    );

    const blocks = result.split('\n\n');
    expect(blocks).toHaveLength(4);
    // Matching Week 1 first: high relevance then low
    expect(blocks[0]).toContain('type=match_high');
    expect(blocks[1]).toContain('type=match_low');
    // Then non-matching, higher relevance first
    expect(blocks[2]).toContain('type=other_high');
    expect(blocks[3]).toContain('type=other');
  });

  it('returns all documents sorted by relevance when none match the filter', () => {
    const documents: CourseContextDocument[] = [
      doc({
        contentType: 'low',
        sectionName: 'A',
        text: 'nothing special here',
      }),
      doc({
        contentType: 'high',
        sectionName: 'B',
        text: 'photosynthesis chlorophyll plants sunlight',
      }),
      doc({
        contentType: 'mid',
        sectionName: 'C',
        text: 'photosynthesis overview',
      }),
    ];

    const result = formatDocumentsForPrompt(
      documents,
      { sectionNumber: 99 },
      'Explain photosynthesis and chlorophyll in plants',
    );

    const blocks = result.split('\n\n');
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain('type=high');
    expect(blocks[1]).toContain('type=mid');
    expect(blocks[2]).toContain('type=low');
  });

  it('caps results at 80 documents', () => {
    const documents = Array.from({ length: 85 }, (_, i) =>
      doc({
        contentType: `doc_${i}`,
        sectionName: `Section ${i}`,
        text: `Document body number ${i}`,
      }),
    );

    const result = formatDocumentsForPrompt(documents, {}, 'question about learning');
    const blocks = result.split('\n\n').filter((b) => b.startsWith('###'));

    expect(blocks).toHaveLength(80);
    expect(result).not.toContain('type=doc_80');
  });
});

describe('ContextService HTTP transport', () => {
  let service: ContextService;
  let cache: { get: jest.Mock; set: jest.Mock };
  let config: { get: jest.Mock };

  type TransportService = {
    callMoodleApi: <T>(
      wsfunction: string,
      params: Record<string, unknown>,
    ) => Promise<T>;
    downloadMoodleFile: (url: string) => Promise<Buffer>;
    normalizeMoodleFileUrl: (url: string) => URL;
  };

  function createService(
    env: Record<string, string> = {
      MOODLE_INTERNAL_URL: 'http://webserver',
      MOODLE_TOKEN: 'test-token',
      MOODLE_INTERNAL_HOST: 'localhost:8000',
    },
  ): ContextService {
    cache = { get: jest.fn(), set: jest.fn() };
    config = {
      get: jest.fn((key: string) => env[key]),
    };
    return new ContextService(
      config as unknown as ConfigService,
      cache as unknown as Cache,
    );
  }

  function transport(svc: ContextService = service): TransportService {
    return svc as unknown as TransportService;
  }

  beforeEach(() => {
    mockedHttpRequest.mockReset();
    mockedHttpsRequest.mockReset();
    service = createService();
  });

  describe('callMoodleApi (via resolveCourseName / private call)', () => {
    it('throws on non-2xx status mentioning the status code', async () => {
      mockNodeRequestResponse({ statusCode: 500, body: 'Internal Server Error' });
      // Let the real callMoodleApi run so the HTTP layer is exercised.
      cache.get.mockResolvedValue(undefined);

      await expect(
        transport().callMoodleApi('core_course_get_courses', {
          options: { ids: [12] },
        }),
      ).rejects.toThrow(/Moodle API error: 500/);

      // Public path catches and warns with that message
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      mockNodeRequestResponse({ statusCode: 500, body: 'Internal Server Error' });
      await expect(service.resolveCourseName(12)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Moodle API error: 500'),
      );
      warnSpy.mockRestore();
    });

    it('throws when the response body is not valid JSON', async () => {
      mockNodeRequestResponse({ statusCode: 200, body: 'not-json{' });

      await expect(
        transport().callMoodleApi('core_course_get_courses', {
          options: { ids: [12] },
        }),
      ).rejects.toThrow(/Moodle API returned non-JSON/);
    });

    it("throws using 'message' when JSON contains an exception field", async () => {
      mockNodeRequestResponse({
        statusCode: 200,
        body: JSON.stringify({
          exception: 'dml_exception',
          message: 'Invalid course id',
        }),
      });

      await expect(
        transport().callMoodleApi('core_course_get_courses', {
          options: { ids: [12] },
        }),
      ).rejects.toThrow(/Moodle API exception: Invalid course id/);
    });

    it("throws using 'exception' when message is absent", async () => {
      mockNodeRequestResponse({
        statusCode: 200,
        body: JSON.stringify({ exception: 'access_exception' }),
      });

      await expect(
        transport().callMoodleApi('core_course_get_courses', {
          options: { ids: [12] },
        }),
      ).rejects.toThrow(/Moodle API exception: access_exception/);
    });

    it('serializes array parameters as key[0], key[1], etc.', async () => {
      mockNodeRequestResponse({
        statusCode: 200,
        body: JSON.stringify([{ id: 1, fullname: 'A' }]),
      });

      await transport().callMoodleApi('core_enrol_get_users_courses', {
        courseids: [10, 20],
      });

      const path = lastHttpRequestOptions().path ?? '';
      expect(path).toContain('courseids%5B0%5D=10');
      expect(path).toContain('courseids%5B1%5D=20');
    });

    it('serializes nested object parameters as key[nestedKey] recursively', async () => {
      mockNodeRequestResponse({
        statusCode: 200,
        body: JSON.stringify([{ id: 12, fullname: 'Chem' }]),
      });

      // Same shape resolveCourseName uses
      cache.get.mockResolvedValue(undefined);
      await service.resolveCourseName(12);

      // resolveCourseName spies are not active in this describe — real HTTP ran
      const path = lastHttpRequestOptions().path ?? '';
      expect(path).toContain('options%5Bids%5D%5B0%5D=12');
      expect(path).toContain('wsfunction=core_course_get_courses');
      expect(path).toContain('wstoken=test-token');
    });

    it("sends Host header matching MOODLE_INTERNAL_HOST when hostname is 'webserver'", async () => {
      mockNodeRequestResponse({
        statusCode: 200,
        body: JSON.stringify([{ id: 12, fullname: 'Chem' }]),
      });

      await transport().callMoodleApi('core_course_get_courses', {
        options: { ids: [12] },
      });

      expect(lastHttpRequestOptions().headers).toEqual({
        Host: 'localhost:8000',
      });
      expect(lastHttpRequestOptions().hostname).toBe('webserver');
    });

    it('does not send a Host header override for non-webserver hostnames', async () => {
      service = createService({
        MOODLE_INTERNAL_URL: 'http://moodle.example.edu',
        MOODLE_TOKEN: 'test-token',
        MOODLE_INTERNAL_HOST: 'localhost:8000',
      });

      mockNodeRequestResponse({
        statusCode: 200,
        body: JSON.stringify([{ id: 12, fullname: 'Chem' }]),
      });

      await transport().callMoodleApi('core_course_get_courses', {
        options: { ids: [12] },
      });

      expect(lastHttpRequestOptions().hostname).toBe('moodle.example.edu');
      expect(lastHttpRequestOptions().headers).toBeUndefined();
    });
  });

  describe('normalizeMoodleFileUrl', () => {
    it("rewrites hostnames matching MOODLE_INTERNAL_HOST's host to MOODLE_INTERNAL_URL", () => {
      const url = transport().normalizeMoodleFileUrl(
        'http://localhost:8000/pluginfile.php/1/file.pdf',
      );

      expect(url.protocol).toBe('http:');
      expect(url.hostname).toBe('webserver');
      expect(url.port).toBe('');
      expect(url.pathname).toBe('/pluginfile.php/1/file.pdf');
    });

    it("rewrites hostname 'localhost' to the internal Moodle URL", () => {
      // Different port so we aren't also matching via MOODLE_INTERNAL_HOST
      const url = transport().normalizeMoodleFileUrl(
        'http://localhost:9/pluginfile.php/x',
      );
      expect(url.hostname).toBe('webserver');
    });

    it("rewrites hostname '127.0.0.1' to the internal Moodle URL", () => {
      const url = transport().normalizeMoodleFileUrl(
        'http://127.0.0.1:8000/pluginfile.php/x',
      );
      expect(url.hostname).toBe('webserver');
    });

    it('leaves an unrelated hostname unchanged', () => {
      const url = transport().normalizeMoodleFileUrl(
        'https://cdn.example.com/files/doc.pdf?forcedownload=1',
      );
      expect(url.hostname).toBe('cdn.example.com');
      expect(url.protocol).toBe('https:');
    });

    it('appends token when missing', () => {
      const url = transport().normalizeMoodleFileUrl(
        'https://cdn.example.com/files/doc.pdf',
      );
      expect(url.searchParams.get('token')).toBe('test-token');
    });

    it('does not overwrite an existing token query param', () => {
      const url = transport().normalizeMoodleFileUrl(
        'https://cdn.example.com/files/doc.pdf?token=already-set',
      );
      expect(url.searchParams.get('token')).toBe('already-set');
    });
  });

  describe('downloadMoodleFile', () => {
    it("throws on non-2xx mentioning 'Moodle file download failed'", async () => {
      mockNodeRequestResponse({ statusCode: 403, body: 'Forbidden' });

      await expect(
        transport().downloadMoodleFile(
          'http://webserver/pluginfile.php/1/file.pdf',
        ),
      ).rejects.toThrow(/Moodle file download failed: 403/);
    });

    it("throws on JSON Moodle error mentioning 'Moodle file access error'", async () => {
      mockNodeRequestResponse({
        statusCode: 200,
        body: JSON.stringify({ error: 'No permission to access file' }),
      });

      await expect(
        transport().downloadMoodleFile(
          'http://webserver/pluginfile.php/1/file.pdf',
        ),
      ).rejects.toThrow(
        /Moodle file access error: No permission to access file/,
      );
    });

    it('returns the raw Buffer for a successful binary (non-JSON) response', async () => {
      const pdfBytes = Buffer.from('%PDF-1.7 binary-content-here');
      mockNodeRequestResponse({
        statusCode: 200,
        body: pdfBytes,
        chunked: true,
      });

      const result = await transport().downloadMoodleFile(
        'http://webserver/pluginfile.php/1/lecture.pdf',
      );

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.equals(pdfBytes)).toBe(true);
      // Rewritten to webserver → Host header applied
      expect(lastHttpRequestOptions().headers).toEqual({
        Host: 'localhost:8000',
      });
    });

    it('propagates request-level network errors', async () => {
      mockNodeRequestResponse({
        statusCode: 200,
        body: '',
        requestError: new Error('ECONNREFUSED'),
      });

      await expect(
        transport().downloadMoodleFile(
          'http://webserver/pluginfile.php/1/file.pdf',
        ),
      ).rejects.toThrow('ECONNREFUSED');
    });
  });
});

describe('ContextService.fetchFileDocument', () => {
  let service: ContextService;
  let downloadMoodleFile: jest.SpyInstance;

  const moduleBase = {
    courseId: 12,
    courseName: 'Chemistry',
    sectionName: 'Week 1',
    sectionNumber: 1,
    moduleId: 5,
    moduleName: 'Lecture Slides',
    source: 'http://webserver/mod/resource/view.php?id=5',
    lastUpdated: 1_700_000_000,
  };

  type FetchFileDocumentFn = (
    moduleBase: Omit<CourseContextDocument, 'contentType' | 'text'>,
    content: {
      type: string;
      filename?: string;
      mimetype?: string;
      fileurl?: string;
      timemodified?: number;
    },
    modname: string,
  ) => Promise<CourseContextDocument | null>;

  function fetchFileDocument(
    ...args: Parameters<FetchFileDocumentFn>
  ): ReturnType<FetchFileDocumentFn> {
    return (
      service as unknown as { fetchFileDocument: FetchFileDocumentFn }
    ).fetchFileDocument(...args);
  }

  beforeEach(() => {
    MockedPDFParse.mockReset();

    const cache = { get: jest.fn(), set: jest.fn() };
    const config = {
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

    downloadMoodleFile = jest.spyOn(
      service as unknown as {
        downloadMoodleFile: (url: string) => Promise<Buffer>;
      },
      'downloadMoodleFile',
    );

    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a resource_pdf document when PDF download and parse succeed', async () => {
    downloadMoodleFile.mockResolvedValue(Buffer.from('%PDF-1.7 fake'));
    const getText = jest.fn().mockResolvedValue({ text: 'Extracted PDF content' });
    const destroy = jest.fn();
    MockedPDFParse.mockImplementation(() => ({ getText, destroy }));

    const doc = await fetchFileDocument(
      moduleBase,
      {
        type: 'file',
        filename: 'notes.pdf',
        mimetype: 'application/pdf',
        fileurl: 'http://webserver/pluginfile.php/1/notes.pdf',
        timemodified: 1_700_001_000,
      },
      'resource',
    );

    expect(downloadMoodleFile).toHaveBeenCalledWith(
      'http://webserver/pluginfile.php/1/notes.pdf',
    );
    expect(MockedPDFParse).toHaveBeenCalledWith({
      data: Buffer.from('%PDF-1.7 fake'),
    });
    expect(getText).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
    expect(doc).toEqual(
      expect.objectContaining({
        courseId: 12,
        courseName: 'Chemistry',
        sectionName: 'Week 1',
        moduleName: 'Lecture Slides',
        fileName: 'notes.pdf',
        source: 'http://webserver/pluginfile.php/1/notes.pdf',
        contentType: 'resource_pdf',
        text: 'Extracted PDF content',
        lastUpdated: 1_700_001_000,
      }),
    );
    expect(doc?.lastUpdated).not.toBe(moduleBase.lastUpdated);
  });

  it('returns null when a claimed PDF buffer fails looksLikePdf', async () => {
    downloadMoodleFile.mockResolvedValue(Buffer.from('{"error":"not a pdf"}'));

    const doc = await fetchFileDocument(
      moduleBase,
      {
        type: 'file',
        filename: 'notes.pdf',
        mimetype: 'application/pdf',
        fileurl: 'http://webserver/pluginfile.php/1/notes.pdf',
      },
      'resource',
    );

    expect(doc).toBeNull();
    expect(MockedPDFParse).not.toHaveBeenCalled();
  });

  it('returns null when PDFParse extracts empty/whitespace-only text', async () => {
    downloadMoodleFile.mockResolvedValue(Buffer.from('%PDF-1.7 empty'));
    MockedPDFParse.mockImplementation(() => ({
      getText: jest.fn().mockResolvedValue({ text: '   \n\t  ' }),
      destroy: jest.fn(),
    }));

    const doc = await fetchFileDocument(
      moduleBase,
      {
        type: 'file',
        filename: 'notes.pdf',
        mimetype: 'application/pdf',
        fileurl: 'http://webserver/pluginfile.php/1/notes.pdf',
      },
      'resource',
    );

    expect(doc).toBeNull();
  });

  it('returns null when downloadMoodleFile throws for a PDF', async () => {
    downloadMoodleFile.mockRejectedValue(new Error('ECONNREFUSED'));

    const doc = await fetchFileDocument(
      moduleBase,
      {
        type: 'file',
        filename: 'notes.pdf',
        mimetype: 'application/pdf',
        fileurl: 'http://webserver/pluginfile.php/1/notes.pdf',
      },
      'resource',
    );

    expect(doc).toBeNull();
  });

  it('returns a resource_file document for text/plain content', async () => {
    downloadMoodleFile.mockResolvedValue(
      Buffer.from('Hello from the readme', 'utf8'),
    );

    const doc = await fetchFileDocument(
      moduleBase,
      {
        type: 'file',
        filename: 'readme.txt',
        mimetype: 'text/plain',
        fileurl: 'http://webserver/pluginfile.php/1/readme.txt',
        timemodified: 1_700_002_000,
      },
      'resource',
    );

    expect(downloadMoodleFile).toHaveBeenCalledWith(
      'http://webserver/pluginfile.php/1/readme.txt',
    );
    expect(doc).toEqual(
      expect.objectContaining({
        contentType: 'resource_file',
        text: 'Hello from the readme',
        fileName: 'readme.txt',
        lastUpdated: 1_700_002_000,
      }),
    );
  });

  it('treats application/json the same as text (resource_file)', async () => {
    downloadMoodleFile.mockResolvedValue(
      Buffer.from('{"topic":"bonding"}', 'utf8'),
    );

    const doc = await fetchFileDocument(
      moduleBase,
      {
        type: 'file',
        filename: 'data.json',
        mimetype: 'application/json',
        fileurl: 'http://webserver/pluginfile.php/1/data.json',
      },
      'resource',
    );

    expect(downloadMoodleFile).toHaveBeenCalled();
    expect(doc).toEqual(
      expect.objectContaining({
        contentType: 'resource_file',
        text: '{"topic":"bonding"}',
        fileName: 'data.json',
      }),
    );
  });

  it('returns file_metadata for unrecognized binary without downloading', async () => {
    const doc = await fetchFileDocument(
      moduleBase,
      {
        type: 'file',
        filename: 'diagram.png',
        mimetype: 'image/png',
        fileurl: 'http://webserver/pluginfile.php/1/diagram.png',
      },
      'resource',
    );

    expect(downloadMoodleFile).not.toHaveBeenCalled();
    expect(doc).toEqual(
      expect.objectContaining({
        contentType: 'resource_file_metadata',
        text: 'diagram.png image/png',
        fileName: 'diagram.png',
        source: 'http://webserver/pluginfile.php/1/diagram.png',
      }),
    );
  });

  it('falls back to file_metadata (not null) when a non-PDF download throws', async () => {
    downloadMoodleFile.mockRejectedValue(new Error('network down'));

    const doc = await fetchFileDocument(
      moduleBase,
      {
        type: 'file',
        filename: 'readme.txt',
        mimetype: 'text/plain',
        fileurl: 'http://webserver/pluginfile.php/1/readme.txt',
      },
      'resource',
    );

    expect(doc).toEqual(
      expect.objectContaining({
        contentType: 'resource_file_metadata',
        text: 'readme.txt text/plain',
        fileName: 'readme.txt',
      }),
    );
    expect(doc).not.toBeNull();
  });
});

describe('ContextService.fetchCourseDocuments', () => {
  let service: ContextService;
  let callMoodleApi: jest.SpyInstance;
  let fetchPages: jest.SpyInstance;
  let fetchAssignments: jest.SpyInstance;
  let fetchForums: jest.SpyInstance;
  let fetchFileDocument: jest.SpyInstance;
  let fetchForumPosts: jest.SpyInstance;

  const COURSE_ID = 12;

  type FetchCourseDocumentsFn = (
    courseId: number,
  ) => Promise<CourseContextDocument[]>;

  function fetchCourseDocuments(
    courseId = COURSE_ID,
  ): Promise<CourseContextDocument[]> {
    return (
      service as unknown as { fetchCourseDocuments: FetchCourseDocumentsFn }
    ).fetchCourseDocuments(courseId);
  }

  function mockCourseAndSections(options: {
    course?: {
      id: number;
      fullname: string;
      summary?: string;
      timemodified?: number;
    } | null;
    sections?: unknown[];
  }) {
    callMoodleApi.mockImplementation(async (wsfunction: string) => {
      if (wsfunction === 'core_course_get_courses') {
        return options.course ? [options.course] : [];
      }
      if (wsfunction === 'core_course_get_contents') {
        return options.sections ?? [];
      }
      throw new Error(`Unexpected callMoodleApi wsfunction: ${wsfunction}`);
    });
  }

  beforeEach(() => {
    const cache = { get: jest.fn(), set: jest.fn() };
    const config = {
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
      service as unknown as {
        callMoodleApi: (...args: unknown[]) => Promise<unknown>;
      },
      'callMoodleApi',
    );
    fetchPages = jest
      .spyOn(
        service as unknown as { fetchPages: (id: number) => Promise<unknown[]> },
        'fetchPages',
      )
      .mockResolvedValue([]);
    fetchAssignments = jest
      .spyOn(
        service as unknown as {
          fetchAssignments: (id: number) => Promise<unknown[]>;
        },
        'fetchAssignments',
      )
      .mockResolvedValue([]);
    fetchForums = jest
      .spyOn(
        service as unknown as {
          fetchForums: (id: number) => Promise<unknown[]>;
        },
        'fetchForums',
      )
      .mockResolvedValue([]);
    fetchFileDocument = jest.spyOn(
      service as unknown as {
        fetchFileDocument: (...args: unknown[]) => Promise<unknown>;
      },
      'fetchFileDocument',
    );
    fetchForumPosts = jest
      .spyOn(
        service as unknown as {
          fetchForumPosts: (forum: unknown) => Promise<unknown[]>;
        },
        'fetchForumPosts',
      )
      .mockResolvedValue([]);

    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('includes a course_summary document when the course has a summary', async () => {
    mockCourseAndSections({
      course: {
        id: COURSE_ID,
        fullname: 'Organic Chemistry',
        summary: '<p>Welcome to <b>chem</b></p>',
        timemodified: 1_700_000_000,
      },
      sections: [],
    });

    const docs = await fetchCourseDocuments();

    expect(docs).toContainEqual(
      expect.objectContaining({
        courseId: COURSE_ID,
        courseName: 'Organic Chemistry',
        contentType: 'course_summary',
        source: `course:${COURSE_ID}`,
        lastUpdated: 1_700_000_000,
        text: 'Welcome to chem',
      }),
    );
  });

  it('omits course_summary when summary is absent or empty', async () => {
    mockCourseAndSections({
      course: {
        id: COURSE_ID,
        fullname: 'Organic Chemistry',
        summary: '',
      },
      sections: [],
    });
    expect(
      (await fetchCourseDocuments()).find((d) => d.contentType === 'course_summary'),
    ).toBeUndefined();

    mockCourseAndSections({
      course: { id: COURSE_ID, fullname: 'Organic Chemistry' },
      sections: [],
    });
    expect(
      (await fetchCourseDocuments()).find((d) => d.contentType === 'course_summary'),
    ).toBeUndefined();
  });

  it('includes section_summary only when the section has a non-empty summary', async () => {
    mockCourseAndSections({
      course: { id: COURSE_ID, fullname: 'Chem' },
      sections: [
        {
          id: 100,
          section: 1,
          name: 'Week 1',
          summary: '<p>Week overview</p>',
          timemodified: 1_700_000_100,
          modules: [],
        },
        {
          id: 101,
          section: 2,
          name: 'Week 2',
          summary: '   ',
          modules: [],
        },
      ],
    });

    const docs = await fetchCourseDocuments();
    const sectionSummaries = docs.filter((d) => d.contentType === 'section_summary');

    expect(sectionSummaries).toHaveLength(1);
    expect(sectionSummaries[0]).toEqual(
      expect.objectContaining({
        contentType: 'section_summary',
        sectionId: 100,
        sectionNumber: 1,
        sectionName: 'Week 1',
        text: 'Week overview',
        source: 'section:100',
        lastUpdated: 1_700_000_100,
      }),
    );
  });

  it("produces a '{modname}_description' document from module.description", async () => {
    mockCourseAndSections({
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
              url: 'http://webserver/mod/resource/view.php?id=50',
              description: '<p>Read before lab</p>',
            },
          ],
        },
      ],
    });

    const docs = await fetchCourseDocuments();
    expect(docs).toContainEqual(
      expect.objectContaining({
        contentType: 'resource_description',
        moduleId: 50,
        moduleName: 'Lab Guide',
        text: 'Read before lab',
      }),
    );
  });

  it("produces a '{modname}_inline_content' document for type 'content' items", async () => {
    mockCourseAndSections({
      course: { id: COURSE_ID, fullname: 'Chem' },
      sections: [
        {
          id: 100,
          section: 1,
          name: 'Week 1',
          modules: [
            {
              id: 51,
              name: 'Label',
              modname: 'label',
              contents: [
                {
                  type: 'content',
                  content: '<p>Inline label text</p>',
                },
              ],
            },
          ],
        },
      ],
    });

    const docs = await fetchCourseDocuments();
    expect(docs).toContainEqual(
      expect.objectContaining({
        contentType: 'label_inline_content',
        text: 'Inline label text',
      }),
    );
  });

  it('includes fetchFileDocument results for file contents and skips nulls', async () => {
    const fileDoc: CourseContextDocument = {
      courseId: COURSE_ID,
      contentType: 'resource_pdf',
      fileName: 'notes.pdf',
      text: 'PDF text',
    };
    fetchFileDocument
      .mockResolvedValueOnce(fileDoc)
      .mockResolvedValueOnce(null);

    mockCourseAndSections({
      course: { id: COURSE_ID, fullname: 'Chem' },
      sections: [
        {
          id: 100,
          section: 1,
          name: 'Week 1',
          modules: [
            {
              id: 52,
              name: 'Slides',
              modname: 'resource',
              contents: [
                {
                  type: 'file',
                  filename: 'notes.pdf',
                  fileurl: 'http://webserver/pluginfile.php/1/notes.pdf',
                  mimetype: 'application/pdf',
                },
                {
                  type: 'file',
                  filename: 'broken.pdf',
                  fileurl: 'http://webserver/pluginfile.php/1/broken.pdf',
                  mimetype: 'application/pdf',
                },
              ],
            },
          ],
        },
      ],
    });

    const docs = await fetchCourseDocuments();

    expect(fetchFileDocument).toHaveBeenCalledTimes(2);
    expect(docs).toContainEqual(fileDoc);
    expect(docs.filter((d) => d.fileName === 'broken.pdf')).toHaveLength(0);
  });

  it("cross-references pages by coursemodule for modname 'page'", async () => {
    fetchPages.mockResolvedValue([
      {
        coursemodule: 60,
        content: '<p>Page body</p>',
        timemodified: 1_700_000_200,
      },
      {
        coursemodule: 999,
        content: '<p>Other page</p>',
        timemodified: 1_700_000_201,
      },
    ]);

    mockCourseAndSections({
      course: { id: COURSE_ID, fullname: 'Chem' },
      sections: [
        {
          id: 100,
          section: 1,
          name: 'Week 1',
          modules: [
            { id: 60, name: 'Syllabus', modname: 'page' },
            { id: 61, name: 'No match', modname: 'page' },
          ],
        },
      ],
    });

    const docs = await fetchCourseDocuments();
    const pageDocs = docs.filter((d) => d.contentType === 'page');

    expect(pageDocs).toHaveLength(1);
    expect(pageDocs[0]).toEqual(
      expect.objectContaining({
        contentType: 'page',
        moduleId: 60,
        moduleName: 'Syllabus',
        text: 'Page body',
        lastUpdated: 1_700_000_200,
      }),
    );
  });

  it("cross-references assignments by cmid for modname 'assign'", async () => {
    fetchAssignments.mockResolvedValue([
      {
        cmid: 70,
        name: 'Homework 1',
        intro: '<p>Submit by Friday</p>',
        timemodified: 1_700_000_300,
      },
    ]);

    mockCourseAndSections({
      course: { id: COURSE_ID, fullname: 'Chem' },
      sections: [
        {
          id: 100,
          section: 1,
          name: 'Week 1',
          modules: [
            { id: 70, name: 'Homework 1', modname: 'assign' },
            { id: 71, name: 'No intro match', modname: 'assign' },
          ],
        },
      ],
    });

    const docs = await fetchCourseDocuments();
    const assignDocs = docs.filter((d) => d.contentType === 'assignment');

    expect(assignDocs).toHaveLength(1);
    expect(assignDocs[0]).toEqual(
      expect.objectContaining({
        contentType: 'assignment',
        moduleId: 70,
        text: 'Submit by Friday',
        lastUpdated: 1_700_000_300,
      }),
    );
  });

  it("produces forum/announcement docs and posts from forums + fetchForumPosts", async () => {
    fetchForums.mockResolvedValue([
      {
        id: 8,
        cmid: 80,
        name: 'Course forum',
        type: 'general',
        intro: '<p>Ask questions</p>',
        timemodified: 1_700_000_400,
      },
      {
        id: 9,
        cmid: 81,
        name: 'Announcements',
        type: 'news',
        intro: '<p>News only</p>',
        timemodified: 1_700_000_401,
      },
    ]);
    fetchForumPosts
      .mockResolvedValueOnce([
        {
          id: 501,
          discussionId: 401,
          subject: 'Help',
          message: '<p>How do I submit?</p>',
          modified: 1_700_000_450,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 502,
          discussionId: 402,
          subject: 'Welcome',
          message: '<p>Hello class</p>',
          created: 1_700_000_460,
        },
      ]);

    mockCourseAndSections({
      course: { id: COURSE_ID, fullname: 'Chem' },
      sections: [
        {
          id: 100,
          section: 1,
          name: 'Week 1',
          modules: [
            { id: 80, name: 'Course forum', modname: 'forum' },
            { id: 81, name: 'Announcements', modname: 'forum' },
          ],
        },
      ],
    });

    const docs = await fetchCourseDocuments();

    expect(docs).toContainEqual(
      expect.objectContaining({
        contentType: 'forum',
        text: 'Ask questions',
        moduleId: 80,
      }),
    );
    expect(docs).toContainEqual(
      expect.objectContaining({
        contentType: 'announcement_forum',
        text: 'News only',
        moduleId: 81,
      }),
    );
    expect(docs).toContainEqual(
      expect.objectContaining({
        contentType: 'forum_post',
        source: 'forum:8:discussion:401:post:501',
        text: expect.stringContaining('How do I submit?'),
      }),
    );
    expect(docs).toContainEqual(
      expect.objectContaining({
        contentType: 'announcement_post',
        source: 'forum:9:discussion:402:post:502',
        text: expect.stringContaining('Hello class'),
      }),
    );
    expect(fetchForumPosts).toHaveBeenCalledTimes(2);
  });

  it('filters out documents whose text is only whitespace', async () => {
    mockCourseAndSections({
      course: {
        id: COURSE_ID,
        fullname: 'Chem',
        summary: '   \n\t  ',
        timemodified: 1_700_000_000,
      },
      sections: [],
    });

    const docs = await fetchCourseDocuments();
    expect(docs.find((d) => d.contentType === 'course_summary')).toBeUndefined();
    expect(docs.every((d) => d.text.trim().length > 0)).toBe(true);
  });

  it('runs course, sections, pages, assignments, and forums fetches via Promise.all', async () => {
    mockCourseAndSections({
      course: { id: COURSE_ID, fullname: 'Chem' },
      sections: [],
    });

    await fetchCourseDocuments();

    expect(callMoodleApi).toHaveBeenCalledWith('core_course_get_courses', {
      options: { ids: [COURSE_ID] },
    });
    expect(callMoodleApi).toHaveBeenCalledWith('core_course_get_contents', {
      courseid: COURSE_ID,
    });
    expect(fetchPages).toHaveBeenCalledWith(COURSE_ID);
    expect(fetchAssignments).toHaveBeenCalledWith(COURSE_ID);
    expect(fetchForums).toHaveBeenCalledWith(COURSE_ID);
  });
});

describe('ContextService sub-fetchers', () => {
  let service: ContextService;
  let callMoodleApi: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    const cache = { get: jest.fn(), set: jest.fn() };
    const config = {
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
      service as unknown as {
        callMoodleApi: (...args: unknown[]) => Promise<unknown>;
      },
      'callMoodleApi',
    );
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('fetchPages', () => {
    const fetchPages = (courseId: number) =>
      (
        service as unknown as {
          fetchPages: (id: number) => Promise<unknown[]>;
        }
      ).fetchPages(courseId);

    it("returns the 'pages' array from a successful response", async () => {
      const pages = [
        { coursemodule: 1, content: 'A' },
        { coursemodule: 2, content: 'B' },
      ];
      callMoodleApi.mockResolvedValue({ pages });

      await expect(fetchPages(12)).resolves.toEqual(pages);
      expect(callMoodleApi).toHaveBeenCalledWith(
        'mod_page_get_pages_by_courses',
        { courseids: [12] },
      );
    });

    it('returns [] and logs a warning on failure', async () => {
      callMoodleApi.mockRejectedValue(new Error('pages down'));

      await expect(fetchPages(12)).resolves.toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch pages'),
      );
    });
  });

  describe('fetchAssignments', () => {
    const fetchAssignments = (courseId: number) =>
      (
        service as unknown as {
          fetchAssignments: (id: number) => Promise<unknown[]>;
        }
      ).fetchAssignments(courseId);

    it("flatMaps 'assignments' across all courses in the response", async () => {
      callMoodleApi.mockResolvedValue({
        courses: [
          {
            assignments: [
              { cmid: 1, name: 'A1', intro: 'one' },
              { cmid: 2, name: 'A2', intro: 'two' },
            ],
          },
          {
            assignments: [{ cmid: 3, name: 'A3', intro: 'three' }],
          },
          {},
        ],
      });

      await expect(fetchAssignments(12)).resolves.toEqual([
        { cmid: 1, name: 'A1', intro: 'one' },
        { cmid: 2, name: 'A2', intro: 'two' },
        { cmid: 3, name: 'A3', intro: 'three' },
      ]);
    });

    it('returns [] and logs a warning on failure', async () => {
      callMoodleApi.mockRejectedValue(new Error('assign down'));

      await expect(fetchAssignments(12)).resolves.toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch assignments'),
      );
    });
  });

  describe('fetchForums', () => {
    const fetchForums = (courseId: number) =>
      (
        service as unknown as {
          fetchForums: (id: number) => Promise<unknown[]>;
        }
      ).fetchForums(courseId);

    it('returns the forums array directly', async () => {
      const forums = [
        { id: 1, cmid: 10, name: 'General' },
        { id: 2, cmid: 11, name: 'News', type: 'news' },
      ];
      callMoodleApi.mockResolvedValue(forums);

      await expect(fetchForums(12)).resolves.toEqual(forums);
      expect(callMoodleApi).toHaveBeenCalledWith(
        'mod_forum_get_forums_by_courses',
        { courseids: [12] },
      );
    });

    it('returns [] and logs a warning on failure', async () => {
      callMoodleApi.mockRejectedValue(new Error('forums down'));

      await expect(fetchForums(12)).resolves.toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch forums'),
      );
    });
  });

  describe('fetchForumPosts', () => {
    const fetchForumPosts = (forum: unknown) =>
      (
        service as unknown as {
          fetchForumPosts: (f: unknown) => Promise<unknown[]>;
        }
      ).fetchForumPosts(forum);

    it('returns [] without calling callMoodleApi when forum has no id', async () => {
      await expect(
        fetchForumPosts({ cmid: 10, name: 'No id forum' }),
      ).resolves.toEqual([]);
      expect(callMoodleApi).not.toHaveBeenCalled();
    });

    it('returns posts tagged with discussionId on successful post fetches', async () => {
      callMoodleApi.mockImplementation(
        async (wsfunction: string, params: Record<string, unknown>) => {
          if (wsfunction === 'mod_forum_get_forum_discussions') {
            return {
              discussions: [
                { id: 1, discussion: 100 },
                { id: 2, discussion: 200 },
              ],
            };
          }
          if (wsfunction === 'mod_forum_get_discussion_posts') {
            if (params.discussionid === 100) {
              return {
                posts: [
                  { id: 10, subject: 'Q', message: 'Question body' },
                ],
              };
            }
            if (params.discussionid === 200) {
              return {
                posts: [
                  { id: 20, subject: 'A', message: 'Answer body' },
                ],
              };
            }
          }
          throw new Error(`unexpected ${wsfunction}`);
        },
      );

      const posts = await fetchForumPosts({
        id: 8,
        cmid: 80,
        name: 'Course forum',
      });

      expect(posts).toEqual([
        {
          id: 10,
          subject: 'Q',
          message: 'Question body',
          discussionId: 100,
        },
        {
          id: 20,
          subject: 'A',
          message: 'Answer body',
          discussionId: 200,
        },
      ]);
    });

    it('falls back to the discussion message when post-fetch fails', async () => {
      callMoodleApi.mockImplementation(
        async (wsfunction: string, params: Record<string, unknown>) => {
          if (wsfunction === 'mod_forum_get_forum_discussions') {
            return {
              discussions: [
                {
                  id: 55,
                  discussion: 300,
                  subject: 'Fallback subject',
                  name: 'Fallback name',
                  message: '<p>Embedded discussion message</p>',
                  created: 100,
                  timemodified: 200,
                  userfullname: 'Alex',
                },
              ],
            };
          }
          if (wsfunction === 'mod_forum_get_discussion_posts') {
            throw new Error('posts unavailable');
          }
          throw new Error(`unexpected ${wsfunction} ${JSON.stringify(params)}`);
        },
      );

      const posts = await fetchForumPosts({
        id: 8,
        cmid: 80,
        name: 'Course forum',
      });

      expect(posts).toEqual([
        {
          id: 55,
          discussionId: 300,
          subject: 'Fallback subject',
          message: '<p>Embedded discussion message</p>',
          created: 100,
          modified: 200,
          userfullname: 'Alex',
        },
      ]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch posts for forum discussion 300'),
      );
    });

    it('returns [] and logs a warning when the discussions call fails', async () => {
      callMoodleApi.mockRejectedValue(new Error('discussions down'));

      await expect(
        fetchForumPosts({ id: 8, cmid: 80, name: 'Course forum' }),
      ).resolves.toEqual([]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to fetch forum discussions for Course forum',
        ),
      );
    });
  });
});
