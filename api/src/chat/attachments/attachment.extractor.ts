import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import {
  looksLikePdf,
  parsePdfText,
  stripHtml,
} from '../../context/context.helpers';
import {
  CHAT_ATTACHMENT_ALLOWED_EXTENSION_SET,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_CHARS_PER_FILE,
  CHAT_ATTACHMENT_MAX_CHARS_TOTAL,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
  CHAT_ATTACHMENT_MIME_BY_EXT,
  CHAT_ATTACHMENT_OCR_BLOCKED_EXTENSIONS,
  CHAT_ATTACHMENT_OCR_BLOCKED_MESSAGE,
  CHAT_ATTACHMENT_ZIP_MAX_ENTRIES,
  type ChatAttachmentInput,
  type ChatAttachmentResult,
  type ChatAttachmentStatus,
  type ProcessedChatAttachments,
} from './attachment.constants';
import { isSafeZipEntryName } from './attachment.chunking';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip') as typeof import('jszip');

export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() || filename;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) {
    return '';
  }
  return base.slice(dot + 1).toLowerCase();
}

export function isAllowedAttachmentExtension(ext: string): boolean {
  return CHAT_ATTACHMENT_ALLOWED_EXTENSION_SET.has(ext.toLowerCase());
}

export function isOcrBlockedAttachmentExtension(ext: string): boolean {
  return CHAT_ATTACHMENT_OCR_BLOCKED_EXTENSIONS.has(ext.toLowerCase());
}

export function decodeBase64Payload(dataBase64: string): Buffer {
  const cleaned = String(dataBase64 || '')
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s+/g, '');
  if (!cleaned) {
    throw new Error('File data is empty');
  }
  const buffer = Buffer.from(cleaned, 'base64');
  if (!buffer.length) {
    throw new Error('File data could not be decoded');
  }
  // Detect truncated / invalid base64: decoded length should roughly match.
  if (cleaned.length >= 8 && buffer.length < 1) {
    throw new Error('File data could not be decoded');
  }
  return buffer;
}

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.replace(/\u0000/g, '').trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}\n\n[Truncated: extracted text exceeded ${maxChars} characters.]`;
}

function asUtf8Text(buffer: Buffer): string {
  // Reject obvious binary blobs that aren't valid UTF-8 text.
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) {
      suspicious += 3;
    } else if (byte < 9 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }
  if (suspicious > sample.length * 0.15) {
    throw new Error('File does not look like readable text');
  }
  return buffer.toString('utf8');
}

async function extractFromZipXml(
  buffer: Buffer,
  entryPaths: string[],
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const chunks: string[] = [];
  for (const path of entryPaths) {
    const entry = zip.file(path);
    if (!entry) continue;
    const xml = await entry.async('string');
    const text = stripHtml(xml.replace(/<a:t[^>]*>/gi, ' ').replace(/<\/a:t>/gi, ' '));
    if (text) chunks.push(text);
  }
  if (!chunks.length) {
    // Fall back: concatenate text-ish XML entries.
    const names = Object.keys(zip.files).filter(
      (name) =>
        !zip.files[name].dir &&
        isSafeZipEntryName(name) &&
        (name.endsWith('.xml') || name.endsWith('.rels')),
    );
    for (const name of names.slice(0, 30)) {
      const xml = await zip.files[name].async('string');
      const text = stripHtml(xml);
      if (text && text.length > 20) chunks.push(text);
    }
  }
  return chunks.join('\n\n').trim();
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return (result.value || '').trim();
}

async function extractPptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter(
      (name) =>
        isSafeZipEntryName(name) && /^ppt\/slides\/slide\d+\.xml$/i.test(name),
    )
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const chunks: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async('string');
    // DrawingML text runs live in <a:t>…</a:t>.
    const parts: string[] = [];
    const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml))) {
      const t = stripHtml(match[1] || '').trim();
      if (t) parts.push(t);
    }
    if (parts.length) {
      chunks.push(`Slide ${chunks.length + 1}:\n${parts.join(' ')}`);
    }
  }
  return chunks.join('\n\n').trim();
}

async function extractOpenDocument(buffer: Buffer): Promise<string> {
  return extractFromZipXml(buffer, ['content.xml']);
}

function extractSpreadsheet(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer', dense: true });
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return csv.trim() ? `Sheet: ${name}\n${csv.trim()}` : '';
  }).filter(Boolean);
  return sheets.join('\n\n').trim();
}

async function extractZipListing(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir && isSafeZipEntryName(name))
    .slice(0, CHAT_ATTACHMENT_ZIP_MAX_ENTRIES);
  const skippedUnsafe = Object.keys(zip.files).filter(
    (name) => !zip.files[name].dir && !isSafeZipEntryName(name),
  ).length;
  const lines: string[] = [
    `ZIP archive with ${entries.length} listed file(s):`,
    ...entries.map((name) => `- ${name}`),
  ];
  if (skippedUnsafe > 0) {
    lines.push(
      `(Skipped ${skippedUnsafe} unsafe path(s) that looked like zip-slip attempts.)`,
    );
  }

  let nestedBudget = 3;
  for (const name of entries) {
    if (nestedBudget <= 0) break;
    const ext = extensionOf(name);
    if (!isAllowedAttachmentExtension(ext) || ext === 'zip') continue;
    if (['mp3', 'wav', 'm4a', 'mp4', 'mov', 'avi', 'png', 'jpg', 'jpeg'].includes(ext)) {
      continue;
    }
    try {
      const nested = Buffer.from(await zip.files[name].async('uint8array'));
      if (nested.length > CHAT_ATTACHMENT_MAX_BYTES) continue;
      const extracted = await extractBufferContent(name, ext, nested);
      if (extracted.text && extracted.status === 'ok') {
        lines.push(
          `\n### Nested file: ${name}\n${truncateText(extracted.text, 8_000)}`,
        );
        nestedBudget -= 1;
      }
    } catch {
      // Skip nested failures; listing is still useful.
    }
  }
  return lines.join('\n').trim();
}

