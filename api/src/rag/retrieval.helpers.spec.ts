import {
  chunkDocuments,
  cosineSimilarity,
  queryTerms,
  rankHybrid,
  selectWithinBudget,
} from './retrieval.helpers';

describe('RAG retrieval helpers', () => {
  it('chunks long documents with stable overlap and metadata', () => {
    const text = Array.from(
      { length: 80 },
      (_, index) => `Sentence ${index} explains operating system memory.`,
    ).join(' ');
    const chunks = chunkDocuments(
      [{ text, metadata: { source: 'lecture.pdf' } }],
      300,
      40,
    );

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].metadata).toEqual({
      source: 'lecture.pdf',
      chunkIndex: 0,
    });
    expect(new Set(chunks.map((chunk) => chunk.fingerprint)).size).toBe(
      chunks.length,
    );
  });

  it('ranks semantic matches ahead of keyword-only noise', () => {
    const items = [
      { text: 'Memory paging and virtual address translation', vector: [1, 0] },
      { text: 'Memory memory unrelated repetition', vector: [0, 1] },
    ];
    const ranked = rankHybrid(
      items,
      'How does virtual memory work?',
      [1, 0],
      (item) => item.text,
      (item) => item.vector,
    );

    expect(ranked[0].item).toBe(items[0]);
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  });

  it('keeps retrieved context inside item and character budgets', () => {
    const ranked = [
      { item: 'first', score: 1 },
      { item: 'second item', score: 0.8 },
      { item: 'third', score: 0.6 },
    ];

    expect(selectWithinBudget(ranked, 2, 20, (item) => item)).toEqual(
      ranked.slice(0, 2),
    );
  });

  it('keeps short numeric tokens needed for week-specific announcement queries', () => {
    expect(queryTerms('Week 3 announcement')).toEqual(
      expect.arrayContaining(['week', '3', 'announcement']),
    );
  });
});
