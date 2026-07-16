import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const { PDFParse }: {
  PDFParse: new (options: { data: Buffer }) => {
    getText: () => Promise<{ text?: string }>;
    destroy?: () => Promise<void> | void;
  };
} = require('pdf-parse');

export interface CourseContextFilter {
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
}

export interface StudentPlacement {
  sectionId: number;
  sectionNum: number;
  groupId: number;
  groupName: string;
  availabilityJson: string;
}

export interface PracticeQuizQuestionAnswer {
  text: string;
  fraction: number;
}

export interface PracticeQuizQuestion {
  type: 'multichoice' | 'truefalse';
  name: string;
  questiontext: string;
  answers: PracticeQuizQuestionAnswer[];
}

export interface CreatedPracticeQuiz {
  quizId: number;
  cmId: number;
  name: string;
  viewUrl: string;
}

interface CourseContextDocument {
  courseId: number;
  courseName?: string;
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
  moduleId?: number;
  moduleName?: string;
  contentType: string;
  fileName?: string;
  source?: string;
  lastUpdated?: number;
  text: string;
}

/**
 * ContextService is the API boundary for Moodle course content.
 *
 * It keeps the existing on-demand ingestion model, but stores richer in-memory
 * documents so section conversations can receive section-specific context.
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

  async getContext(
    courseId: number,
    question: string,
    filter: CourseContextFilter = {},
  ): Promise<string> {
    if (courseId <= 1) {
      return '';
    }

    const documents = await this.getCourseDocuments(courseId);
    return formatDocumentsForPrompt(documents, filter, question);
  }

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
   * Ensure the shared AI Content section and private student group exist.
   * Idempotent Moodle write used by Path A (and later Path B quiz creation).
   */
  async ensureStudentPlacement(
    courseId: number,
    moodleUserId: number,
  ): Promise<StudentPlacement> {
    if (courseId <= 1) {
      throw new Error('courseId must be a real course (greater than 1)');
    }
    if (moodleUserId < 1) {
      throw new Error('moodleUserId must be a positive integer');
    }

    const result = await this.callMoodleApi<{
      sectionid: number;
      sectionnum: number;
      groupid: number;
      groupname: string;
      availabilityjson: string;
    }>('local_syllentras_ai_ensure_student_placement', {
      courseid: courseId,
      userid: moodleUserId,
    });

    return {
      sectionId: result.sectionid,
      sectionNum: result.sectionnum,
      groupId: result.groupid,
      groupName: result.groupname,
      availabilityJson: result.availabilityjson,
    };
  }

  /**
   * Create a private practice quiz for one student in the AI Content section.
   */
  async createPracticeQuiz(input: {
    courseId: number;
    moodleUserId: number;
    name: string;
    intro?: string;
    questions: PracticeQuizQuestion[];
  }): Promise<CreatedPracticeQuiz> {
    if (input.courseId <= 1) {
      throw new Error('courseId must be a real course (greater than 1)');
    }
    if (input.moodleUserId < 1) {
      throw new Error('moodleUserId must be a positive integer');
    }
    if (!input.questions.length) {
      throw new Error('At least one question is required');
    }

    await this.ensureStudentPlacement(input.courseId, input.moodleUserId);

    const result = await this.callMoodleApi<{
      quizid: number;
      cmid: number;
      name: string;
      viewurl: string;
    }>(
      'local_syllentras_ai_create_practice_quiz',
      {
        courseid: input.courseId,
        userid: input.moodleUserId,
        name: input.name,
        intro: input.intro ?? '',
        questions: input.questions.map((q) => ({
          type: q.type,
          name: q.name,
          questiontext: q.questiontext,
          answers: q.answers.map((a) => ({
            text: a.text,
            fraction: a.fraction,
          })),
        })),
      },
      'POST',
    );

    return {
      quizId: result.quizid,
      cmId: result.cmid,
      name: result.name,
      viewUrl: this.toPublicMoodleUrl(result.viewurl),
    };
  }

  /** Rewrite docker-internal Moodle hosts so browser links work. */
  private toPublicMoodleUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
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

  private async getCourseDocuments(
    courseId: number,
  ): Promise<CourseContextDocument[]> {
    const cacheKey = `course_context_documents_v4_${courseId}`;
    const cached = await this.cache.get<CourseContextDocument[]>(cacheKey);
    if (cached) {
      this.logger.debug(`Course document cache hit for course ${courseId}`);
      return cached;
    }

    this.logger.log(`Fetching structured course content from Moodle for ${courseId}`);
    const documents = await this.fetchCourseDocuments(courseId);
    await this.cache.set(cacheKey, documents);
    return documents;
  }

  private async fetchCourseDocuments(
    courseId: number,
  ): Promise<CourseContextDocument[]> {
    const [course, sections, pages, assignments, forums] = await Promise.all([
      this.fetchCourseSummary(courseId),
      this.callMoodleApi<MoodleCourseSection[]>('core_course_get_contents', {
        courseid: courseId,
      }),
      this.fetchPages(courseId),
      this.fetchAssignments(courseId),
      this.fetchForums(courseId),
    ]);

    const documents: CourseContextDocument[] = [];

    if (course?.summary) {
      documents.push({
        courseId,
        courseName: course.fullname,
        contentType: 'course_summary',
        source: `course:${courseId}`,
        lastUpdated: course.timemodified,
        text: stripHtml(course.summary),
      });
    }

    for (const section of sections) {
      const sectionMeta = normalizeSection(section);
      if (sectionMeta.summary) {
        documents.push({
          courseId,
          courseName: course?.fullname,
          ...sectionMeta,
          contentType: 'section_summary',
          source: `section:${sectionMeta.sectionId ?? sectionMeta.sectionNumber}`,
          lastUpdated: section.timemodified,
          text: sectionMeta.summary,
        });
      }

      for (const module of section.modules ?? []) {
        const moduleBase = {
          courseId,
          courseName: course?.fullname,
          ...sectionMeta,
          moduleId: module.id,
          moduleName: module.name,
          source: module.url,
          lastUpdated: module.dates?.find((d) => d.timestamp)?.timestamp,
        };

        if (module.description) {
          documents.push({
            ...moduleBase,
            contentType: `${module.modname}_description`,
            text: stripHtml(module.description),
          });
        }

        for (const content of module.contents ?? []) {
          if (content.type === 'content' && content.content) {
            documents.push({
              ...moduleBase,
              contentType: `${module.modname}_inline_content`,
              text: stripHtml(content.content),
            });
          }

          if (content.type === 'file' && content.fileurl) {
            const fileDocument = await this.fetchFileDocument(
              moduleBase,
              content,
              module.modname,
            );
            if (fileDocument) {
              documents.push(fileDocument);
            }
          }
        }

        if (module.modname === 'page') {
          const page = pages.find((p) => p.coursemodule === module.id);
          if (page?.content) {
            documents.push({
              ...moduleBase,
              contentType: 'page',
              lastUpdated: page.timemodified ?? moduleBase.lastUpdated,
              text: stripHtml(page.content),
            });
          }
        }

        if (module.modname === 'assign') {
          const assignment = assignments.find((a) => a.cmid === module.id);
          if (assignment?.intro) {
            documents.push({
              ...moduleBase,
              contentType: 'assignment',
              lastUpdated: assignment.timemodified ?? moduleBase.lastUpdated,
              text: stripHtml(assignment.intro),
            });
          }

          for (const attachment of assignment?.introattachments ?? []) {
            if (!attachment.fileurl) {
              continue;
            }
            const fileDocument = await this.fetchFileDocument(
              moduleBase,
              {
                type: 'file',
                filename: attachment.filename,
                filepath: attachment.filepath,
                fileurl: attachment.fileurl,
                mimetype: attachment.mimetype,
                timemodified: attachment.timemodified,
              },
              module.modname,
            );
            if (fileDocument) {
              documents.push(fileDocument);
            }
          }
        }

        if (module.modname === 'forum') {
          const forum = forums.find((f) => f.cmid === module.id);
          if (forum?.intro) {
            documents.push({
              ...moduleBase,
              contentType: forum.type === 'news' ? 'announcement_forum' : 'forum',
              lastUpdated: forum.timemodified ?? moduleBase.lastUpdated,
              text: stripHtml(forum.intro),
            });
          }

          if (forum) {
            const posts = await this.fetchForumPosts(forum);
            for (const post of posts) {
              documents.push({
                ...moduleBase,
                contentType: forum.type === 'news' ? 'announcement_post' : 'forum_post',
                source: `forum:${forum.id}:discussion:${post.discussionId}:post:${post.id}`,
                lastUpdated: post.modified ?? post.created ?? moduleBase.lastUpdated,
                text: formatForumPostText(post),
              });
            }
          }
        }
      }
    }

    return documents.filter((doc) => doc.text.trim().length > 0);
  }

  private async fetchCourseSummary(
    courseId: number,
  ): Promise<MoodleCourseSummary | undefined> {
    try {
      const courses = await this.callMoodleApi<MoodleCourseSummary[]>(
        'core_course_get_courses',
        { options: { ids: [courseId] } },
      );
      return courses.find((c) => c.id === courseId);
    } catch (err) {
      this.logger.warn(`Failed to fetch course summary: ${(err as Error).message}`);
      return undefined;
    }
  }

  private async fetchPages(courseId: number): Promise<MoodlePage[]> {
    try {
      const pages = await this.callMoodleApi<{ pages: MoodlePage[] }>(
        'mod_page_get_pages_by_courses',
        { courseids: [courseId] },
      );
      return pages.pages ?? [];
    } catch (err) {
      this.logger.warn(`Failed to fetch pages: ${(err as Error).message}`);
      return [];
    }
  }

  private async fetchAssignments(courseId: number): Promise<MoodleAssignment[]> {
    try {
      const response = await this.callMoodleApi<MoodleAssignmentsResponse>(
        'mod_assign_get_assignments',
        { courseids: [courseId], includenotenrolledcourses: 1 },
      );
      return response.courses.flatMap((course) => course.assignments ?? []);
    } catch (err) {
      this.logger.warn(`Failed to fetch assignments: ${(err as Error).message}`);
      return [];
    }
  }

  private async fetchForums(courseId: number): Promise<MoodleForum[]> {
    try {
      return await this.callMoodleApi<MoodleForum[]>(
        'mod_forum_get_forums_by_courses',
        { courseids: [courseId] },
      );
    } catch (err) {
      this.logger.warn(`Failed to fetch forums: ${(err as Error).message}`);
      return [];
    }
  }

  private async fetchForumPosts(forum: MoodleForum): Promise<MoodleForumPost[]> {
    if (!forum.id) {
      return [];
    }

    try {
      const response = await this.callMoodleApi<MoodleForumDiscussionsResponse>(
        'mod_forum_get_forum_discussions',
        { forumid: forum.id },
      );
      const discussions = response.discussions ?? [];
      const posts: MoodleForumPost[] = [];

      for (const discussion of discussions) {
        const discussionId = discussion.discussion ?? discussion.id;
        if (!discussionId) {
          continue;
        }

        try {
          const postResponse = await this.callMoodleApi<MoodleForumPostsResponse>(
            'mod_forum_get_discussion_posts',
            { discussionid: discussionId },
          );
          posts.push(
            ...(postResponse.posts ?? []).map((post) => ({
              ...post,
              discussionId,
            })),
          );
        } catch (err) {
          this.logger.warn(
            `Failed to fetch posts for forum discussion ${discussionId}: ${(err as Error).message}`,
          );
          // Moodle includes the first post in the discussions response, so use it
          // as a fallback when the post-detail endpoint is unavailable.
          if (discussion.message) {
            posts.push({
              id: discussion.id,
              discussionId,
              subject: discussion.subject ?? discussion.name,
              message: discussion.message,
              created: discussion.created,
              modified: discussion.timemodified,
              userfullname: discussion.userfullname,
            });
          }
        }
      }

      return posts;
    } catch (err) {
      this.logger.warn(
        `Failed to fetch forum discussions for ${forum.name}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async fetchFileDocument(
    moduleBase: Omit<CourseContextDocument, 'contentType' | 'text'>,
    content: MoodleContent,
    modname: string,
  ): Promise<CourseContextDocument | null> {
    const fileName = content.filename;
    const mimeType = content.mimetype ?? '';
    const source = content.fileurl ?? moduleBase.source;
    const baseDocument = {
      ...moduleBase,
      source,
      fileName,
      lastUpdated: content.timemodified ?? moduleBase.lastUpdated,
    };

    const isPdf = mimeType === 'application/pdf' || fileName?.toLowerCase().endsWith('.pdf');

    try {
      if (isPdf) {
        const buffer = await this.downloadMoodleFile(content.fileurl!);
        if (!looksLikePdf(buffer)) {
          throw new Error('Moodle returned a non-PDF response for this PDF file');
        }

        const parsed = await parsePdfText(buffer);
        const text = parsed.text?.trim() ?? '';
        if (!text) {
          throw new Error('PDF parsed successfully but no text was extracted');
        }

        return {
          ...baseDocument,
          contentType: `${modname}_pdf`,
          text,
        };
      }

      if (mimeType.startsWith('text/') || mimeType === 'application/json') {
        const buffer = await this.downloadMoodleFile(content.fileurl!);
        return {
          ...baseDocument,
          contentType: `${modname}_file`,
          text: buffer.toString('utf8'),
        };
      }

      return {
        ...baseDocument,
        contentType: `${modname}_file_metadata`,
        text: [fileName, mimeType].filter(Boolean).join(' '),
      };
    } catch (err) {
      this.logger.warn(
        `Failed to fetch file ${fileName ?? source}: ${(err as Error).message}`,
      );

      if (isPdf) {
        // If PDF text is unavailable, do not feed filename-only metadata to the AI
        // as though it were the file contents.
        return null;
      }

      return {
        ...baseDocument,
        contentType: `${modname}_file_metadata`,
        text: [fileName, mimeType].filter(Boolean).join(' '),
      };
    }
  }

  private async downloadMoodleFile(fileUrl: string): Promise<Buffer> {
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

  private normalizeMoodleFileUrl(fileUrl: string): URL {
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

  private async callMoodleApi<T>(
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
      throw new Error(
        `Moodle API returned non-JSON: ${body.slice(0, 200)}`,
      );
    }

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

  private httpPostForm(
    url: URL,
    form: URLSearchParams,
    hostHeader?: string,
  ): Promise<{ status: number; body: string }> {
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const payload = form.toString();

    return new Promise((resolve, reject) => {
      const req = requestFn(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(payload),
            ...(hostHeader ? { Host: hostHeader } : {}),
          },
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

async function parsePdfText(buffer: Buffer): Promise<{ text?: string }> {
  const parser = new PDFParse({ data: buffer });
  try {
    return await parser.getText();
  } finally {
    await parser.destroy?.();
  }
}

function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('utf8') === '%PDF-';
}

function parseMoodleJsonError(buffer: Buffer): string | null {
  const firstBytes = buffer.subarray(0, 64).toString('utf8').trimStart();
  if (!firstBytes.startsWith('{')) {
    return null;
  }

  try {
    const data = JSON.parse(buffer.toString('utf8')) as {
      error?: string;
      message?: string;
      exception?: string;
    };
    return data.error ?? data.message ?? data.exception ?? null;
  } catch {
    return null;
  }
}

function normalizeSection(section: MoodleCourseSection): {
  sectionId?: number;
  sectionNumber?: number;
  sectionName?: string;
  summary?: string;
} {
  const rawName = section.name?.trim();
  const sectionName =
    rawName && rawName !== '$@NULL@$'
      ? rawName
      : section.section === 0
        ? 'General'
        : `Section ${section.section}`;

  return {
    sectionId: section.id,
    sectionNumber: section.section,
    sectionName,
    summary: section.summary ? stripHtml(section.summary) : undefined,
  };
}

function formatDocumentsForPrompt(
  documents: CourseContextDocument[],
  filter: CourseContextFilter,
  question: string,
): string {
  const matching = documents.filter((doc) => matchesSection(doc, filter));
  const other = documents.filter((doc) => !matchesSection(doc, filter));
  const questionTerms = question
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 3);

  const ordered =
    matching.length > 0
      ? [
          ...matching.sort((a, b) => relevanceScore(b, questionTerms) - relevanceScore(a, questionTerms)),
          ...other.sort((a, b) => relevanceScore(b, questionTerms) - relevanceScore(a, questionTerms)),
        ]
      : documents.sort((a, b) => relevanceScore(b, questionTerms) - relevanceScore(a, questionTerms));

  return ordered
    .slice(0, 80)
    .map(formatDocument)
    .join('\n\n')
    .trim();
}

function matchesSection(
  doc: CourseContextDocument,
  filter: CourseContextFilter,
): boolean {
  if (filter.sectionId && doc.sectionId === filter.sectionId) {
    return true;
  }

  if (
    filter.sectionNumber !== undefined &&
    doc.sectionNumber === filter.sectionNumber
  ) {
    return true;
  }

  return !!(
    filter.sectionName &&
    doc.sectionName?.toLowerCase() === filter.sectionName.toLowerCase()
  );
}

function relevanceScore(
  doc: CourseContextDocument,
  questionTerms: string[],
): number {
  const haystack = `${doc.sectionName ?? ''} ${doc.moduleName ?? ''} ${doc.fileName ?? ''} ${doc.text}`.toLowerCase();
  return questionTerms.reduce(
    (score, term) => score + (haystack.includes(term) ? 1 : 0),
    0,
  );
}

function formatDocument(doc: CourseContextDocument): string {
  const meta = [
    `type=${doc.contentType}`,
    doc.courseName ? `course=${doc.courseName}` : undefined,
    doc.sectionName ? `section=${doc.sectionName}` : undefined,
    doc.moduleName ? `module=${doc.moduleName}` : undefined,
    doc.fileName ? `file=${doc.fileName}` : undefined,
    doc.source ? `source=${doc.source}` : undefined,
    doc.lastUpdated ? `updated=${new Date(doc.lastUpdated * 1000).toISOString()}` : undefined,
  ].filter(Boolean);

  return `### ${doc.sectionName ?? 'Course'}${doc.moduleName ? ` / ${doc.moduleName}` : ''}\nMetadata: ${meta.join('; ')}\n${doc.text}`;
}

function formatForumPostText(post: MoodleForumPost): string {
  return [
    post.subject ? `Subject: ${stripHtml(post.subject)}` : undefined,
    post.userfullname ? `Author: ${stripHtml(post.userfullname)}` : undefined,
    stripHtml(post.message),
  ].filter(Boolean).join('\n');
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

interface MoodleCourseSection {
  id?: number;
  section?: number;
  name?: string;
  summary?: string;
  timemodified?: number;
  modules?: MoodleModule[];
}

interface MoodleModule {
  id: number;
  name: string;
  modname: string;
  url?: string;
  description?: string;
  contents?: MoodleContent[];
  dates?: Array<{ timestamp?: number }>;
}

interface MoodleContent {
  type: string;
  content?: string;
  filename?: string;
  filepath?: string;
  fileurl?: string;
  mimetype?: string;
  timemodified?: number;
}

interface MoodlePage {
  coursemodule: number;
  content: string;
  timemodified?: number;
}

interface MoodleAssignmentAttachment {
  filename?: string;
  filepath?: string;
  fileurl?: string;
  mimetype?: string;
  timemodified?: number;
}

interface MoodleAssignment {
  cmid: number;
  name: string;
  intro?: string;
  introattachments?: MoodleAssignmentAttachment[];
  timemodified?: number;
}

interface MoodleAssignmentsResponse {
  courses: Array<{
    assignments?: MoodleAssignment[];
  }>;
}

interface MoodleForum {
  id: number;
  cmid: number;
  name: string;
  type?: string;
  intro?: string;
  timemodified?: number;
}

interface MoodleForumDiscussion {
  id: number;
  discussion?: number;
  name?: string;
  subject?: string;
  message?: string;
  created?: number;
  timemodified?: number;
  userfullname?: string;
}

interface MoodleForumDiscussionsResponse {
  discussions?: MoodleForumDiscussion[];
}

interface MoodleForumPost {
  id: number;
  discussionId: number;
  subject?: string;
  message: string;
  created?: number;
  modified?: number;
  userfullname?: string;
}

interface MoodleForumPostsResponse {
  posts?: Omit<MoodleForumPost, 'discussionId'>[];
}

interface MoodleCourseSummary {
  id: number;
  fullname: string;
  summary?: string;
  timemodified?: number;
}