async function extractEpub(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter(
      (name) =>
        !zip.files[name].dir &&
        isSafeZipEntryName(name) &&
        /\.(xhtml|html|htm|xml|txt)$/i.test(name),
    )
    .slice(0, 40);
  const chunks: string[] = [];
  for (const name of names) {
    const raw = await zip.files[name].async('string');
    const text = stripHtml(raw);
    if (text) chunks.push(text);
  }
  return chunks.join('\n\n').trim();
}

function binaryMediaNote(
  filename: string,
  ext: string,
  byteLength: number,
  kind: 'image' | 'audio' | 'video',
): { status: ChatAttachmentStatus; text: string } {
  const pending =
    kind === 'image'
      ? 'Image OCR is not available yet (pending). Only the filename/metadata note is stored so OCR can be plugged in later.'
      : 'Audio/video transcription is not available yet (pending). Only the filename/metadata note is stored so transcription can be plugged in later.';
  return {
    status: 'binary_only',
    text: [
      `Attached ${kind} file "${filename}" (${ext.toUpperCase()}, ${byteLength} bytes).`,
      pending,
      'Use any student description in the message alongside this note.',
    ].join(' '),
  };
}

export async function extractBufferContent(
  filename: string,
  ext: string,
  buffer: Buffer,
): Promise<{ status: ChatAttachmentStatus; text: string; error?: string }> {
  try {
    switch (ext) {
      case 'pdf': {
        if (!looksLikePdf(buffer)) {
          return {
            status: 'corrupted',
            text: '',
            error: `"${filename}" does not look like a valid PDF.`,
          };
        }
        const parsed = await parsePdfText(buffer);
        const text = (parsed.text || '').trim();
        if (!text) {
          return {
            status: 'empty',
            text: '',
            error: `"${filename}" was readable as a PDF but no text could be extracted (it may be scanned/image-only).`,
          };
        }
        return { status: 'ok', text };
      }
      case 'docx': {
        const text = await extractDocx(buffer);
        if (!text) {
          return {
            status: 'empty',
            text: '',
            error: `"${filename}" contained no extractable text.`,
          };
        }
        return { status: 'ok', text };
      }
      case 'pptx': {
        const text = await extractPptx(buffer);
        if (!text) {
          return {
            status: 'empty',
            text: '',
            error: `"${filename}" contained no extractable slide text.`,
          };
        }
        return { status: 'ok', text };
      }
      case 'ods': {
        try {
          const sheetText = extractSpreadsheet(buffer);
          if (sheetText) return { status: 'ok', text: sheetText };
        } catch {
          // Fall through to ODF content.xml.
        }
        const odsText = await extractOpenDocument(buffer);
        if (!odsText) {
          return {
            status: 'empty',
            text: '',
            error: `"${filename}" contained no extractable spreadsheet text.`,
          };
        }
        return { status: 'ok', text: odsText };
      }
      case 'odt':
      case 'odp': {
        const text = await extractOpenDocument(buffer);
        if (!text) {
          return {
            status: 'empty',
            text: '',
            error: `"${filename}" contained no extractable text.`,
          };
        }
        return { status: 'ok', text };
      }
      case 'xlsx': {
        const text = extractSpreadsheet(buffer);
        if (!text) {
          return {
            status: 'empty',
            text: '',
            error: `"${filename}" contained no extractable spreadsheet data.`,
          };
        }
        return { status: 'ok', text };
      }
      case 'csv':
      case 'txt':
      case 'md':
      case 'json':
      case 'xml':
      case 'sql':
      case 'py':
      case 'java':
      case 'js':
      case 'ts':
      case 'cpp':
      case 'c':
      case 'cs':
      case 'php':
      case 'tex': {
        const text = asUtf8Text(buffer).trim();
        if (!text) {
          return {
            status: 'empty',
            text: '',
            error: `"${filename}" is empty.`,
          };
        }
        return { status: 'ok', text };
      }
      case 'zip': {
        const text = await extractZipListing(buffer);
        return { status: 'ok', text };
      }
      case 'epub': {
        const text = await extractEpub(buffer);
        if (!text) {
          return {
            status: 'empty',
            text: '',
            error: `"${filename}" contained no extractable EPUB text.`,
          };
        }
        return { status: 'ok', text };
      }
      case 'png':
      case 'jpg':
      case 'jpeg':
        return binaryMediaNote(filename, ext, buffer.length, 'image');
      case 'mp3':
      case 'wav':
      case 'm4a':
        return binaryMediaNote(filename, ext, buffer.length, 'audio');
      case 'mp4':
      case 'mov':
      case 'avi':
        return binaryMediaNote(filename, ext, buffer.length, 'video');
      default:
        return {
          status: 'unsupported',
          text: '',
          error: `"${filename}" uses an unsupported file type.`,
        };
    }
  } catch (err) {
    return {
      status: 'corrupted',
      text: '',
      error: `"${filename}" could not be read (${(err as Error).message || 'corrupted or unreadable'}).`,
    };
  }
}

