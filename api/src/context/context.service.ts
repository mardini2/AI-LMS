import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

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

  constructor(
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    this.moodleUrl = this.config.get<string>('MOODLE_INTERNAL_URL')!;
    this.moodleToken = this.config.get<string>('MOODLE_TOKEN')!;
  }

  /**
   * Returns relevant course context for the given courseId and question.
   *
   * Simple route: ignores the question and returns all cached course content.
   * RAG route (future): uses the question to retrieve only relevant chunks.
   */
  async getContext(courseId: number, question: string): Promise<string> {
    if (courseId === 0) {
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
      if (Array.isArray(value)) {
        value.forEach((v, i) => url.searchParams.set(`${key}[${i}]`, String(v)));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Moodle API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as T;
    return data;
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
