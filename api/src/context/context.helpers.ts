import type {
  CourseContextDocument,
  CourseContextFilter,
  CourseSectionMeta,
} from './context.types';

const { PDFParse }: {
  PDFParse: new (options: { data: Buffer }) => {
    getText: () => Promise<{ text?: string }>;
    destroy?: () => Promise<void> | void;
  };
} = require('pdf-parse');

export async function parsePdfText(
  buffer: Buffer,
): Promise<{ text?: string }> {
  const parser = new PDFParse({ data: buffer });
  try {
    return await parser.getText();
  } finally {
    await parser.destroy?.();
  }
}

export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('utf8') === '%PDF-';
}

export function parseMoodleJsonError(buffer: Buffer): string | null {
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

export interface MoodleCourseSection {
  id?: number;
  section?: number;
  name?: string;
  summary?: string;
  timemodified?: number;
  modules?: MoodleModule[];
}

export interface MoodleModule {
  id: number;
  name: string;
  modname: string;
  url?: string;
  description?: string;
  contents?: MoodleContent[];
  dates?: Array<{ timestamp?: number }>;
}

export interface MoodleContent {
  type: string;
  content?: string;
  filename?: string;
  filepath?: string;
  fileurl?: string;
  mimetype?: string;
  timemodified?: number;
}

export interface MoodleForumPost {
  id: number;
  discussionId: number;
  subject?: string;
  message: string;
  created?: number;
  modified?: number;
  userfullname?: string;
}

export function normalizeSection(section: MoodleCourseSection): {
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

export function formatDocumentsForPrompt(
  documents: CourseContextDocument[],
  filter: CourseContextFilter,
  question: string,
): string {
  return orderDocuments(documents, filter, question)
    .slice(0, 80)
    .map(formatDocument)
    .join('\n\n')
    .trim();
}

export function pickBestDocument(
  documents: CourseContextDocument[],
  filter: CourseContextFilter,
  question: string,
): CourseContextDocument | null {
  const ordered = orderDocuments(documents, filter, question);
  return ordered[0] ?? null;
}

function orderDocuments(
  documents: CourseContextDocument[],
  filter: CourseContextFilter,
  question: string,
): CourseContextDocument[] {
  const matching = documents.filter((doc) => matchesSection(doc, filter));
  const other = documents.filter((doc) => !matchesSection(doc, filter));
  const questionTerms = question
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 3);
  const byRelevance = (a: CourseContextDocument, b: CourseContextDocument) =>
    relevanceScore(b, questionTerms) - relevanceScore(a, questionTerms);

  if (filter.hardSectionScope && hasSectionConstraint(filter)) {
    return matching.sort(byRelevance);
  }

  if (matching.length > 0) {
    return [...matching.sort(byRelevance), ...other.sort(byRelevance)];
  }

  return documents.sort(byRelevance);
}

function hasSectionConstraint(filter: CourseContextFilter): boolean {
  return !!(
    filter.sectionId ||
    filter.sectionNumber !== undefined ||
    filter.sectionName ||
    (filter.sectionIds && filter.sectionIds.length > 0) ||
    (filter.sectionNumbers && filter.sectionNumbers.length > 0)
  );
}

export function matchesSection(
  doc: CourseContextDocument,
  filter: CourseContextFilter,
): boolean {
  if (
    filter.sectionIds?.length &&
    doc.sectionId !== undefined &&
    filter.sectionIds.includes(doc.sectionId)
  ) {
    return true;
  }

  if (
    filter.sectionNumbers?.length &&
    doc.sectionNumber !== undefined &&
    filter.sectionNumbers.includes(doc.sectionNumber)
  ) {
    return true;
  }

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

export function uniqueCourseSections(
  documents: CourseContextDocument[],
): CourseSectionMeta[] {
  const byId = new Map<number, CourseSectionMeta>();
  for (const doc of documents) {
    if (doc.sectionId === undefined || doc.sectionNumber === undefined) {
      continue;
    }
    if (!byId.has(doc.sectionId)) {
      byId.set(doc.sectionId, {
        sectionId: doc.sectionId,
        sectionNumber: doc.sectionNumber,
        sectionName: doc.sectionName,
      });
    }
  }
  return [...byId.values()];
}

function extractNumbersFromPatterns(
  scope: string,
  rangePatterns: RegExp[],
  singlePatterns: RegExp[],
): Set<number> {
  const numbers = new Set<number>();
  if (!scope) {
    return numbers;
  }

  for (const pattern of rangePatterns) {
    for (const match of scope.matchAll(pattern)) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        continue;
      }
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      for (let n = lo; n <= hi; n++) {
        numbers.add(n);
      }
    }
  }

  for (const pattern of singlePatterns) {
    for (const match of scope.matchAll(pattern)) {
      const n = Number(match[1]);
      if (Number.isFinite(n)) {
        numbers.add(n);
      }
    }
  }

  return numbers;
}

