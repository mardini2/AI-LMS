import { Injectable } from '@nestjs/common';

/**
 * Opaque object-storage abstraction.
 * Keys are internal only — never return them to clients.
 * Swap LocalFileStorageService for MinIO/S3/Azure later without changing callers.
 */
export abstract class StorageService {
  abstract putObject(key: string, data: Buffer, contentType?: string): Promise<void>;
  abstract getObject(key: string): Promise<Buffer>;
  abstract deleteObject(key: string): Promise<void>;
  abstract exists(key: string): Promise<boolean>;
  /** Best-effort delete; never throws for missing keys. */
  abstract deleteObjectIfExists(key: string): Promise<void>;
}

export const ATTACHMENT_STORAGE = 'ATTACHMENT_STORAGE';
