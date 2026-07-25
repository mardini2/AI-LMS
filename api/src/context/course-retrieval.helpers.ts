import { extractWeekNumbers } from './context.helpers';
import type { RankedRagItem } from '../rag/retrieval.helpers';
import { selectWithinBudget } from '../rag/retrieval.helpers';
import type { CourseChunkMetadata } from './entities/course-chunk.entity';

// Include common misspellings ("announcment") so typos still retrieve posts,
// not just the Announcements activity shell intro.
const ANNOUNCEMENT_QUERY =
  /\b(an+nou?nc(?:e)?ments?|notices?|course news|class news|posted update|latest update|what's new|whats new)\b/i;
const LOGISTICS_QUERY =
  /\b(deadline|due date|due dates|exam date|midterm|final exam|schedule|cancelled|canceled|extension|office hours|posted|instructor (?:said|posted|announced))\b/i;
const LATEST_QUERY = /\b(latest|newest|most recent|current)\b/i;

export function isAnnouncementMetadata(metadata: CourseChunkMetadata): boolean {
  if (metadata.contentType.startsWith('announcement_')) {
    return true;
  }
  // Some courses use a normal forum named Announcements instead of Moodle's news type.
  return /\bannouncements?\b/i.test(metadata.moduleName ?? '');
}

export function isAnnouncementPost(metadata: CourseChunkMetadata): boolean {
  return (
    metadata.contentType === 'announcement_post' ||
    (isAnnouncementMetadata(metadata) &&
      (metadata.contentType === 'forum_post' ||
        metadata.contentType.endsWith('_post')))
  );
}

export function isAnnouncementQuery(question: string): boolean {
  return ANNOUNCEMENT_QUERY.test(question);
}

export function isLogisticsQuery(question: string): boolean {
  return LOGISTICS_QUERY.test(question) || isAnnouncementQuery(question);
}

export function announcementMatchesWeekNumbers(
  text: string,
  metadata: CourseChunkMetadata,
  weekNumbers: Set<number>,
): boolean {
  if (!weekNumbers.size) {
    return false;
  }
  const haystack = [metadata.sectionName, metadata.moduleName, text]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  for (const week of weekNumbers) {
    const patterns = [
      new RegExp(`\\bweek\\s*0*${week}\\b`, 'i'),
      new RegExp(`\\bw\\s*0*${week}\\b`, 'i'),
      new RegExp(`\\bwk\\s*0*${week}\\b`, 'i'),
    ];
    if (patterns.some((pattern) => pattern.test(haystack))) {
      return true;
    }
  }
  return false;
}

export function buildCourseRetrievalText(
  text: string,
  metadata: CourseChunkMetadata,
): string {
  const labels = [
    metadata.courseName ? `Course: ${metadata.courseName}` : undefined,
    metadata.sectionName ? `Section: ${metadata.sectionName}` : undefined,
    metadata.moduleName ? `Resource: ${metadata.moduleName}` : undefined,
    `Content type: ${metadata.contentType.replace(/_/g, ' ')}`,
    isAnnouncementMetadata(metadata) ? 'Course announcements' : undefined,
    metadata.fileName ? `File: ${metadata.fileName}` : undefined,
  ].filter(Boolean);

  return [...labels, text].join('\n');
}

export function announcementRetrievalBoost(
  metadata: CourseChunkMetadata,
  question: string,
  newestAnnouncementTimestamp?: number,
  announcementText = '',
): number {
  if (!isAnnouncementMetadata(metadata)) {
    return 0;
  }

  // The Moodle news-forum intro ("General news and announcements") is an activity
  // shell, not a posted discussion. Prefer real discussion posts heavily.
  if (metadata.contentType === 'announcement_forum') {
    return isAnnouncementQuery(question) ? -0.35 : 0;
  }

  if (!isLogisticsQuery(question)) {
    // Keep a tiny floor so announcement posts can still surface for topical matches.
    return isAnnouncementPost(metadata) ? 0.04 : 0.01;
  }

  const weekNumbers = extractWeekNumbers(question);
  const isPost = isAnnouncementPost(metadata);
  let boost = isPost ? 0.34 : 0.12;

  if (weekNumbers.size > 0) {
    // Specific week requests must beat newer unrelated announcements.
    if (
      announcementMatchesWeekNumbers(announcementText, metadata, weekNumbers)
    ) {
      return boost + 0.85;
    }
    // Penalize non-matching weeks so "Week 3" doesn't pull Weeks 11/13 via recency.
    return isPost ? 0.05 : 0.02;
  }

  if (
    isPost &&
    (isAnnouncementQuery(question) || LATEST_QUERY.test(question)) &&
    metadata.lastUpdated === newestAnnouncementTimestamp
  ) {
    return boost + 0.55;
  }
  if (metadata.lastUpdated && newestAnnouncementTimestamp) {
    const ageSeconds = Math.max(
      0,
      newestAnnouncementTimestamp - metadata.lastUpdated,
    );
    const recency = Math.max(0, 1 - ageSeconds / (180 * 24 * 60 * 60));
    boost += recency * 0.1;
  }
  return boost;
}

export function newestAnnouncementTimestamp(
  metadata: CourseChunkMetadata[],
): number | undefined {
  const timestamps = metadata
    .filter(isAnnouncementMetadata)
    .map((item) => item.lastUpdated)
    .filter((timestamp): timestamp is number => typeof timestamp === 'number');
  return timestamps.length ? Math.max(...timestamps) : undefined;
}

export function formatCourseChunkForPrompt(
  text: string,
  metadata: CourseChunkMetadata,
  sourceNumber: number,
): string {
  const location = [
    metadata.sectionName,
    metadata.moduleName,
    metadata.fileName,
  ].filter(Boolean);
  const source = location.length
    ? location.join(' / ')
    : metadata.contentType.replace(/_/g, ' ');
  const details = [
    `type=${metadata.contentType}`,
    isAnnouncementMetadata(metadata) ? 'kind=announcement' : undefined,
    metadata.lastUpdated
      ? `updated=${new Date(metadata.lastUpdated * 1000).toISOString()}`
      : undefined,
    metadata.source ? `source=${metadata.source}` : undefined,
  ].filter(Boolean);

  return [
    `[Course source ${sourceNumber}: ${source}]`,
    `Metadata: ${details.join('; ')}`,
    text,
  ].join('\n');
}

/**
 * Announcements are ingested after PDFs/pages, so without priority they sit at the
 * end of the embedding backlog and stay unembedded while lecture chunks fill the quota.
 */
export function prioritizeChunksForEmbedding<T>(
  chunks: T[],
  getMetadata: (chunk: T) => CourseChunkMetadata,
): T[] {
  return [...chunks].sort((a, b) => {
    const aMeta = getMetadata(a);
    const bMeta = getMetadata(b);
    const aScore = isAnnouncementPost(aMeta)
      ? 2
      : isAnnouncementMetadata(aMeta)
        ? 1
        : 0;
    const bScore = isAnnouncementPost(bMeta)
      ? 2
      : isAnnouncementMetadata(bMeta)
        ? 1
        : 0;
    return bScore - aScore;
  });
}

/**
 * Keep announcement posts in the prompt for announcement/logistics questions
 * instead of letting the top-K lecture chunks crowd them out.
 */
export function selectCourseChunksForPrompt<T>(
  ranked: RankedRagItem<T>[],
  question: string,
  getMetadata: (item: T) => CourseChunkMetadata,
  getText: (item: T) => string,
  maxItems = 10,
  maxCharacters = 12_000,
): RankedRagItem<T>[] {
  // Drop the activity-shell intro when real discussion posts are available so
  // the model does not treat "General news and announcements" as an empty forum.
  const hasAnnouncementPosts = ranked.some((entry) =>
    isAnnouncementPost(getMetadata(entry.item)),
  );
  const candidates =
    hasAnnouncementPosts && isAnnouncementQuery(question)
      ? ranked.filter(
          (entry) =>
            getMetadata(entry.item).contentType !== 'announcement_forum',
        )
      : ranked;

  if (!isLogisticsQuery(question)) {
    return selectWithinBudget(candidates, maxItems, maxCharacters, getText);
  }

  const weekNumbers = extractWeekNumbers(question);
  const announcementPosts = candidates.filter((entry) =>
    isAnnouncementPost(getMetadata(entry.item)),
  );
  const weekMatches = weekNumbers.size
    ? announcementPosts.filter((entry) =>
        announcementMatchesWeekNumbers(
          getText(entry.item),
          getMetadata(entry.item),
          weekNumbers,
        ),
      )
    : [];
  const reservedCount = isAnnouncementQuery(question) ? 6 : 2;
  // When the student names a week, only reserve that week's posts — padding
  // with newer weeks previously crowded out the matching announcement.
  const reserved = (
    weekMatches.length > 0 ? weekMatches : announcementPosts
  ).slice(0, reservedCount);
  const reservedIds = new Set(reserved.map((entry) => entry.item));
  const remainder = candidates.filter((entry) => !reservedIds.has(entry.item));

  return selectWithinBudget(
    [...reserved, ...remainder],
    maxItems,
    maxCharacters,
    getText,
  );
}
