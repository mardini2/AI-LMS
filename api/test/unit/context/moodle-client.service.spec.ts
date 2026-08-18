jest.mock('node:http');
jest.mock('node:https');

import { EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MoodleClient } from '../../../src/context/moodle-client.service';

const mockedHttpRequest = httpRequest as unknown as jest.Mock;
const mockedHttpsRequest = httpsRequest as unknown as jest.Mock;

type MockRequestOptions = {
  hostname?: string;
  port?: string | number;
  path?: string;
  method?: string;
  headers?: Record<string, string | number>;
};

/** Payloads passed to req.write(), in call order, across both http and https. */
let writtenPayloads: string[] = [];

/**
 * Simulates Node's http(s).request for the POST path: .write() records the
 * body and .end() delivers a response (or a request 'error') on nextTick.
 */
function mockNodeRequestResponse(options: {
  statusCode: number;
  body: string | Buffer;
  chunked?: boolean;
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
        write: (chunk: string) => void;
        end: () => void;
      };

      req.write = jest.fn((chunk: string) => {
        writtenPayloads.push(chunk);
      });

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

/** A response whose statusCode is absent, exercising the `?? 500` fallback. */
function mockStatuslessResponse(): void {
  mockedHttpRequest.mockImplementation(
    (
      _opts: MockRequestOptions,
      callback?: (res: EventEmitter & { statusCode?: number }) => void,
    ) => {
      const req = new EventEmitter() as EventEmitter & {
        write: (chunk: string) => void;
        end: () => void;
      };
      req.write = jest.fn();
      req.end = jest.fn(() => {
        process.nextTick(() => {
          const res = new EventEmitter() as EventEmitter & {
            statusCode?: number;
          };
          res.statusCode = undefined;
          callback?.(res);
          res.emit('data', Buffer.from('{}'));
          res.emit('end');
        });
      });
      return req;
    },
  );
}

function lastRequestOptions(requestFn: jest.Mock): MockRequestOptions {
  const calls = requestFn.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as MockRequestOptions;
}

function createClient(env: Record<string, string | undefined>): MoodleClient {
  const config = { get: jest.fn((key: string) => env[key]) };
  return new MoodleClient(config as unknown as ConfigService);
}

const BASE_ENV = {
  MOODLE_INTERNAL_URL: 'http://webserver',
  MOODLE_TOKEN: 'test-token',
  MOODLE_INTERNAL_HOST: 'localhost:8000',
};

describe('MoodleClient.toPublicMoodleUrl', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the raw string when it is not a parseable URL', () => {
    const client = createClient(BASE_ENV);

    expect(client.toPublicMoodleUrl('not a url')).toBe('not a url');
    expect(client.toPublicMoodleUrl('')).toBe('');
    expect(client.toPublicMoodleUrl('/mod/page/view.php?id=1')).toBe(
      '/mod/page/view.php?id=1',
    );
  });

  it('leaves unrelated hosts untouched', () => {
    const client = createClient(BASE_ENV);

    expect(
      client.toPublicMoodleUrl('https://cdn.example.com/files/doc.pdf?a=1'),
    ).toBe('https://cdn.example.com/files/doc.pdf?a=1');
  });

  it("rewrites 'webserver' to MOODLE_INTERNAL_HOST over http when no public URL is set", () => {
    const client = createClient(BASE_ENV);

    expect(
      client.toPublicMoodleUrl('http://webserver/mod/page/view.php?id=601'),
    ).toBe('http://localhost:8000/mod/page/view.php?id=601');
  });

  it("defaults the rewritten port to 8000 when MOODLE_INTERNAL_HOST has no port", () => {
    const client = createClient({
      ...BASE_ENV,
      MOODLE_INTERNAL_HOST: 'moodle.example.edu',
    });

    expect(client.toPublicMoodleUrl('http://webserver/mod/page/view.php')).toBe(
      'http://moodle.example.edu:8000/mod/page/view.php',
    );
  });

  it('falls back to localhost:8000 when MOODLE_INTERNAL_HOST is unset', () => {
    const client = createClient({
      MOODLE_INTERNAL_URL: 'http://webserver',
      MOODLE_TOKEN: 'test-token',
    });

    expect(client.toPublicMoodleUrl('https://webserver/mod/page/view.php')).toBe(
      'http://localhost:8000/mod/page/view.php',
    );
  });

  it('falls back to localhost:8000 when MOODLE_INTERNAL_HOST is an empty string', () => {
    const client = createClient({ ...BASE_ENV, MOODLE_INTERNAL_HOST: '' });

    expect(client.toPublicMoodleUrl('http://webserver/mod/page/view.php')).toBe(
      'http://localhost:8000/mod/page/view.php',
    );
    // The empty host also degrades to 'localhost' for the match test.
    expect(client.toPublicMoodleUrl('http://localhost/mod/page/view.php')).toBe(
      'http://localhost/mod/page/view.php',
    );
  });

  it('rewrites internal hosts to MOODLE_PUBLIC_URL when one is configured', () => {
    const client = createClient({
      ...BASE_ENV,
      MOODLE_PUBLIC_URL: 'https://moodle.example.org',
    });

    expect(
      client.toPublicMoodleUrl('http://webserver/mod/page/view.php?id=601'),
    ).toBe('https://moodle.example.org/mod/page/view.php?id=601');
    expect(
      client.toPublicMoodleUrl('http://localhost:8000/mod/quiz/view.php?id=1'),
    ).toBe('https://moodle.example.org/mod/quiz/view.php?id=1');
    expect(client.toPublicMoodleUrl('http://127.0.0.1:8000/lib/x.php')).toBe(
      'https://moodle.example.org/lib/x.php',
    );
  });

  it('carries the port from MOODLE_PUBLIC_URL onto rewritten links', () => {
    const client = createClient({
      ...BASE_ENV,
      MOODLE_PUBLIC_URL: 'https://tunnel.example.org:8443/moodle',
    });

    // Only protocol/hostname/port are taken from the public origin; the path stays.
    expect(client.toPublicMoodleUrl('http://webserver/mod/page/view.php')).toBe(
      'https://tunnel.example.org:8443/mod/page/view.php',
    );
  });

  it('ignores a whitespace-only MOODLE_PUBLIC_URL', () => {
    const client = createClient({ ...BASE_ENV, MOODLE_PUBLIC_URL: '   ' });

    expect(client.toPublicMoodleUrl('http://webserver/mod/page/view.php')).toBe(
      'http://localhost:8000/mod/page/view.php',
    );
  });

  it('leaves localhost links unchanged when no public URL is configured', () => {
    const client = createClient(BASE_ENV);

    expect(client.toPublicMoodleUrl('http://localhost:8000/mod/page/x.php')).toBe(
      'http://localhost:8000/mod/page/x.php',
    );
    expect(client.toPublicMoodleUrl('http://127.0.0.1:8000/mod/page/x.php')).toBe(
      'http://127.0.0.1:8000/mod/page/x.php',
    );
  });

  it('matches the MOODLE_INTERNAL_HOST hostname but only rewrites webserver links', () => {
    const client = createClient({
      ...BASE_ENV,
      MOODLE_INTERNAL_HOST: 'moodle-internal:8000',
    });

    // Matched as internal, but with no public URL and no 'webserver' host it is
    // returned as parsed.
    expect(client.toPublicMoodleUrl('http://moodle-internal:8000/a.php')).toBe(
      'http://moodle-internal:8000/a.php',
    );
    expect(client.toPublicMoodleUrl('http://webserver/a.php')).toBe(
      'http://moodle-internal:8000/a.php',
    );
  });
});

