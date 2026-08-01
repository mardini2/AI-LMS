import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { StorageService } from './storage.service';

/**
 * Local disk storage backed by ATTACHMENT_STORAGE_PATH (Docker volume in compose).
 * Object keys are relative paths under the root; path traversal is rejected.
 */
@Injectable()
export class LocalFileStorageService
  extends StorageService
  implements OnModuleInit
{
  private readonly logger = new Logger(LocalFileStorageService.name);
  private rootDir: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.rootDir = path.resolve(
      this.config.get<string>('ATTACHMENT_STORAGE_PATH') ||
        path.join(process.cwd(), 'uploads'),
    );
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    this.logger.log(`Attachment storage root ready at ${this.rootDir}`);
  }

  /** Resolve a storage key to an absolute path, rejecting traversal. */
  private resolveKey(key: string): string {
    const normalized = String(key || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (
      !normalized ||
      normalized.includes('\0') ||
      normalized.split('/').some((part) => part === '..' || part === '')
    ) {
      throw new Error('Invalid storage key');
    }
    const absolute = path.resolve(this.rootDir, normalized);
    const rootWithSep = this.rootDir.endsWith(path.sep)
      ? this.rootDir
      : this.rootDir + path.sep;
    if (absolute !== this.rootDir && !absolute.startsWith(rootWithSep)) {
      throw new Error('Invalid storage key');
    }
    return absolute;
  }

  async putObject(
    key: string,
    data: Buffer,
    _contentType?: string,
  ): Promise<void> {
    const absolute = this.resolveKey(key);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, data);
  }

  async getObject(key: string): Promise<Buffer> {
    const absolute = this.resolveKey(key);
    return fs.readFile(absolute);
  }

  async deleteObject(key: string): Promise<void> {
    const absolute = this.resolveKey(key);
    await fs.unlink(absolute);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async deleteObjectIfExists(key: string): Promise<void> {
    try {
      await this.deleteObject(key);
    } catch {
      // Missing or already deleted — idempotent.
    }
  }

  /** Test helper: expose resolved root (never sent to clients). */
  getRootDirForTests(): string {
    return this.rootDir;
  }
}
