// goal: configure multer disk storage for large attachments under ./uploads.

import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';

// hard cap per file; tune if storage or reverse proxy limits differ
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

const uploadsRoot = join(process.cwd(), 'uploads');

function ensureUploadsRoot() {
  if (!existsSync(uploadsRoot)) {
    mkdirSync(uploadsRoot, { recursive: true });
  }
}

function randomSuffix() {
  return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

export const attachmentMulterOptions = {
  storage: diskStorage({
    destination: (_request, _file, callback) => {
      ensureUploadsRoot();
      callback(null, uploadsRoot);
    },
    filename: (_request, file, callback) => {
      const safeExt = extname(file.originalname) || '';
      callback(null, `${randomSuffix()}${safeExt}`);
    },
  }),
  limits: {
    fileSize: MAX_ATTACHMENT_BYTES,
  },
  fileFilter: (
    _request: unknown,
    _file: unknown,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    // accept most file types; size limit and auth still apply
    callback(null, true);
  },
};
