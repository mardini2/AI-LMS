/** Maximum number of files a student may attach to one chat message. */
export const CHAT_ATTACHMENT_MAX_FILES = 10;

/** Per-file size limit (50 MiB). */
export const CHAT_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

/** Combined size limit across all files in one multipart upload request. */
export const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 300 * 1024 * 1024;

/** Truncate extracted text per file before chunking. */
export const CHAT_ATTACHMENT_MAX_CHARS_PER_FILE = 50_000;

/** Max extracted characters injected into one LLM turn. */
export const CHAT_ATTACHMENT_MAX_CHARS_TOTAL = 120_000;

/** Max entries to inspect inside a ZIP archive. */
export const CHAT_ATTACHMENT_ZIP_MAX_ENTRIES = 40;

/** Default per-user storage quota (2 GiB). Overridable via env. */
export const CHAT_ATTACHMENT_DEFAULT_USER_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/** Default: delete abandoned uploads after 24 hours. */
export const CHAT_ATTACHMENT_DEFAULT_ABANDONED_HOURS = 24;

/** Default: delete attachments 30 days after conversation last activity. */
export const CHAT_ATTACHMENT_DEFAULT_RETENTION_DAYS = 30;

/** Chunk size for persisted extracted text. */
export const CHAT_ATTACHMENT_CHUNK_SIZE = 1_500;

/** Overlap between consecutive chunks. */
export const CHAT_ATTACHMENT_CHUNK_OVERLAP = 100;

/** Max chunks retrieved into one LLM prompt. */
export const CHAT_ATTACHMENT_MAX_CHUNKS_PER_PROMPT = 12;

/**
 * Supported chat upload extensions, grouped by rollout phase.
 * Matching is case-insensitive on the filename extension.
 */
export const CHAT_ATTACHMENT_EXTENSIONS = {
  phase1: [
    'pdf',
    'docx',
    'pptx',
    'txt',
    'md',
    'py',
    'java',
    'js',
    'ts',
    'cpp',
    'c',
    'cs',
    'php',
  ],
  phase2: ['xlsx', 'csv', 'zip', 'json', 'xml', 'sql', 'odt', 'ods', 'odp'],
  phase3: ['epub', 'tex'],
} as const;

/** Text-extractable types (full extraction supported now). */
export const CHAT_ATTACHMENT_TEXT_EXTENSIONS = new Set([
  'pdf',
  'docx',
  'pptx',
  'txt',
  'md',
  'py',
  'java',
  'js',
  'ts',
  'cpp',
  'c',
  'cs',
  'php',
  'xlsx',
  'csv',
  'zip',
  'json',
  'xml',
  'sql',
  'odt',
  'ods',
  'odp',
  'epub',
  'tex',
]);

/**
 * Images / audio / video — blocked until we have OCR / transcription.
 * Keep this list so uploads get a clear "OCR" toast instead of a vague reject.
 */
export const CHAT_ATTACHMENT_OCR_BLOCKED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'mp3',
  'wav',
  'm4a',
  'mp4',
  'mov',
  'avi',
]);

/** Shown in API errors and the chat toast. Keep it short. */
export const CHAT_ATTACHMENT_OCR_BLOCKED_MESSAGE =
  "Images and media files aren't allowed yet (OCR not available).";

export const CHAT_ATTACHMENT_ALLOWED_EXTENSIONS: readonly string[] = [
  ...CHAT_ATTACHMENT_EXTENSIONS.phase1,
  ...CHAT_ATTACHMENT_EXTENSIONS.phase2,
  ...CHAT_ATTACHMENT_EXTENSIONS.phase3,
];

export const CHAT_ATTACHMENT_ALLOWED_EXTENSION_SET = new Set(
  CHAT_ATTACHMENT_ALLOWED_EXTENSIONS.map((ext) => ext.toLowerCase()),
);

/** MIME hints used when the client omits mimeType. */
export const CHAT_ATTACHMENT_MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  sql: 'application/sql',
  py: 'text/x-python',
  java: 'text/x-java-source',
  js: 'text/javascript',
  ts: 'text/typescript',
  cpp: 'text/x-c++src',
  c: 'text/x-csrc',
  cs: 'text/x-csharp',
  php: 'application/x-httpd-php',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  epub: 'application/epub+zip',
  tex: 'application/x-tex',
};

/** Legacy extraction status used by buffer helpers / tests. */
export type ChatAttachmentStatus =
  | 'ok'
  | 'unsupported'
  | 'oversized'
  | 'corrupted'
  | 'empty'
  | 'binary_only';

/** @deprecated Prefer multipart upload; kept for unit tests of extractors. */
export interface ChatAttachmentInput {
  filename: string;
  mimeType?: string;
  dataBase64: string;
}

export interface ChatAttachmentResult {
  filename: string;
  extension: string;
  mimeType: string;
  byteLength: number;
  status: ChatAttachmentStatus;
  text: string;
  error?: string;
}

export interface ProcessedChatAttachments {
  results: ChatAttachmentResult[];
  promptBlock: string;
  storagePrefix: string;
  usableFilenames: string[];
  errors: string[];
}

export interface AttachmentClientDto {
  id: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  status: string;
  processingError?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  createdAt: string;
}
