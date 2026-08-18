import {
  chunkExtractedText,
  formatChunksForPrompt,
  isSafeZipEntryName,
  selectRelevantChunks,
} from '../../../../src/chat/attachments/attachment.chunking';

describe('attachment chunking and zip safety', () => {
  it('chunks long text with overlap', () => {
    const text = 'a'.repeat(3500);
    const chunks = chunkExtractedText(text, 1500, 100);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].length).toBe(1500);
  });

  it('selects relevant chunks for a query and formats a prompt', () => {
    const chunks = [
      {
        attachmentId: '1',
        filename: 'a.txt',
        chunkIndex: 0,
        content: 'Virtual memory maps pages to frames.',
      },
      {
        attachmentId: '1',
        filename: 'a.txt',
        chunkIndex: 1,
        content: 'Cooking recipes are unrelated.',
      },
      {
        attachmentId: '2',
        filename: 'b.txt',
        chunkIndex: 0,
        content: 'Paging uses page tables.',
      },
    ];
    const selected = selectRelevantChunks(chunks, 'How does paging work?', 2);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.some((c) => /paging|page/i.test(c.content))).toBe(true);
    const prompt = formatChunksForPrompt(selected);
    expect(prompt).toContain('Attached file:');
  });

  it('rejects zip-slip style entry names', () => {
    expect(isSafeZipEntryName('notes.txt')).toBe(true);
    expect(isSafeZipEntryName('folder/notes.txt')).toBe(true);
    expect(isSafeZipEntryName('../evil.txt')).toBe(false);
    expect(isSafeZipEntryName('foo/../../etc/passwd')).toBe(false);
    expect(isSafeZipEntryName('/abs/path.txt')).toBe(false);
    expect(isSafeZipEntryName('C:\\windows\\system32')).toBe(false);
    expect(isSafeZipEntryName('ok\0bad.txt')).toBe(false);
  });
});
