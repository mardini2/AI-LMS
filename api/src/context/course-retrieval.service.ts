import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EmbeddingService } from '../rag/embedding.service';
import { chunkDocuments, rankHybrid } from '../rag/retrieval.helpers';
import type {
  CourseContextDocument,
  CourseContextFilter,
} from './context.types';
import {
  CourseChunk,
  type CourseChunkMetadata,
} from './entities/course-chunk.entity';
import {
  announcementRetrievalBoost,
  buildCourseRetrievalText,
  formatCourseChunkForPrompt,
  newestAnnouncementTimestamp,
  prioritizeChunksForEmbedding,
  selectCourseChunksForPrompt,
} from './course-retrieval.helpers';

const COURSE_INDEX_VERSION = 4;
const EMBEDDING_BACKFILL_BATCH_SIZE = 80;

@Injectable()
export class CourseRetrievalService {
  private readonly logger = new Logger(CourseRetrievalService.name);
  private readonly indexing = new Map<number, Promise<CourseChunk[]>>();

  constructor(
    @InjectRepository(CourseChunk)
    private readonly chunks: Repository<CourseChunk>,
    private readonly embeddings: EmbeddingService,
  ) {}

  async retrieve(
    courseId: number,
    documents: CourseContextDocument[],
    question: string,
    filter: CourseContextFilter,
    queryEmbedding?: number[] | null,
  ): Promise<CourseChunk[]> {
    const indexed = await this.syncCourse(courseId, documents);
    const scoped = indexed.filter(
      (chunk) =>
        !filter.hardSectionScope ||
        !hasSectionConstraint(filter) ||
        matchesSection(chunk.metadata, filter),
    );
    const vector =
      queryEmbedding === undefined
        ? await this.embeddings.embedQuery(question)
        : queryEmbedding;
    const newestAnnouncement = newestAnnouncementTimestamp(
      scoped.map((chunk) => chunk.metadata),
    );
    const ranked = rankHybrid(
      scoped,
      question,
      vector,
      (chunk) => buildCourseRetrievalText(chunk.text, chunk.metadata),
      (chunk) => chunk.embedding,
      (chunk) =>
        (matchesSection(chunk.metadata, filter) ? 0.12 : 0) +
        announcementRetrievalBoost(
          chunk.metadata,
          question,
          newestAnnouncement,
          chunk.text,
        ),
    );

    return selectCourseChunksForPrompt(
      ranked,
      question,
      (chunk) => chunk.metadata,
      (chunk) => chunk.text,
      10,
      12_000,
    ).map(({ item }) => item);
  }

  formatForPrompt(chunks: CourseChunk[]): string {
    return chunks
      .map((chunk, index) =>
        formatCourseChunkForPrompt(chunk.text, chunk.metadata, index + 1),
      )
      .join('\n\n');
  }

  private async syncCourse(
    courseId: number,
    documents: CourseContextDocument[],
  ): Promise<CourseChunk[]> {
    const inFlight = this.indexing.get(courseId);
    if (inFlight) {
      return inFlight;
    }

    const work = this.doSyncCourse(courseId, documents).finally(() => {
      this.indexing.delete(courseId);
    });
    this.indexing.set(courseId, work);
    return work;
  }

