import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * ContextService — the key abstraction over course content retrieval.
 *
 * Current implementation: Simple Route
 *   Fetches full course content from Moodle's REST API and caches it in memory.
 *   The entire content is returned for use as LLM context.
 *
 * Future implementation: RAG Route
 *   Swap the internals of getContext() to do a vector similarity search instead.
 *   The method signature stays identical — nothing outside this service needs to change.
 */
@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);
  private readonly moodleUrl: string;
  private readonly moodleToken: string;
  /** Host header sent to moodle-docker's webserver (avoids Behat mode on http://webserver). */
  private readonly moodleHost: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    this.moodleUrl = this.config.get<string>('MOODLE_INTERNAL_URL')!;
    this.moodleToken = this.config.get<string>('MOODLE_TOKEN')!;
    this.moodleHost =
      this.config.get<string>('MOODLE_INTERNAL_HOST') ?? 'localhost:8000';
  }

  /**
   * Returns relevant course context for the given courseId and question.
   *
   * Simple route: ignores the question and returns all cached course content.
   * RAG route (future): uses the question to retrieve only relevant chunks.
   */
  async getContext(courseId: number, question: string): Promise<string> {
    // Course 0 = non-course page; course 1 = Moodle site home (content disabled by default).
    // Both have no meaningful course material to send as LLM context.
    if (courseId <= 1) {
      return '';
    }

    const cacheKey = `course_context_${courseId}`;
    const cached = await this.cache.get<string>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for course ${courseId}`);
      return cached;
    }

    this.logger.log(`Fetching course content from Moodle for course ${courseId}`);
    const content = await this.fetchCourseContent(courseId);
    await this.cache.set(cacheKey, content);
    return content;
  }

  /**
   * Resolves the human-readable course name. Uses the name from the plugin
   * when available, otherwise falls back to Moodle's core_course_get_courses.
   */
  async resolveCourseName(
    courseId: number,
    providedName?: string,
  ): Promise<string | undefined> {
    if (courseId <= 1) {
      return undefined;
    }

    if (providedName?.trim()) {
      return providedName.trim();
    }

    const cacheKey = `course_name_${courseId}`;
    const cached = await this.cache.get<string>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const courses = await this.callMoodleApi<MoodleCourseSummary[]>(
        'core_course_get_courses',
        { options: { ids: [courseId] } },
      );
      const name = courses.find((c) => c.id === courseId)?.fullname;
      if (name) {
        await this.cache.set(cacheKey, name);
      }
      return name;
    } catch (err) {
      this.logger.warn(
        `Failed to resolve course name for ${courseId}: ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  /**
   * Returns course names the user is enrolled in (excludes site home).
   */
  async getEnrolledCourseNames(moodleUserId: number): Promise<string[]> {
    const cacheKey = `user_courses_${moodleUserId}`;
    const cached = await this.cache.get<string[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const courses = await this.callMoodleApi<MoodleCourseSummary[]>(
        'core_enrol_get_users_courses',
        { userid: moodleUserId },
      );

      const names = courses
        .filter((c) => c.id > 1 && c.fullname)
        .map((c) => c.fullname);

      await this.cache.set(cacheKey, names);
      return names;
    } catch (err) {
      this.logger.warn(
        `Failed to fetch enrolled courses for user ${moodleUserId}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Fetches and flattens all text content from a Moodle course via REST API.
   */
  private async fetchCourseContent(courseId: number): Promise<string> {
    const sections = await this.callMoodleApi<MoodleCourseSection[]>(
      'core_course_get_contents',
      { courseid: courseId },
    );

    const parts: string[] = [];

    for (const section of sections) {
      if (section.name) {
        parts.push(`\n## ${section.name}\n`);
      }

      for (const module of section.modules ?? []) {
        if (module.name) {
          parts.push(`\n### ${module.name}`);
        }

        for (const content of module.contents ?? []) {
          if (content.type === 'content' && content.content) {
            // Strip HTML tags from inline content.
            parts.push(stripHtml(content.content));
          }
        }

        // Fetch full HTML content for page-type activities.
        if (module.modname === 'page' && module.url) {
          try {
            const pages = await this.callMoodleApi<{ pages: MoodlePage[] }>(
              'mod_page_get_pages_by_courses',
              { courseids: [courseId] },
            );
            const page = pages.pages?.find((p) => p.coursemodule === module.id);
            if (page?.content) {
              parts.push(stripHtml(page.content));
            }
          } catch {
            this.logger.warn(`Failed to fetch page content for module ${module.id}`);
          }
        }
      }
    }

    return parts.join('\n').trim();
  }

  private async callMoodleApi<T>(wsfunction: string, params: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.moodleUrl}/webservice/rest/server.php`);
    url.searchParams.set('wstoken', this.moodleToken);
    url.searchParams.set('wsfunction', wsfunction);
    url.searchParams.set('moodlewsrestformat', 'json');

    for (const [key, value] of Object.entries(params)) {
      this.appendParams(url.searchParams, key, value);
    }

    // moodle-docker sets $CFG->behat_wwwroot = 'http://webserver'. Requests whose
    // Host is "webserver" trigger Behat mode. fetch() cannot override Host (forbidden
    // header), so use node:http with Host: localhost:8000 to match $CFG->wwwroot.
    const hostHeader =
      url.hostname === 'webserver' ? this.moodleHost : undefined;
    const { status, body } = await this.httpGet(url, hostHeader);
    if (status < 200 || status >= 300) {
      throw new Error(`Moodle API error: ${status}`);
    }

    let data: T & { exception?: string; message?: string };
    try {
      data = JSON.parse(body) as T & { exception?: string; message?: string };
    } catch {
      throw new Error(
        `Moodle API returned non-JSON: ${body.slice(0, 200)}`,
      );
    }

    // Moodle returns HTTP 200 even for errors — detect the exception envelope.
    if (data.exception) {
      throw new Error(`Moodle API exception: ${data.message ?? data.exception}`);
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
        searchParams.set(`${key}[${i}]`, String(v));
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

  private httpGet(
    url: URL,
    hostHeader?: string,
  ): Promise<{ status: number; body: string }> {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const req = requestFn(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: hostHeader ? { Host: hostHeader } : undefined,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 500, body });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

interface MoodleCourseSection {
  name: string;
  modules: MoodleModule[];
}

interface MoodleModule {
  id: number;
  name: string;
  modname: string;
  url?: string;
  contents?: MoodleContent[];
}

interface MoodleContent {
  type: string;
  content?: string;
}

interface MoodlePage {
  coursemodule: number;
  content: string;
}

interface MoodleCourseSummary {
  id: number;
  fullname: string;
}
