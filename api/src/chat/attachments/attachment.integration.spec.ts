import {
  extractBufferContent,
  processChatAttachments,
} from './attachment.extractor';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip') as typeof import('jszip');

async function makeDocxBuffer(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder('_rels')?.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder('word')?.file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}

async function makePptxBuffer(slideText: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`,
  );
  zip.folder('ppt')?.folder('slides')?.file(
    'slide1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${slideText}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`,
  );
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}

describe('chat attachment extraction integration', () => {
  it('extracts text from a minimal DOCX', async () => {
    const buffer = await makeDocxBuffer('Virtual memory maps pages to frames.');
    const result = await extractBufferContent('lecture.docx', 'docx', buffer);
    expect(result.status).toBe('ok');
    expect(result.text).toContain('Virtual memory maps pages to frames.');
  });

  it('extracts slide text from a minimal PPTX', async () => {
    const buffer = await makePptxBuffer('Deadlocks require four conditions.');
    const result = await extractBufferContent('week4.pptx', 'pptx', buffer);
    expect(result.status).toBe('ok');
    expect(result.text).toContain('Deadlocks require four conditions.');
  });

  it('lists nested text files inside a ZIP', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'Course ZIP readme');
    zip.file('src/main.java', 'class Main {}');
    const buffer = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
    const processed = await processChatAttachments([
      {
        filename: 'handout.zip',
        dataBase64: buffer.toString('base64'),
      },
    ]);
    expect(processed.results[0].status).toBe('ok');
    expect(processed.promptBlock).toMatch(/ZIP archive/i);
    expect(processed.promptBlock).toContain('readme.txt');
    expect(processed.promptBlock).toContain('Course ZIP readme');
  });

  it('extracts JSON and XML as text', async () => {
    const processed = await processChatAttachments([
      {
        filename: 'meta.json',
        dataBase64: Buffer.from('{"week":3,"topic":"paging"}', 'utf8').toString(
          'base64',
        ),
      },
      {
        filename: 'doc.xml',
        dataBase64: Buffer.from('<note>Semaphore</note>', 'utf8').toString(
          'base64',
        ),
      },
    ]);
    expect(processed.errors).toEqual([]);
    expect(processed.promptBlock).toContain('"topic":"paging"');
    expect(processed.promptBlock).toContain('<note>Semaphore</note>');
  });
});