  private async doSyncCourse(
    courseId: number,
    documents: CourseContextDocument[],
  ): Promise<CourseChunk[]> {
    const desired = chunkDocuments(
      documents.map((document) => ({
        text: document.text,
        metadata: toMetadata(document),
      })),
    );
    const existing = await this.chunks.find({ where: { courseId } });
    const byFingerprint = new Map(
      existing.map((chunk) => [chunk.fingerprint, chunk]),
    );
    // Announcements are ingested after PDFs, so prioritize them or they stay
    // unembedded while lecture chunks consume the whole backfill batch.
    const needingEmbeddings = prioritizeChunksForEmbedding(
      desired.filter(
        (chunk) => !byFingerprint.get(chunk.fingerprint)?.embedding?.length,
      ),
      (chunk) => chunk.metadata as unknown as CourseChunkMetadata,
    ).slice(0, EMBEDDING_BACKFILL_BATCH_SIZE);
    const vectors = await this.embeddings.embedDocuments(
      needingEmbeddings.map((chunk) =>
        buildCourseRetrievalText(
          chunk.text,
          chunk.metadata as unknown as CourseChunkMetadata,
        ),
      ),
    );
    const vectorsByFingerprint = new Map(
      needingEmbeddings
        .map((chunk, index) => [chunk.fingerprint, vectors[index]] as const)
        .filter((entry): entry is readonly [string, number[]] =>
          Boolean(entry[1]?.length),
        ),
    );

    const changed: CourseChunk[] = [];
    for (const chunk of desired) {
      const current = byFingerprint.get(chunk.fingerprint);
      const embedding = vectorsByFingerprint.get(chunk.fingerprint);
      if (!current) {
        changed.push(
          this.chunks.create({
            courseId,
            fingerprint: chunk.fingerprint,
            text: chunk.text,
            metadata: chunk.metadata as unknown as CourseChunkMetadata,
            embedding: embedding ?? null,
          }),
        );
      } else if (embedding) {
        current.embedding = embedding;
        changed.push(current);
      }
    }

    if (changed.length > 0) {
      const saved = await this.chunks.save(changed, { chunk: 50 });
      saved.forEach((row) => byFingerprint.set(row.fingerprint, row));
      const embedded = saved.filter((row) => row.embedding?.length).length;
      this.logger.log(
        `Updated ${saved.length} course chunks for course ${courseId} (${embedded} embedded)`,
      );
    }

    const desiredFingerprints = new Set(
      desired.map((chunk) => chunk.fingerprint),
    );
    const staleIds = existing
      .filter((chunk) => !desiredFingerprints.has(chunk.fingerprint))
      .map((chunk) => chunk.id);
    if (staleIds.length > 0) {
      await this.chunks.delete({ id: In(staleIds) });
    }

    return desired
      .map((chunk) => byFingerprint.get(chunk.fingerprint))
      .filter((chunk): chunk is CourseChunk => Boolean(chunk));
  }
}

function toMetadata(
  document: CourseContextDocument,
): Omit<CourseChunkMetadata, 'chunkIndex'> {
  return {
    indexVersion: COURSE_INDEX_VERSION,
    courseName: document.courseName,
    sectionId: document.sectionId,
    sectionNumber: document.sectionNumber,
    sectionName: document.sectionName,
    moduleId: document.moduleId,
    moduleName: document.moduleName,
    contentType: document.contentType,
    fileName: document.fileName,
    source: document.source,
    lastUpdated: document.lastUpdated,
  };
}

function hasSectionConstraint(filter: CourseContextFilter): boolean {
  return Boolean(
    filter.sectionId ||
    filter.sectionNumber !== undefined ||
    filter.sectionName ||
    filter.sectionIds?.length ||
    filter.sectionNumbers?.length,
  );
}

function matchesSection(
  metadata: CourseChunkMetadata,
  filter: CourseContextFilter,
): boolean {
  if (!hasSectionConstraint(filter)) {
    return false;
  }
  if (filter.sectionId && metadata.sectionId === filter.sectionId) {
    return true;
  }
  if (
    filter.sectionNumber !== undefined &&
    metadata.sectionNumber === filter.sectionNumber
  ) {
    return true;
  }
  if (
    filter.sectionName &&
    metadata.sectionName?.toLowerCase() === filter.sectionName.toLowerCase()
  ) {
    return true;
  }
  if (filter.sectionIds?.includes(metadata.sectionId ?? -1)) {
    return true;
  }
  return Boolean(filter.sectionNumbers?.includes(metadata.sectionNumber ?? -1));
}
