import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { LocalFileStorageService } from './local-file-storage.service';

describe('LocalFileStorageService', () => {
  let root: string;
  let storage: LocalFileStorageService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'syll-attach-'));
    const config = {
      get: (key: string) =>
        key === 'ATTACHMENT_STORAGE_PATH' ? root : undefined,
    } as ConfigService;
    storage = new LocalFileStorageService(config);
    await storage.onModuleInit();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('persists and reads objects under the volume root', async () => {
    const key = 'attachments/abc/original';
    await storage.putObject(key, Buffer.from('hello-volume'));
    expect(await storage.exists(key)).toBe(true);
    expect((await storage.getObject(key)).toString('utf8')).toBe('hello-volume');
    const absolute = path.join(root, 'attachments', 'abc', 'original');
    expect(await fs.readFile(absolute, 'utf8')).toBe('hello-volume');
  });

  it('rejects path traversal keys', async () => {
    await expect(
      storage.putObject('../outside.txt', Buffer.from('x')),
    ).rejects.toThrow(/Invalid storage key/);
  });

  it('deletes objects idempotently', async () => {
    const key = 'attachments/del/original';
    await storage.putObject(key, Buffer.from('bye'));
    await storage.deleteObject(key);
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.deleteObjectIfExists(key)).resolves.toBeUndefined();
  });
});
