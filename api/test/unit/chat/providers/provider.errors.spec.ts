import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { assertNonEmptyText, mapProviderError } from '../../../../src/chat/providers/provider.errors';

const LABEL = 'Google Gemini';

function withStatus(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

describe('mapProviderError', () => {
  it('passes an existing HttpException straight through without rewrapping', () => {
    const original = new NotFoundException('conversation 42 is gone');
    const mapped = mapProviderError(original, LABEL);

    expect(mapped).toBe(original);
    expect(mapped.getStatus()).toBe(404);
    expect(mapped.message).toBe('conversation 42 is gone');
  });

  it('preserves a 403 HttpException raised deeper in the stack', () => {
    const original = new ForbiddenException('not enrolled');
    expect(mapProviderError(original, LABEL)).toBe(original);
  });

  describe('API key failures -> 400', () => {
    const expected = `${LABEL} rejected the configured API key. Ask your administrator to check the key, or switch to another AI provider.`;

    it.each([
      ['status 401', withStatus('nope', 401)],
      ['status 403', withStatus('nope', 403)],
      ['invalid api key', new Error('Invalid API key supplied')],
      ['incorrect api key', new Error('Incorrect API key provided: sk-abc')],
      ['authentication', new Error('authentication_error')],
      ['unauthorized', new Error('Unauthorized')],
      ['permission_denied', new Error('PERMISSION_DENIED: caller lacks access')],
      ['api key not valid', new Error('API key not valid. Please pass a valid key.')],
    ])('maps %s to a BadRequest key message', (_name, err) => {
      const mapped = mapProviderError(err, LABEL);
      expect(mapped).toBeInstanceOf(BadRequestException);
      expect(mapped.getStatus()).toBe(400);
      expect(mapped.message).toBe(expected);
    });

    it('never echoes the upstream body back to the browser', () => {
      const mapped = mapProviderError(
        withStatus('Incorrect API key provided: sk-live-9f2b (request req_7788)', 401),
        LABEL,
      );
      expect(mapped.message).not.toMatch(/sk-live-9f2b|req_7788/);
    });
  });

  describe('rate limits and quota -> 503', () => {
    const expected = `${LABEL} is rate-limited right now. Wait a moment, or switch to another AI provider.`;

    it.each([
      ['status 429', withStatus('slow down', 429)],
      ['rate limit', new Error('Rate limit reached for gpt-4o')],
      ['quota', new Error('You exceeded your current quota')],
      ['resource_exhausted', new Error('RESOURCE_EXHAUSTED')],
    ])('maps %s to a ServiceUnavailable rate-limit message', (_name, err) => {
      const mapped = mapProviderError(err, LABEL);
      expect(mapped).toBeInstanceOf(ServiceUnavailableException);
      expect(mapped.getStatus()).toBe(503);
      expect(mapped.message).toBe(expected);
    });
  });

  describe('bad model -> 400', () => {
    const expected = `${LABEL} could not use the configured model. Ask your administrator to check the model name, or switch to another AI provider.`;

    it.each([
      ['status 404', withStatus('nope', 404)],
      ['model_not_found', new Error('model_not_found')],
      ['does not exist', new Error('The model `gpt-9` does not exist')],
      ['invalid model', new Error('Invalid model name')],
      ['not found', new Error('publisher model not found')],
    ])('maps %s to a BadRequest model message', (_name, err) => {
      const mapped = mapProviderError(err, LABEL);
      expect(mapped).toBeInstanceOf(BadRequestException);
      expect(mapped.getStatus()).toBe(400);
      expect(mapped.message).toBe(expected);
    });
  });

  describe('timeouts -> 504', () => {
    const expected = `${LABEL} took too long to respond. Try again, or switch to another AI provider.`;

    it.each([
      ['status 408', withStatus('nope', 408)],
      ['status 504', withStatus('nope', 504)],
      ['timeout', new Error('socket timeout')],
      ['timed out', new Error('Request timed out')],
      ['deadline', new Error('DEADLINE_EXCEEDED')],
    ])('maps %s to a GatewayTimeout message', (_name, err) => {
      const mapped = mapProviderError(err, LABEL);
      expect(mapped).toBeInstanceOf(GatewayTimeoutException);
      expect(mapped.getStatus()).toBe(504);
      expect(mapped.message).toBe(expected);
    });
  });

  describe('upstream outages -> 503', () => {
    const expected = `${LABEL} is temporarily unavailable. Try again shortly, or switch to another AI provider.`;

    it.each([
      ['status 500', withStatus('boom', 500)],
      ['status 502', withStatus('boom', 502)],
      ['status 503', withStatus('boom', 503)],
      ['overloaded', new Error('Overloaded')],
      ['unavailable', new Error('The service is currently unavailable')],
      ['internal error', new Error('An internal error has occurred')],
    ])('maps %s to a ServiceUnavailable outage message', (_name, err) => {
      const mapped = mapProviderError(err, LABEL);
      expect(mapped).toBeInstanceOf(ServiceUnavailableException);
      expect(mapped.getStatus()).toBe(503);
      expect(mapped.message).toBe(expected);
    });
  });

  describe('unusable payloads -> 502', () => {
    const expected = `${LABEL} returned an unusable response. Try again, or switch to another AI provider.`;

    it.each([
      ['empty', new Error('empty response')],
      ['no content', new Error('no content returned')],
      ['malformed', new Error('malformed function call')],
      ['json', new Error('Unexpected token in JSON at position 0')],
    ])('maps %s to a BadGateway unusable message', (_name, err) => {
      const mapped = mapProviderError(err, LABEL);
      expect(mapped).toBeInstanceOf(BadGatewayException);
      expect(mapped.getStatus()).toBe(502);
      expect(mapped.message).toBe(expected);
    });
  });

  describe('anything else -> generic 502', () => {
    const expected = `${LABEL} could not complete that request. Try again, or switch to another AI provider.`;

    it.each([
      ['an unrecognised Error', new Error('something weird happened')],
      ['an Error with no message', new Error('')],
      ['undefined', undefined],
      ['null', null],
      ['a number', 42],
      ['a bare object', { foo: 'bar' }],
    ])('maps %s to the generic BadGateway message', (_name, err) => {
      const mapped = mapProviderError(err, LABEL);
      expect(mapped).toBeInstanceOf(BadGatewayException);
      expect(mapped.getStatus()).toBe(502);
      expect(mapped.message).toBe(expected);
    });
  });

  it('matches keywords case-insensitively', () => {
    expect(mapProviderError(new Error('INVALID API KEY'), LABEL).getStatus()).toBe(400);
    expect(mapProviderError(new Error('RATE LIMIT'), LABEL).getStatus()).toBe(503);
  });

  it('reads keywords out of a thrown string', () => {
    const mapped = mapProviderError('Rate limit exceeded', LABEL);
    expect(mapped).toBeInstanceOf(ServiceUnavailableException);
    expect(mapped.message).toMatch(/rate-limited/);
  });

  it('reads the status off statusCode when status is absent', () => {
    const mapped = mapProviderError(
      Object.assign(new Error('nope'), { statusCode: 429 }),
      LABEL,
    );
    expect(mapped.getStatus()).toBe(503);
    expect(mapped.message).toMatch(/rate-limited/);
  });

  it('reads the status off response.status when the SDK nests it', () => {
    const mapped = mapProviderError({ response: { status: 401 } }, LABEL);
    expect(mapped.getStatus()).toBe(400);
    expect(mapped.message).toMatch(/rejected the configured API key/);
  });

  it('prefers the key branch over the rate-limit branch when both match', () => {
    const mapped = mapProviderError(withStatus('rate limit exceeded', 401), LABEL);
    expect(mapped.getStatus()).toBe(400);
    expect(mapped.message).toMatch(/rejected the configured API key/);
  });

  it('prefers the rate-limit branch over the model branch when both match', () => {
    const mapped = mapProviderError(new Error('quota for model not found'), LABEL);
    expect(mapped.getStatus()).toBe(503);
    expect(mapped.message).toMatch(/rate-limited/);
  });

  it('uses the provider label it was given', () => {
    expect(mapProviderError(new Error('overloaded'), 'Anthropic Claude').message).toBe(
      'Anthropic Claude is temporarily unavailable. Try again shortly, or switch to another AI provider.',
    );
  });

  it('always returns an HttpException so Nest can serialise it', () => {
    expect(mapProviderError(new Error('who knows'), LABEL)).toBeInstanceOf(HttpException);
  });
});

describe('assertNonEmptyText', () => {
  const expected = `${LABEL} returned an empty response. Try again, or switch to another AI provider.`;

  it.each([
    ['an empty string', ''],
    ['spaces', '   '],
    ['newlines and tabs', '\n\t \r\n'],
    ['null', null],
    ['undefined', undefined],
  ])('throws a BadGateway empty-response error for %s', (_name, text) => {
    let caught: unknown;
    try {
      assertNonEmptyText(text, LABEL);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadGatewayException);
    expect((caught as BadGatewayException).getStatus()).toBe(502);
    expect((caught as BadGatewayException).message).toBe(expected);
  });

  it('returns the text trimmed of surrounding whitespace', () => {
    expect(assertNonEmptyText('  {"ok":true}\n', LABEL)).toBe('{"ok":true}');
  });

  it('keeps interior whitespace and newlines intact', () => {
    expect(assertNonEmptyText('\n line one\n line two \n', LABEL)).toBe(
      'line one\n line two',
    );
  });

  it('accepts text that is only punctuation', () => {
    expect(assertNonEmptyText('{}', LABEL)).toBe('{}');
  });
});