/** Numbers from "week(s) N" / "weeks N-M" — match section names, not Moodle index. */
export function extractWeekNumbers(scope: string): Set<number> {
  return extractNumbersFromPatterns(
    scope,
    [
      /\bweeks?\s+(\d+)\s*[-–—]\s*(\d+)\b/gi,
      /\bweeks?\s+(\d+)\s+to\s+(\d+)\b/gi,
    ],
    [/\bweeks?\s+(\d+)\b/gi],
  );
}

/** Numbers from "section(s) N" — match Moodle topic index. */
export function extractSectionIndexNumbers(scope: string): Set<number> {
  return extractNumbersFromPatterns(
    scope,
    [
      /\bsections?\s+(\d+)\s*[-–—]\s*(\d+)\b/gi,
      /\bsections?\s+(\d+)\s+to\s+(\d+)\b/gi,
    ],
    [/\bsections?\s+(\d+)\b/gi],
  );
}

export function sectionNameMatchesWeekNumbers(
  sectionName: string | undefined,
  numbers: Set<number>,
): boolean {
  if (!sectionName || numbers.size === 0) {
    return false;
  }
  for (const n of numbers) {
    const weekRe = new RegExp(`\\bweek\\s*0*${n}\\b`, 'i');
    const shortRe = new RegExp(`\\bw\\s*0*${n}\\b`, 'i');
    if (weekRe.test(sectionName) || shortRe.test(sectionName)) {
      return true;
    }
  }
  return false;
}

export function scopeIncludesSectionName(
  scope: string,
  sectionName: string,
): boolean {
  const name = sectionName.trim();
  if (name.length < 4) {
    return false;
  }
  return scope.toLowerCase().includes(name.toLowerCase());
}

export function relevanceScore(
  doc: CourseContextDocument,
  questionTerms: string[],
): number {
  const haystack =
    `${doc.sectionName ?? ''} ${doc.moduleName ?? ''} ${doc.fileName ?? ''} ${doc.text}`.toLowerCase();
  return questionTerms.reduce(
    (score, term) => score + (haystack.includes(term) ? 1 : 0),
    0,
  );
}

export function formatCitationTitle(doc: CourseContextDocument): string {
  const section = doc.sectionName?.trim();
  const resource = doc.moduleName?.trim() || doc.fileName?.trim() || undefined;

  if (section && resource && section.toLowerCase() !== resource.toLowerCase()) {
    return `${section} — ${resource}`;
  }
  return section || resource || 'Course material';
}

export function formatDocument(doc: CourseContextDocument): string {
  const sectionLabel = doc.sectionName?.trim() || 'Course';
  const resourceLabel = doc.moduleName?.trim() || doc.fileName?.trim();
  const heading = resourceLabel
    ? `### Course section: ${sectionLabel} / ${resourceLabel}`
    : `### Course section: ${sectionLabel}`;

  const meta = [
    `type=${doc.contentType}`,
    doc.courseName ? `course=${doc.courseName}` : undefined,
    `course_section=${sectionLabel}`,
    doc.moduleName ? `module=${doc.moduleName}` : undefined,
    doc.fileName ? `file=${doc.fileName}` : undefined,
    doc.source ? `source=${doc.source}` : undefined,
    doc.lastUpdated
      ? `updated=${new Date(doc.lastUpdated * 1000).toISOString()}`
      : undefined,
  ].filter(Boolean);

  return [
    heading,
    'Note: resource/topic numbers in titles are not course week numbers; use course_section above.',
    `Metadata: ${meta.join('; ')}`,
    doc.text,
  ].join('\n');
}

export function formatForumPostText(post: MoodleForumPost): string {
  return [
    post.subject ? `Subject: ${stripHtml(post.subject)}` : undefined,
    post.userfullname ? `Author: ${stripHtml(post.userfullname)}` : undefined,
    stripHtml(post.message),
  ]
    .filter(Boolean)
    .join('\n');
}

export function stripHtml(html: string): string {
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
