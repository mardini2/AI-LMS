import {
  announcementRetrievalBoost,
  buildCourseRetrievalText,
  isAnnouncementQuery,
  newestAnnouncementTimestamp,
  selectCourseChunksForPrompt,
} from './course-retrieval.helpers';
import { queryTerms, rankHybrid } from '../rag/retrieval.helpers';
import type { CourseChunkMetadata } from './entities/course-chunk.entity';

describe('Week 3 Basic Malware Analysis announcement retrieval', () => {
  const week3Text =
    'Subject: Week 3 - Basic Malware Analysis\nWelcome to Week 3. This week introduces the fundamentals of malware analysis. We will examine both static and dynamic analysis techniques.';
  const week3: { text: string; metadata: CourseChunkMetadata } = {
    text: week3Text,
    metadata: {
      indexVersion: 4,
      contentType: 'announcement_post',
      moduleName: 'Announcements',
      sectionName: 'General',
      source: 'forum:1:discussion:3:post:3',
      lastUpdated: 1_000,
      chunkIndex: 0,
    },
  };
  const forumShell: { text: string; metadata: CourseChunkMetadata } = {
    text: 'General news and announcements',
    metadata: {
      indexVersion: 4,
      contentType: 'announcement_forum',
      moduleName: 'Announcements',
      sectionName: 'General',
      source: 'forum:1',
      lastUpdated: 500,
      chunkIndex: 0,
    },
  };
  const newerWeeks = [11, 13, 14].map((week) => ({
    text: `Subject: Week ${week} - Later topic\nWelcome to Week ${week}.`,
    metadata: {
      ...week3.metadata,
      source: `forum:1:discussion:${week}:post:${week}`,
      lastUpdated: week * 1_000,
    },
  }));
  const lectureNoise = Array.from({ length: 20 }, (_, index) => ({
    text: `Lecture notes about malware analysis tools and static analysis workflow ${index}`,
    metadata: {
      indexVersion: 4,
      contentType: 'resource_pdf',
      moduleName: 'Week 3 notes',
      sectionName: 'Week 3',
      source: `pdf:${index}`,
      lastUpdated: 5_000 + index,
      chunkIndex: 0,
    } satisfies CourseChunkMetadata,
    embedding: [1, 0] as number[] | null,
  }));

  it('keeps week number tokens for the exact Moodle announcement title query', () => {
    expect(
      queryTerms(
        'What does the Week 3 - Basic Malware Analysis announcement say?',
      ),
    ).toEqual(
      expect.arrayContaining([
        'week',
        '3',
        'basic',
        'malware',
        'analysis',
        'announcement',
      ]),
    );
  });

  it('treats common announcement typos as announcement queries', () => {
    expect(
      isAnnouncementQuery('can u see any announcment for this course?'),
    ).toBe(true);
    expect(isAnnouncementQuery('any announcements?')).toBe(true);
  });

  it('retrieves Week 3 - Basic Malware Analysis ahead of newer announcements and lecture PDFs', () => {
    const question =
      'What does the Week 3 - Basic Malware Analysis announcement say?';
    const items = [...lectureNoise, ...newerWeeks, week3, forumShell].map(
      (item) => ({
        ...item,
        embedding: 'embedding' in item ? item.embedding : null,
      }),
    );
    const newest = newestAnnouncementTimestamp(
      items.map((item) => item.metadata),
    );
    const ranked = rankHybrid(
      items,
      question,
      [1, 0],
      (item) => buildCourseRetrievalText(item.text, item.metadata),
      (item) => item.embedding,
      (item) =>
        announcementRetrievalBoost(item.metadata, question, newest, item.text),
    );
    const selected = selectCourseChunksForPrompt(
      ranked,
      question,
      (item) => item.metadata,
      (item) => item.text,
      10,
      12_000,
    );

    expect(ranked[0].item.metadata.source).toBe(week3.metadata.source);
    expect(selected[0].item.text).toContain('Week 3 - Basic Malware Analysis');
    expect(
      selected.some((entry) =>
        entry.item.text.includes('Week 3 - Basic Malware Analysis'),
      ),
    ).toBe(true);
    expect(
      selected.some(
        (entry) => entry.item.metadata.contentType === 'announcement_forum',
      ),
    ).toBe(false);
  });

  it('surfaces discussion posts for typo announcement queries instead of the empty forum shell', () => {
    const question = 'can u see any announcment for this course?';
    const assignmentPdf = {
      text: 'Assignment 1 Part A instructions for the course reverse engineering challenge.',
      metadata: {
        indexVersion: 4,
        contentType: 'assign_pdf',
        moduleName: 'Assignment 1 - Part A',
        sectionName: 'Course Information',
        source: 'assign:1',
        lastUpdated: 9_000,
        chunkIndex: 0,
      } satisfies CourseChunkMetadata,
      embedding: [1, 0] as number[] | null,
    };
    const items = [
      assignmentPdf,
      ...lectureNoise.slice(0, 5),
      forumShell,
      week3,
      newerWeeks[0],
    ].map((item) => ({
      ...item,
      embedding: 'embedding' in item ? item.embedding : null,
    }));
    const newest = newestAnnouncementTimestamp(
      items.map((item) => item.metadata),
    );
    const ranked = rankHybrid(
      items,
      question,
      [1, 0],
      (item) => buildCourseRetrievalText(item.text, item.metadata),
      (item) => item.embedding,
      (item) =>
        announcementRetrievalBoost(item.metadata, question, newest, item.text),
    );
    const selected = selectCourseChunksForPrompt(
      ranked,
      question,
      (item) => item.metadata,
      (item) => item.text,
      6,
      12_000,
    );

    expect(selected[0].item.metadata.contentType).toBe('announcement_post');
    expect(
      selected.some((entry) =>
        entry.item.text.includes('Week 3 - Basic Malware Analysis'),
      ),
    ).toBe(true);
    expect(
      selected.some(
        (entry) => entry.item.metadata.contentType === 'announcement_forum',
      ),
    ).toBe(false);
  });
});
