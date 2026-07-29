import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { parseMoodleJsonError } from './context.helpers';

@Injectable()
export class MoodleClient {
  private readonly moodleUrl: string;
  private readonly moodleToken: string;
  /** Host header sent to moodle-docker's webserver (avoids Behat mode on http://webserver). */
  private readonly moodleHost: string;
  /** Optional browser-facing Moodle origin (e.g. Cloudflare tunnel). */
  private readonly moodlePublicUrl: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.moodleUrl = this.config.get<string>('MOODLE_INTERNAL_URL')!;
    this.moodleToken = this.config.get<string>('MOODLE_TOKEN')!;
    this.moodleHost =
      this.config.get<string>('MOODLE_INTERNAL_HOST') ?? 'localhost:8000';
    const publicUrl = (this.config.get<string>('MOODLE_PUBLIC_URL') ?? '').trim();
    this.moodlePublicUrl = publicUrl || undefined;
  }

  /** Rewrite docker-internal Moodle hosts so browser links work. */
  toPublicMoodleUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      const internalHost = this.moodleHost.split(':')[0] || 'localhost';
      const shouldRewrite =
        parsed.hostname === 'webserver' ||
        parsed.hostname === internalHost ||
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1';

      if (!shouldRewrite) {
        return parsed.toString();
      }

      if (this.moodlePublicUrl) {
        const publicOrigin = new URL(this.moodlePublicUrl);
        parsed.protocol = publicOrigin.protocol;
        parsed.hostname = publicOrigin.hostname;
        parsed.port = publicOrigin.port;
        return parsed.toString();
      }

      if (parsed.hostname === 'webserver') {
        const [host, port] = this.moodleHost.split(':');
        parsed.hostname = host || 'localhost';
        parsed.port = port || '8000';
        parsed.protocol = 'http:';
      }
      return parsed.toString();
    } catch {
      return rawUrl;
    }
  }

  /**
   * Convert Moodle webservice file URLs into normal browser pluginfile links.
   * webservice/pluginfile.php requires a token; logged-in students use /pluginfile.php.
   */
  toBrowserCitationUrl(rawUrl: string): string {
    try {
      const parsed = new URL(this.toPublicMoodleUrl(rawUrl));
      parsed.pathname = parsed.pathname.replace(
        /\/webservice\/pluginfile\.php\b/i,
        '/pluginfile.php',
      );
      parsed.searchParams.delete('token');
      parsed.searchParams.delete('forcedownload');
      return parsed.toString();
    } catch {
      return rawUrl;
    }
  }

  async downloadMoodleFile(fileUrl: string): Promise<Buffer> {
    const url = this.normalizeMoodleFileUrl(fileUrl);
    const hostHeader =
      url.hostname === 'webserver' ? this.moodleHost : undefined;
    const { status, body } = await this.httpGetBuffer(url, hostHeader);
    if (status < 200 || status >= 300) {
      throw new Error(`Moodle file download failed: ${status}`);
    }

    const moodleError = parseMoodleJsonError(body);
    if (moodleError) {
      throw new Error(`Moodle file access error: ${moodleError}`);
    }

    return body;
  }

  normalizeMoodleFileUrl(fileUrl: string): URL {
    const url = new URL(fileUrl);
    const internal = new URL(this.moodleUrl);
    const externalHost = this.moodleHost.split(':')[0];

    if (
      url.hostname === externalHost ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1'
    ) {
      url.protocol = internal.protocol;
      url.hostname = internal.hostname;
      url.port = internal.port;
    }

    if (!url.searchParams.has('token')) {
      url.searchParams.set('token', this.moodleToken);
    }

    return url;
  }

  async callMoodleApi<T>(
    wsfunction: string,
    params: Record<string, unknown>,
    method: 'GET' | 'POST' = 'GET',
  ): Promise<T> {
    const url = new URL(`${this.moodleUrl}/webservice/rest/server.php`);
    const bodyParams = new URLSearchParams();
    bodyParams.set('wstoken', this.moodleToken);
    bodyParams.set('wsfunction', wsfunction);
    bodyParams.set('moodlewsrestformat', 'json');

    for (const [key, value] of Object.entries(params)) {
      this.appendParams(bodyParams, key, value);
    }

    const hostHeader =
      url.hostname === 'webserver' ? this.moodleHost : undefined;

    let status: number;
    let body: string;

    if (method === 'POST') {
      ({ status, body } = await this.httpPostForm(url, bodyParams, hostHeader));
    } else {
      for (const [key, value] of bodyParams.entries()) {
        url.searchParams.set(key, value);
      }
      ({ status, body } = await this.httpGet(url, hostHeader));
    }

    if (status < 200 || status >= 300) {
      throw new Error(`Moodle API error: ${status}`);
    }

    let data: T & { exception?: string; message?: string };
    try {
      data = JSON.parse(body) as T & { exception?: string; message?: string };
    } catch {
      throw new Error(`Moodle API returned non-JSON: ${body.slice(0, 200)}`);
    }

    if (data.exception) {
      throw new Error(
        `Moodle API exception: ${data.message ?? data.exception}`,
      );
    }

    return data as T;
  }

  private appendParams(
    searchParams: URLSearchParams,
    key: string,
    value: unknown,
  ): void {
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        this.appendParams(searchParams, `${key}[${i}]`, v);
      });
      return;
    }

    if (value !== null && typeof value === 'object') {
      for (const [nestedKey, nestedValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        this.appendParams(searchParams, `${key}[${nestedKey}]`, nestedValue);
      }
      return;
    }

    searchParams.set(key, String(value));
  }

  /** Optional Host header for moodle-docker (avoids Behat mode / matches wwwroot). */
  private moodleRequestHeaders(hostHeader?: string): Record<string, string> | undefined {
    const headers: Record<string, string> = {};
    if (hostHeader) {
      headers.Host = hostHeader;
    }
    // When Moodle wwwroot is HTTPS behind sslproxy (e.g. Cloudflare tunnel),
    // internal http://webserver calls need to look like HTTPS to avoid 303s.
    if (this.moodlePublicUrl?.startsWith('https:')) {
      headers['X-Forwarded-Proto'] = 'https';
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  private httpPostForm(
    url: URL,
    form: URLSearchParams,
    hostHeader?: string,
  ): Promise<{ status: number; body: string }> {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const payload = form.toString();
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(payload),
      ...(this.moodleRequestHeaders(hostHeader) ?? {}),
    };

    return new Promise((resolve, reject) => {
      const req = requestFn(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 500,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  private httpGet(
    url: URL,
    hostHeader?: string,
  ): Promise<{ status: number; body: string }> {
    return this.httpGetBuffer(url, hostHeader).then(({ status, body }) => ({
      status,
      body: body.toString('utf8'),
    }));
  }

  private httpGetBuffer(
    url: URL,
    hostHeader?: string,
  ): Promise<{ status: number; body: Buffer }> {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const headers = this.moodleRequestHeaders(hostHeader);

    return new Promise((resolve, reject) => {
      const req = requestFn(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 500,
              body: Buffer.concat(chunks),
            });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }
}
