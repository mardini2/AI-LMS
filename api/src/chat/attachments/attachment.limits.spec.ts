import {
  CHAT_ATTACHMENT_DEFAULT_USER_QUOTA_BYTES,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
} from './attachment.constants';

describe('attachment size limits', () => {
    it('uses 15 MB / 100 MB / 1 GB / 10-file defaults', () => {
    expect(CHAT_ATTACHMENT_MAX_FILES).toBe(10);
    expect(CHAT_ATTACHMENT_MAX_BYTES).toBe(15 * 1024 * 1024);
    expect(CHAT_ATTACHMENT_MAX_TOTAL_BYTES).toBe(100 * 1024 * 1024);
    expect(CHAT_ATTACHMENT_DEFAULT_USER_QUOTA_BYTES).toBe(1024 * 1024 * 1024);
  });
});