export function buildAttachmentPromptBlock(
  results: ChatAttachmentResult[],
): string {
  const usable = results.filter(
    (r) =>
      (r.status === 'ok' || r.status === 'binary_only') && r.text.trim().length,
  );
  if (!usable.length) {
    return '';
  }

  let remaining = CHAT_ATTACHMENT_MAX_CHARS_TOTAL;
  const parts: string[] = [
    'The student attached the following file(s). Use their contents when answering:',
  ];

  for (const file of usable) {
    if (remaining <= 0) {
      parts.push(
        '\n[Additional attached file text was omitted because the combined extraction limit was reached.]',
      );
      break;
    }
    const body = truncateText(
      file.text,
      Math.min(CHAT_ATTACHMENT_MAX_CHARS_PER_FILE, remaining),
    );
    remaining -= body.length;
    parts.push(`\n### Attached file: ${file.filename}\n${body}`);
  }

  return parts.join('\n').trim();
}

export function buildAttachmentStoragePrefix(
  results: ChatAttachmentResult[],
): string {
  if (!results.length) return '';
  const names = results.map((r) => r.filename).join(', ');
  return `[syllentras-files: ${names}]`;
}

/**
 * Validate and extract readable content from chat upload payloads.
 * Does not throw for per-file failures; aggregates errors instead.
 * Throws only for request-level violations (too many files / total size).
 */