describe('MoodleClient.toBrowserCitationUrl', () => {
  it('converts webservice/pluginfile.php links into plain pluginfile.php links', () => {
    const client = createClient(BASE_ENV);

    expect(
      client.toBrowserCitationUrl(
        'http://webserver/webservice/pluginfile.php/1/mod_resource/content/notes.pdf?token=abc&forcedownload=1',
      ),
    ).toBe('http://localhost:8000/pluginfile.php/1/mod_resource/content/notes.pdf');
  });

  it('preserves unrelated query parameters while dropping token/forcedownload', () => {
    const client = createClient(BASE_ENV);

    expect(
      client.toBrowserCitationUrl(
        'https://cdn.example.com/webservice/pluginfile.php/1/f.pdf?token=abc&page=3&forcedownload=1',
      ),
    ).toBe('https://cdn.example.com/pluginfile.php/1/f.pdf?page=3');
  });

  it('applies the public origin rewrite for non-webservice file links', () => {
    const client = createClient({
      ...BASE_ENV,
      MOODLE_PUBLIC_URL: 'https://moodle.example.org',
    });

    expect(
      client.toBrowserCitationUrl('http://webserver/pluginfile.php/1/f.pdf'),
    ).toBe('https://moodle.example.org/pluginfile.php/1/f.pdf');
  });

  it('returns the raw string when it is not a parseable URL', () => {
    const client = createClient(BASE_ENV);

    expect(client.toBrowserCitationUrl('webservice/pluginfile.php/1')).toBe(
      'webservice/pluginfile.php/1',
    );
  });
});

