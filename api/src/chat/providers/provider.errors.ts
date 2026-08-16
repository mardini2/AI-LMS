import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Turn provider SDK / HTTP failures into student-safe Nest exceptions.
 * Never pass raw upstream bodies through — they can include request IDs,
 * partial keys, or other internals we do not want in the browser.
 */
export function mapProviderError(
  err: unknown,
  providerLabel: string,
): HttpException {
  if (err instanceof HttpException) {
    return err;
  }

  const status = extractStatus(err);
  const raw = extractMessage(err).toLowerCase();

  if (
    status === 401 ||
    status === 403 ||
    raw.includes('invalid api key') ||
    raw.includes('incorrect api key') ||
    raw.includes('authentication') ||
    raw.includes('unauthorized') ||
    raw.includes('permission_denied') ||
    raw.includes('api key not valid')
  ) {
    return new BadRequestException(
      `${providerLabel} rejected the configured API key. Ask your administrator to check the key, or switch to another AI provider.`,
    );
  }

  if (
    status === 429 ||
    raw.includes('rate limit') ||
    raw.includes('quota') ||
    raw.includes('resource_exhausted')
  ) {
    return new ServiceUnavailableException(
      `${providerLabel} is rate-limited right now. Wait a moment, or switch to another AI provider.`,
    );
  }

  if (
    status === 404 ||
    raw.includes('model_not_found') ||
    raw.includes('does not exist') ||
    raw.includes('invalid model') ||
    raw.includes('not found')
  ) {
    return new BadRequestException(
      `${providerLabel} could not use the configured model. Ask your administrator to check the model name, or switch to another AI provider.`,
    );
  }

  if (
    status === 408 ||
    status === 504 ||
    raw.includes('timeout') ||
    raw.includes('timed out') ||
    raw.includes('deadline')
  ) {
    return new GatewayTimeoutException(
      `${providerLabel} took too long to respond. Try again, or switch to another AI provider.`,
    );
  }

  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    raw.includes('overloaded') ||
    raw.includes('unavailable') ||
    raw.includes('internal error')
  ) {
    return new ServiceUnavailableException(
      `${providerLabel} is temporarily unavailable. Try again shortly, or switch to another AI provider.`,
    );
  }

  if (
    raw.includes('empty') ||
    raw.includes('no content') ||
    raw.includes('malformed') ||
    raw.includes('json')
  ) {
    return new BadGatewayException(
      `${providerLabel} returned an unusable response. Try again, or switch to another AI provider.`,
    );
  }

  return new BadGatewayException(
    `${providerLabel} could not complete that request. Try again, or switch to another AI provider.`,
  );
}

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const anyErr = err as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };
  return anyErr.status ?? anyErr.statusCode ?? anyErr.response?.status;
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message || '';
  if (typeof err === 'string') return err;
  return '';
}

export function assertNonEmptyText(
  text: string | null | undefined,
  providerLabel: string,
): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    throw new BadGatewayException(
      `${providerLabel} returned an empty response. Try again, or switch to another AI provider.`,
    );
  }
  return trimmed;
}
