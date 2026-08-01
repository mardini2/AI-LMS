import {
  CHAT_ATTACHMENT_ALLOWED_EXTENSIONS,
  CHAT_ATTACHMENT_MAX_FILES,
} from './attachment.constants';
import {
  buildAttachmentPromptBlock,
  buildAttachmentStoragePrefix,
  composeUserMessageForLlm,
  composeUserMessageForStorage,
  decodeBase64Payload,
  extensionOf,
  isAllowedAttachmentExtension,
  parseStoredAttachmentNames,
  processChatAttachments,
} from './attachment.extractor';

describe('chat attachment helpers', () => {
  it('accepts all rolled-out extensions and rejects unknown ones', () => {
    for (const ext of CHAT_ATTACHMENT_ALLOWED_EXTENSIONS) {
      expect(isAllowedAttachmentExtension(ext)).toBe(true);
      expect(extensionOf(`notes.${ext}`)).toBe(ext);
    }
    expect(isAllowedAttachmentExtension('exe')).toBe(false);
    expect(extensionOf('noext')).toBe('');
  });

  it('decodes base64 payloads and strips data-URL prefixes', () => {
    const raw = Buffer.from('hello syllabus', 'utf8');
    const encoded = raw.toString('base64');
    expect(decodeBase64Payload(encoded).toString('utf8')).toBe('hello syllabus');
    expect(
      decodeBase64Payload(`data:text/plain;base64,${encoded}`).toString('utf8'),
    ).toBe('hello syllabus');
  });

  it('rejects more than 10 attachments at the request level', async () => {
    const inputs = Array.from({ length: CHAT_ATTACHMENT_MAX_FILES + 1 }, (_, i) => ({
      filename: `file${i}.txt`,
      dataBase64: Buffer.from(`content ${i}`, 'utf8').toString('base64'),
    }));
    await expect(processChatAttachments(inputs)).rejects.toThrow(/up to 10/i);
  });

  it('extracts plain-text and code files and builds prompt/storage markers', async () => {
    const processed = await processChatAttachments([
      {
        filename: 'notes.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('Week 3 covers paging.', 'utf8').toString('base64'),
      },
      {
        filename: 'demo.py',
        dataBase64: Buffer.from('print("hi")\n', 'utf8').toString('base64'),
      },
    ]);

    expect(processed.errors).toEqual([]);
    expect(processed.usableFilenames).toEqual(['notes.txt', 'demo.py']);
    expect(processed.promptBlock).toContain('Attached file: notes.txt');
    expect(processed.promptBlock).toContain('Week 3 covers paging.');
    expect(processed.promptBlock).toContain('print("hi")');
    expect(processed.storagePrefix).toBe(
      '[syllentras-files: notes.txt, demo.py]',
    );

    const llmMessage = composeUserMessageForLlm(
      'Summarize these',
      processed.promptBlock,
    );
    expect(llmMessage.startsWith('Summarize these')).toBe(true);
    expect(llmMessage).toContain('Week 3 covers paging.');

    const stored = composeUserMessageForStorage(
      'Summarize these',
      processed.storagePrefix,
    );
    expect(stored).toBe(
      '[syllentras-files: notes.txt, demo.py]\n\nSummarize these',
    );

    const parsed = parseStoredAttachmentNames(stored);
    expect(parsed.filenames).toEqual(['notes.txt', 'demo.py']);
    expect(parsed.displayText).toBe('Summarize these');
  });

  it('reports unsupported and empty files without failing the whole batch', async () => {
    const processed = await processChatAttachments([
      {
        filename: 'malware.exe',
        dataBase64: Buffer.from('MZ', 'utf8').toString('base64'),
      },
      {
        filename: 'empty.txt',
        dataBase64: Buffer.from('   ', 'utf8').toString('base64'),
      },
      {
        filename: 'ok.md',
        dataBase64: Buffer.from('# Hello', 'utf8').toString('base64'),
      },
    ]);

    expect(processed.results.map((r) => r.status)).toEqual([
      'unsupported',
      'empty',
      'ok',
    ]);
    expect(processed.errors.length).toBe(2);
    expect(processed.usableFilenames).toEqual(['ok.md']);
    expect(buildAttachmentPromptBlock(processed.results)).toContain('# Hello');
    expect(buildAttachmentStoragePrefix(processed.results)).toContain(
      'malware.exe',
    );
  });

  it('rejects images and media until OCR is available', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    const processed = await processChatAttachments([
      {
        filename: 'diagram.png',
        mimeType: 'image/png',
        dataBase64: png.toString('base64'),
      },
    ]);
    expect(processed.results[0].status).toBe('unsupported');
    expect(processed.errors[0]).toMatch(/OCR not available/i);
  });

  it('extracts CSV content', async () => {
    const csv = 'name,score\nAli,95\nSam,88\n';
    const processed = await processChatAttachments([
      {
        filename: 'grades.csv',
        dataBase64: Buffer.from(csv, 'utf8').toString('base64'),
      },
    ]);
    expect(processed.results[0].status).toBe('ok');
    expect(processed.promptBlock).toContain('Ali,95');
  });

  it('defaults attachment-only messages for LLM and storage', () => {
    expect(composeUserMessageForLlm('', '### Attached file: a.txt\nhi')).toContain(
      'Please review the attached file(s).',
    );
    expect(composeUserMessageForStorage('', '[syllentras-files: a.txt]')).toBe(
      '[syllentras-files: a.txt]\n\nPlease review the attached file(s).',
    );
  });
});