export async function processChatAttachments(
  inputs: ChatAttachmentInput[] | undefined | null,
): Promise<ProcessedChatAttachments> {
  const list = Array.isArray(inputs) ? inputs : [];
  if (list.length > CHAT_ATTACHMENT_MAX_FILES) {
    throw new Error('You can attach up to 10 files per message.');
  }

  const results: ChatAttachmentResult[] = [];
  const errors: string[] = [];
  let totalBytes = 0;

  for (const input of list) {
    const filename = String(input?.filename || 'file').trim() || 'file';
    const ext = extensionOf(filename);
    const mimeType =
      (input.mimeType && String(input.mimeType).trim()) ||
      CHAT_ATTACHMENT_MIME_BY_EXT[ext] ||
      'application/octet-stream';

    if (ext && isOcrBlockedAttachmentExtension(ext)) {
      const result: ChatAttachmentResult = {
        filename,
        extension: ext,
        mimeType,
        byteLength: 0,
        status: 'unsupported',
        text: '',
        error: CHAT_ATTACHMENT_OCR_BLOCKED_MESSAGE,
      };
      results.push(result);
      errors.push(result.error!);
      continue;
    }

    if (!ext || !isAllowedAttachmentExtension(ext)) {
      const result: ChatAttachmentResult = {
        filename,
        extension: ext,
        mimeType,
        byteLength: 0,
        status: 'unsupported',
        text: '',
        error: `"${filename}" is not a supported file type.`,
      };
      results.push(result);
      errors.push(result.error!);
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = decodeBase64Payload(input.dataBase64);
    } catch (err) {
      const result: ChatAttachmentResult = {
        filename,
        extension: ext,
        mimeType,
        byteLength: 0,
        status: 'corrupted',
        text: '',
        error: `"${filename}" could not be decoded (${(err as Error).message}).`,
      };
      results.push(result);
      errors.push(result.error!);
      continue;
    }

    if (buffer.length > CHAT_ATTACHMENT_MAX_BYTES) {
      const result: ChatAttachmentResult = {
        filename,
        extension: ext,
        mimeType,
        byteLength: buffer.length,
        status: 'oversized',
        text: '',
        error:
          'This file is too large. Maximum size is ' +
          `${Math.round(CHAT_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB per file.`,
      };
      results.push(result);
      errors.push(result.error!);
      continue;
    }

    totalBytes += buffer.length;
    if (totalBytes > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
      throw new Error(
        `Upload limit exceeded. Maximum total upload size is ${Math.round(CHAT_ATTACHMENT_MAX_TOTAL_BYTES / (1024 * 1024))} MB.`,
      );
    }

    const extracted = await extractBufferContent(filename, ext, buffer);
    const text =
      extracted.status === 'ok' || extracted.status === 'binary_only'
        ? truncateText(extracted.text, CHAT_ATTACHMENT_MAX_CHARS_PER_FILE)
        : '';
    const result: ChatAttachmentResult = {
      filename,
      extension: ext,
      mimeType,
      byteLength: buffer.length,
      status: extracted.status,
      text,
      error: extracted.error,
    };
    results.push(result);
    if (extracted.error) {
      errors.push(extracted.error);
    }
  }

  return {
    results,
    promptBlock: buildAttachmentPromptBlock(results),
    storagePrefix: buildAttachmentStoragePrefix(results),
    usableFilenames: results
      .filter((r) => r.status === 'ok' || r.status === 'binary_only')
      .map((r) => r.filename),
    errors,
  };
}

export function composeUserMessageForLlm(
  message: string,
  promptBlock: string,
): string {
  const text = (message || '').trim();
  if (!promptBlock) {
    return text;
  }
  if (!text) {
    return `${promptBlock}\n\nPlease review the attached file(s).`;
  }
  return `${text}\n\n${promptBlock}`;
}

export function composeUserMessageForStorage(
  message: string,
  storagePrefix: string,
): string {
  const text = (message || '').trim();
  const body = text || 'Please review the attached file(s).';
  if (!storagePrefix) {
    return body;
  }
  return `${storagePrefix}\n\n${body}`;
}

/** Parse attachment names from a stored user message prefix. */
export function parseStoredAttachmentNames(content: string): {
  filenames: string[];
  displayText: string;
} {
  const match = String(content || '').match(
    /^\[syllentras-files:\s*([^\]]+)\]\s*(?:\n+)?([\s\S]*)$/i,
  );
  if (!match) {
    return { filenames: [], displayText: content };
  }
  const filenames = match[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    filenames,
    displayText: (match[2] || '').trim(),
  };
}
