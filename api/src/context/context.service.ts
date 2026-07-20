import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  extractSectionIndexNumbers,
  extractWeekNumbers,
  formatCitationTitle,
  formatDocumentsForPrompt,
  formatForumPostText,
  looksLikePdf,
  normalizeSection,
  parsePdfText,
  pickBestDocument,
  scopeIncludesSectionName,
  sectionNameMatchesWeekNumbers,
  stripHtml,
  uniqueCourseSections,
  type MoodleContent,
  type MoodleCourseSection,
  type MoodleForumPost,
} from './context.helpers';
import type {
  ConversationSectionHint,
  CourseContextDocument,
  CourseContextFilter,
  CourseSectionMeta,
  ResolvedSectionScope,
} from './context.types';
import { MoodleClient } from './moodle-client.service';

/**
 * ContextService is the API boundary for Moodle course content.
 *
 * It keeps the existing on-demand ingestion model, but stores richer in-memory
 * documents so section conversations can receive section-specific context.
 */
@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);
  /** In-flight fetches so concurrent callers share one Moodle ingest per course. */
  private readonly inflightDocuments = new Map<
    number,
    Promise<CourseContextDocument[]>
  >();

  constructor(
    private readonly moodle: MoodleClient,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

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

  /**
   * Pick the best course document to cite for a question/topic.
   */
  async findBestCitation(
    courseId: number,
    question: string,
    filter: CourseContextFilter = {},
  ): Promise<{ title: string; url?: string; snippet: string } | null> {
    if (courseId <= 1) {
      return null;
    }

    const documents = await this.getCourseDocuments(courseId);
    const best = pickBestDocument(documents, filter, question);
    if (!best?.text?.trim()) {
      return null;
    }

    const title = formatCitationTitle(best);
    const url =
      best.source && /^https?:\/\//i.test(best.source)
        ? this.moodle.toBrowserCitationUrl(best.source)
        : undefined;
    const snippet = best.text.replace(/\s+/g, ' ').trim().slice(0, 220);

    return { title, url, snippet };
  }

  /**
   * Resolve a practice-quiz scopeSummary to Moodle sections when the student
   * named specific weeks/sections. Returns empty arrays for general topics.
   *
   * "Week N" matches section *names* only (never Moodle topic index).
   * "Section N" matches Moodle topic index. Topic/resource titles are ignored.
   */
  async resolveSectionsFromScope(
    courseId: number,
    scopeSummary: string,
    conversationHint: ConversationSectionHint = {},
  ): Promise<ResolvedSectionScope> {
    if (courseId <= 1) {
      return { sectionIds: [], sectionNumbers: [] };
    }

    const documents = await this.getCourseDocuments(courseId);
    const sections = uniqueCourseSections(documents);
    if (sections.length === 0) {
      return { sectionIds: [], sectionNumbers: [] };
    }

    const scope = (scopeSummary ?? '').trim();
    const weekNumbers = extractWeekNumbers(scope);
    const sectionIndexNumbers = extractSectionIndexNumbers(scope);
    const matched = new Map<number, CourseSectionMeta>();

    for (const section of sections) {
      if (sectionNameMatchesWeekNumbers(section.sectionName, weekNumbers)) {
        matched.set(section.sectionId, section);
      }
    }

    for (const section of sections) {
      if (sectionIndexNumbers.has(section.sectionNumber)) {
        matched.set(section.sectionId, section);
      }
    }

    for (const section of sections) {
      if (
        section.sectionName &&
        scopeIncludesSectionName(scope, section.sectionName)
      ) {
        matched.set(section.sectionId, section);
      }
    }

    if (matched.size > 0) {
      const list = [...matched.values()];
      this.logger.log(
        `Resolved quiz scope to [${list
          .map((s) => s.sectionName ?? `section ${s.sectionNumber}`)
          .join(', ')}] for course ${courseId}`,
      );
      return {
        sectionIds: list.map((s) => s.sectionId),
        sectionNumbers: list.map((s) => s.sectionNumber),
      };
    }

    // Specific weeks/sections named but nothing matched — do not guess by index.
    if (weekNumbers.size > 0 || sectionIndexNumbers.size > 0) {
      this.logger.warn(
        `Could not resolve scope "${scope}" to Moodle sections for course ${courseId}` +
          (weekNumbers.size > 0
            ? ` (weeks: ${[...weekNumbers].join(', ')})`
            : '') +
          (sectionIndexNumbers.size > 0
            ? ` (section indexes: ${[...sectionIndexNumbers].join(', ')})`
            : ''),
      );
      return {
        sectionIds: [],
        sectionNumbers: [],
        unresolvedSpecificScope: true,
      };
    }

    // Section conversation + no explicit week/section names → scope to that section.
    if (
      conversationHint.sectionId ||
      conversationHint.sectionNumber !== undefined ||
      conversationHint.sectionName
    ) {
      const hintMatches = sections.filter(
        (s) =>
          (conversationHint.sectionId &&
            s.sectionId === conversationHint.sectionId) ||
          (conversationHint.sectionNumber !== undefined &&
            s.sectionNumber === conversationHint.sectionNumber) ||
          (conversationHint.sectionName &&
            s.sectionName?.toLowerCase() ===
              conversationHint.sectionName.toLowerCase()),
      );
      if (hintMatches.length > 0) {
        return {
          sectionIds: hintMatches.map((s) => s.sectionId),
          sectionNumbers: hintMatches.map((s) => s.sectionNumber),
        };
      }
    }

    return { sectionIds: [], sectionNumbers: [] };
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
      const courses = await this.moodle.callMoodleApi<MoodleCourseSummary[]>(
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
      const courses = await this.moodle.callMoodleApi<MoodleCourseSummary[]>(
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

  private async getCourseDocuments(
    courseId: number,
  ): Promise<CourseContextDocument[]> {
    const cacheKey = `course_context_documents_v4_${courseId}`;
    const cached = await this.cache.get<CourseContextDocument[]>(cacheKey);
    if (cached) {
      this.logger.debug(`Course document cache hit for course ${courseId}`);
      return cached;
    }

    const existing = this.inflightDocuments.get(courseId);
    if (existing) {
      return existing;
    }

    const fetchPromise = (async () => {
      this.logger.log(
        `Fetching structured course content from Moodle for ${courseId}`,
      );
      const documents = await this.fetchCourseDocuments(courseId);
      await this.cache.set(cacheKey, documents);
      return documents;
    })().finally(() => {
      this.inflightDocuments.delete(courseId);
    });

    this.inflightDocuments.set(courseId, fetchPromise);
    return fetchPromise;
  }

  private async fetchCourseDocuments(
    courseId: number,
  ): Promise<CourseContextDocument[]> {
    const [course, sections, pages, assignments, forums] = await Promise.all([
      this.fetchCourseSummary(courseId),
      this.moodle.callMoodleApi<MoodleCourseSection[]>(
        'core_course_get_contents',
        {
          courseid: courseId,
        },
      ),
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
              contentType:
                forum.type === 'news' ? 'announcement_forum' : 'forum',
              lastUpdated: forum.timemodified ?? moduleBase.lastUpdated,
              text: stripHtml(forum.intro),
            });
          }

          if (forum) {
            const posts = await this.fetchForumPosts(forum);
            for (const post of posts) {
              documents.push({
                ...moduleBase,
                contentType:
                  forum.type === 'news' ? 'announcement_post' : 'forum_post',
                source: `forum:${forum.id}:discussion:${post.discussionId}:post:${post.id}`,
                lastUpdated:
                  post.modified ?? post.created ?? moduleBase.lastUpdated,
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
      const courses = await this.moodle.callMoodleApi<MoodleCourseSummary[]>(
        'core_course_get_courses',
        { options: { ids: [courseId] } },
      );
      return courses.find((c) => c.id === courseId);
    } catch (err) {
      this.logger.warn(
        `Failed to fetch course summary: ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  private async fetchPages(courseId: number): Promise<MoodlePage[]> {
    try {
      const pages = await this.moodle.callMoodleApi<{ pages: MoodlePage[] }>(
        'mod_page_get_pages_by_courses',
        { courseids: [courseId] },
      );
      return pages.pages ?? [];
    } catch (err) {
      this.logger.warn(`Failed to fetch pages: ${(err as Error).message}`);
      return [];
    }
  }

  private async fetchAssignments(
    courseId: number,
  ): Promise<MoodleAssignment[]> {
    try {
      const response =
        await this.moodle.callMoodleApi<MoodleAssignmentsResponse>(
          'mod_assign_get_assignments',
          { courseids: [courseId], includenotenrolledcourses: 1 },
        );
      return response.courses.flatMap((course) => course.assignments ?? []);
    } catch (err) {
      this.logger.warn(
        `Failed to fetch assignments: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async fetchForums(courseId: number): Promise<MoodleForum[]> {
    try {
      return await this.moodle.callMoodleApi<MoodleForum[]>(
        'mod_forum_get_forums_by_courses',
        { courseids: [courseId] },
      );
    } catch (err) {
      this.logger.warn(`Failed to fetch forums: ${(err as Error).message}`);
      return [];
    }
  }

  private async fetchForumPosts(
    forum: MoodleForum,
  ): Promise<MoodleForumPost[]> {
    if (!forum.id) {
      return [];
    }

    try {
      const response =
        await this.moodle.callMoodleApi<MoodleForumDiscussionsResponse>(
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
          const postResponse =
            await this.moodle.callMoodleApi<MoodleForumPostsResponse>(
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

    const isPdf =
      mimeType === 'application/pdf' ||
      fileName?.toLowerCase().endsWith('.pdf');

    try {
      if (isPdf) {
        const buffer = await this.moodle.downloadMoodleFile(content.fileurl!);
        if (!looksLikePdf(buffer)) {
          throw new Error(
            'Moodle returned a non-PDF response for this PDF file',
          );
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
        const buffer = await this.moodle.downloadMoodleFile(content.fileurl!);
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

interface MoodleForumPostsResponse {
  posts?: Omit<MoodleForumPost, 'discussionId'>[];
}

interface MoodleCourseSummary {
  id: number;
  fullname: string;
  summary?: string;
  timemodified?: number;
}