describe('MoodleClient.callMoodleApi POST transport', () => {
  beforeEach(() => {
    mockedHttpRequest.mockReset();
    mockedHttpsRequest.mockReset();
    writtenPayloads = [];
  });

  it('posts a form-encoded body to /webservice/rest/server.php with no query string', async () => {
    mockNodeRequestResponse({
      statusCode: 200,
      body: JSON.stringify({ pageid: 77 }),
    });
    const client = createClient(BASE_ENV);

    await client.callMoodleApi(
      'local_syllentras_ai_create_study_guide',
      { courseid: 12, userid: 42 },
      'POST',
    );

    const opts = lastRequestOptions(mockedHttpRequest);
    expect(opts.method).toBe('POST');
    expect(opts.hostname).toBe('webserver');
    expect(opts.port).toBe(80);
    expect(opts.path).toBe('/webservice/rest/server.php');
    expect(opts.path).not.toContain('?');

    expect(writtenPayloads).toHaveLength(1);
    expect(writtenPayloads[0]).toBe(
      'wstoken=test-token&wsfunction=local_syllentras_ai_create_study_guide&moodlewsrestformat=json&courseid=12&userid=42',
    );
  });

  it('sets Content-Type, Content-Length, and the internal Host header', async () => {
    mockNodeRequestResponse({ statusCode: 200, body: '{}' });
    const client = createClient(BASE_ENV);

    await client.callMoodleApi('local_syllentras_ai_x', { a: 1 }, 'POST');

    expect(lastRequestOptions(mockedHttpRequest).headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(writtenPayloads[0]),
      Host: 'localhost:8000',
    });
  });

  it('omits the Host header when the internal URL is not the docker webserver', async () => {
    mockNodeRequestResponse({ statusCode: 200, body: '{}' });
    const client = createClient({
      ...BASE_ENV,
      MOODLE_INTERNAL_URL: 'http://moodle.example.edu',
    });

    await client.callMoodleApi('local_syllentras_ai_x', { a: 1 }, 'POST');

    expect(lastRequestOptions(mockedHttpRequest).headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(writtenPayloads[0]),
    });
  });

  it('adds X-Forwarded-Proto when MOODLE_PUBLIC_URL is https', async () => {
    mockNodeRequestResponse({ statusCode: 200, body: '{}' });
    const client = createClient({
      ...BASE_ENV,
      MOODLE_PUBLIC_URL: 'https://moodle.example.org',
    });

    await client.callMoodleApi('local_syllentras_ai_x', { a: 1 }, 'POST');

    expect(lastRequestOptions(mockedHttpRequest).headers).toMatchObject({
      Host: 'localhost:8000',
      'X-Forwarded-Proto': 'https',
    });
  });

  it('does not add X-Forwarded-Proto when MOODLE_PUBLIC_URL is http', async () => {
    mockNodeRequestResponse({ statusCode: 200, body: '{}' });
    const client = createClient({
      ...BASE_ENV,
      MOODLE_PUBLIC_URL: 'http://moodle.example.org',
    });

    await client.callMoodleApi('local_syllentras_ai_x', { a: 1 }, 'POST');

    expect(lastRequestOptions(mockedHttpRequest).headers).not.toHaveProperty(
      'X-Forwarded-Proto',
    );
  });

  it('adds X-Forwarded-Proto on GET requests too', async () => {
    mockNodeRequestResponse({ statusCode: 200, body: '[]' });
    const client = createClient({
      MOODLE_INTERNAL_URL: 'http://moodle.example.edu',
      MOODLE_TOKEN: 'test-token',
      MOODLE_INTERNAL_HOST: 'localhost:8000',
      MOODLE_PUBLIC_URL: 'https://moodle.example.org',
    });

    await client.callMoodleApi('core_course_get_courses', { a: 1 });

    const opts = lastRequestOptions(mockedHttpRequest);
    expect(opts.method).toBe('GET');
    expect(opts.headers).toEqual({ 'X-Forwarded-Proto': 'https' });
  });

  it('uses the https module and port 443 for an https internal URL', async () => {
    mockNodeRequestResponse({
      statusCode: 200,
      body: '{"ok":true}',
      protocol: 'https',
    });
    const client = createClient({
      ...BASE_ENV,
      MOODLE_INTERNAL_URL: 'https://moodle.example.org',
    });

    await expect(
      client.callMoodleApi('local_syllentras_ai_x', { a: 1 }, 'POST'),
    ).resolves.toEqual({ ok: true });

    expect(mockedHttpRequest).not.toHaveBeenCalled();
    const opts = lastRequestOptions(mockedHttpsRequest);
    expect(opts.hostname).toBe('moodle.example.org');
    expect(opts.port).toBe(443);
  });

  it('honours an explicit port on the internal URL', async () => {
    mockNodeRequestResponse({ statusCode: 200, body: '{}' });
    const client = createClient({
      ...BASE_ENV,
      MOODLE_INTERNAL_URL: 'http://webserver:8080',
    });

    await client.callMoodleApi('local_syllentras_ai_x', { a: 1 }, 'POST');

    expect(lastRequestOptions(mockedHttpRequest).port).toBe('8080');
  });

  it('serializes arrays and nested objects into the POST body', async () => {
    mockNodeRequestResponse({ statusCode: 200, body: '{}' });
    const client = createClient(BASE_ENV);

    await client.callMoodleApi(
      'local_syllentras_ai_create_practice_quiz',
      {
        userid: 42,
        cmids: [601, 602],
        questions: [
          {
            type: 'multichoice',
            answers: [{ text: 'A', fraction: 1 }],
          },
        ],
      },
      'POST',
    );

    const body = new URLSearchParams(writtenPayloads[0]);
    expect(body.get('userid')).toBe('42');
    expect(body.get('cmids[0]')).toBe('601');
    expect(body.get('cmids[1]')).toBe('602');
    expect(body.get('questions[0][type]')).toBe('multichoice');
    expect(body.get('questions[0][answers][0][text]')).toBe('A');
    expect(body.get('questions[0][answers][0][fraction]')).toBe('1');
  });

  it('stringifies null and undefined parameter values', async () => {
    mockNodeRequestResponse({ statusCode: 200, body: '{}' });
    const client = createClient(BASE_ENV);

    await client.callMoodleApi(
      'local_syllentras_ai_x',
      { nothing: null, missing: undefined },
      'POST',
    );

    const body = new URLSearchParams(writtenPayloads[0]);
    expect(body.get('nothing')).toBe('null');
    expect(body.get('missing')).toBe('undefined');
  });

  it('returns the parsed JSON body reassembled from multiple chunks', async () => {
    mockNodeRequestResponse({
      statusCode: 200,
      body: JSON.stringify({ pageid: 77, cmid: 601, name: 'Guide' }),
      chunked: true,
    });
    const client = createClient(BASE_ENV);

    await expect(
      client.callMoodleApi('local_syllentras_ai_x', {}, 'POST'),
    ).resolves.toEqual({ pageid: 77, cmid: 601, name: 'Guide' });
  });

  it('throws on a non-2xx POST status', async () => {
    mockNodeRequestResponse({ statusCode: 503, body: 'Service Unavailable' });
    const client = createClient(BASE_ENV);

    await expect(
      client.callMoodleApi('local_syllentras_ai_x', {}, 'POST'),
    ).rejects.toThrow('Moodle API error: 503');
  });

  it('throws when a POST response body is not JSON', async () => {
    mockNodeRequestResponse({ statusCode: 200, body: '<html>oops</html>' });
    const client = createClient(BASE_ENV);

    await expect(
      client.callMoodleApi('local_syllentras_ai_x', {}, 'POST'),
    ).rejects.toThrow('Moodle API returned non-JSON: <html>oops</html>');
  });

  it('throws with the Moodle message when the POST response carries an exception', async () => {
    mockNodeRequestResponse({
      statusCode: 200,
      body: JSON.stringify({
        exception: 'required_capability_exception',
        message: 'Sorry, but you do not currently have permissions',
      }),
    });
    const client = createClient(BASE_ENV);

    await expect(
      client.callMoodleApi('local_syllentras_ai_x', {}, 'POST'),
    ).rejects.toThrow(
      'Moodle API exception: Sorry, but you do not currently have permissions',
    );
  });

  it('propagates request-level network errors on POST', async () => {
    mockNodeRequestResponse({
      statusCode: 200,
      body: '',
      requestError: new Error('ECONNRESET'),
    });
    const client = createClient(BASE_ENV);

    await expect(
      client.callMoodleApi('local_syllentras_ai_x', {}, 'POST'),
    ).rejects.toThrow('ECONNRESET');
  });

  it('defaults a missing response status code to 500 on POST', async () => {
    mockStatuslessResponse();
    const client = createClient(BASE_ENV);

    await expect(
      client.callMoodleApi('local_syllentras_ai_x', {}, 'POST'),
    ).rejects.toThrow('Moodle API error: 500');
  });

  it('defaults a missing response status code to 500 on GET', async () => {
    mockStatuslessResponse();
    const client = createClient(BASE_ENV);

    await expect(
      client.callMoodleApi('local_syllentras_ai_x', {}),
    ).rejects.toThrow('Moodle API error: 500');
  });

  it('uses the https module for a GET against an https internal URL', async () => {
    mockNodeRequestResponse({
      statusCode: 200,
      body: '[{"id":12}]',
      protocol: 'https',
    });
    const client = createClient({
      ...BASE_ENV,
      MOODLE_INTERNAL_URL: 'https://moodle.example.org',
    });

    await expect(
      client.callMoodleApi('core_course_get_courses', { courseid: 12 }),
    ).resolves.toEqual([{ id: 12 }]);

    expect(mockedHttpRequest).not.toHaveBeenCalled();
    const opts = lastRequestOptions(mockedHttpsRequest);
    expect(opts.port).toBe(443);
    expect(opts.path).toContain('wsfunction=core_course_get_courses');
    expect(opts.path).toContain('courseid=12');
  });
});

describe('MoodleClient.downloadMoodleFile host handling', () => {
  beforeEach(() => {
    mockedHttpRequest.mockReset();
    mockedHttpsRequest.mockReset();
    writtenPayloads = [];
  });

  it('sends no Host override for external file hosts and uses https', async () => {
    const bytes = Buffer.from('%PDF-1.7 external');
    mockNodeRequestResponse({
      statusCode: 200,
      body: bytes,
      protocol: 'https',
    });
    const client = createClient(BASE_ENV);

    const result = await client.downloadMoodleFile(
      'https://cdn.example.com/pluginfile.php/1/lecture.pdf',
    );

    expect(result.equals(bytes)).toBe(true);
    expect(mockedHttpRequest).not.toHaveBeenCalled();
    const opts = lastRequestOptions(mockedHttpsRequest);
    expect(opts.headers).toBeUndefined();
    expect(opts.port).toBe(443);
    expect(opts.path).toContain('token=test-token');
  });
});
