import { queryTerms, rankHybrid } from '../rag/retrieval.helpers';
import {
  announcementMatchesWeekNumbers,
  announcementRetrievalBoost,
  buildCourseRetrievalText,
  formatCourseChunkForPrompt,
  isAnnouncementQuery,
  newestAnnouncementTimestamp,
  prioritizeChunksForEmbedding,
  selectCourseChunksForPrompt,
} from './course-retrieval.helpers';
import type { CourseChunkMetadata } from './entities/course-chunk.entity';

const announcement: CourseChunkMetadata = {
  indexVersion: 4,
  contentType: 'announcement_post',
  moduleName: 'Announcements',
  sectionName: 'General',
  source: 'forum:1:discussion:14:post:14',
  lastUpdated: 2_000,
  chunkIndex: 0,
};

describe('course retrieval metadata', () => {
  it('includes announcement metadata in lexical and embedding text', () => {
    const text = buildCourseRetrievalText(
      'The final review is available.',
      announcement,
    );

    expect(text).toContain('Resource: Announcements');
    expect(text).toContain('Content type: announcement post');
    expect(text).toContain('Course announcements');
  });

  it('keeps week numbers in query terms so Week 3 can match', () => {
    expect(queryTerms('What does the Week 3 announcement say?')).toEqual(
      expect.arrayContaining(['week', '3', 'announcement']),
    );
  });

  it('detects announcement intent despite common typos', () => {
    expect(isAnnouncementQuery('any announcment for this course?')).toBe(true);
  });

  it('prioritizes the newest announcement for a generic announcement query', () => {
    const older = {
      ...announcement,
      lastUpdated: 1_000,
      source: 'forum:older',
    };
    const items = [
      { text: 'Older class update.', metadata: older },
      { text: 'The final review is available.', metadata: announcement },
      {
        text: 'Lecture notes about operating system updates.',
        metadata: {
          ...announcement,
          contentType: 'page',
          moduleName: 'Lecture notes',
          lastUpdated: 3_000,
        },
      },
    ];
    const newest = newestAnnouncementTimestamp(
      items.map((item) => item.metadata),
    );
    const ranked = rankHybrid(
      items,
      'What is the latest announcement?',
      null,
      (item) => buildCourseRetrievalText(item.text, item.metadata),
      () => null,
      (item) =>
        announcementRetrievalBoost(
          item.metadata,
          'latest announcement',
          newest,
          item.text,
        ),
    );

    expect(ranked[0].item.metadata.source).toBe(announcement.source);
  });

  it('retrieves the Week 3 announcement ahead of newer week announcements', () => {
    const week3 = {
      text: 'Subject: Week 3\nLab 2 is due Friday.',
      metadata: {
        ...announcement,
        source: 'forum:week3',
        lastUpdated: 1_000,
      },
    };
    const week11 = {
      text: 'Subject: Week 11\nMidterm feedback is posted.',
      metadata: {
        ...announcement,
        source: 'forum:week11',
        lastUpdated: 3_000,
      },
    };
    const week13 = {
      text: 'Subject: Week 13\nFinal project checkpoint.',
      metadata: {
        ...announcement,
        source: 'forum:week13',
        lastUpdated: 4_000,
      },
    };
    const question = 'What does the Week 3 announcement say?';
    const newest = newestAnnouncementTimestamp([
      week3.metadata,
      week11.metadata,
      week13.metadata,
    ]);
    const ranked = rankHybrid(
      [week13, week11, week3],
      question,
      null,
      (item) => buildCourseRetrievalText(item.text, item.metadata),
      () => null,
      (item) =>
        announcementRetrievalBoost(item.metadata, question, newest, item.text),
    );
    const selected = selectCourseChunksForPrompt(
      ranked,
      question,
      (item) => item.metadata,
      (item) => item.text,
      2,
      12_000,
    );

    expect(
      announcementMatchesWeekNumbers(week3.text, week3.metadata, new Set([3])),
    ).toBe(true);
    expect(ranked[0].item.metadata.source).toBe('forum:week3');
    expect(selected[0].item.metadata.source).toBe('forum:week3');
  });

  it('keeps announcement timestamps in the prompt', () => {
    expect(
      formatCourseChunkForPrompt('Final review details.', announcement, 1),
    ).toContain('updated=1970-01-01T00:33:20.000Z');
  });

  it('embeds announcement chunks before lecture backlog items', () => {
    const chunks = [
      {
        id: 'lecture',
        metadata: {
          ...announcement,
          contentType: 'resource_pdf',
          moduleName: 'Week 3 notes',
        },
      },
      { id: 'announcement', metadata: announcement },
    ];

    const ordered = prioritizeChunksForEmbedding(
      chunks,
      (chunk) => chunk.metadata,
    );
    expect(ordered[0].id).toBe('announcement');
  });

  it('reserves announcement posts in the prompt for announcement questions', () => {
    const ranked = [
      {
        item: {
          text: 'Long lecture chunk about scheduling algorithms.',
          metadata: {
            ...announcement,
            contentType: 'page',
            moduleName: 'Lecture notes',
            source: 'lecture',
          },
        },
        score: 0.95,
      },
      {
        item: {
          text: 'Final review is this Friday at 2pm.',
          metadata: announcement,
        },
        score: 0.2,
      },
    ];

    const selected = selectCourseChunksForPrompt(
      ranked,
      'What is the latest announcement?',
      (item) => item.metadata,
      (item) => item.text,
      1,
      12_000,
    );

    expect(selected).toHaveLength(1);
    expect(selected[0].item.metadata.source).toBe(announcement.source);
  });

  it('still surfaces announcement content for logistics questions without the word announcement', () => {
    const lecture = {
      text: 'CPU scheduling covers FCFS, SJF, and round robin.',
      metadata: {
        ...announcement,
        contentType: 'page',
        moduleName: 'Week 5 notes',
        source: 'lecture',
      },
      embedding: [1, 0],
    };
    const notice = {
      text: 'The final exam review is Friday at 2pm in the lab.',
      metadata: announcement,
      embedding: null as number[] | null,
    };
    const newest = newestAnnouncementTimestamp([
      lecture.metadata,
      notice.metadata,
    ]);
    const ranked = rankHybrid(
      [lecture, notice],
      'When is the final exam review?',
      [1, 0],
      (item) => buildCourseRetrievalText(item.text, item.metadata),
      (item) => item.embedding,
      (item) =>
        announcementRetrievalBoost(
          item.metadata,
          'When is the final exam review?',
          newest,
          item.text,
        ),
    );
    const selected = selectCourseChunksForPrompt(
      ranked,
      'When is the final exam review?',
      (item) => item.metadata,
      (item) => item.text,
      2,
      12_000,
    );

    expect(
      selected.some(
        (entry) => entry.item.metadata.source === announcement.source,
      ),
    ).toBe(true);
  });
});
