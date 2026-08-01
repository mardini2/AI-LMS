import {
  CHAT_ATTACHMENT_DEFAULT_USER_QUOTA_BYTES,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
} from './attachment.constants';

describe('attachment size limits', () => {
  it('uses 50 MB / 300 MB / 2 GB / 10-file defaults', () => {
    expect(CHAT_ATTACHMENT_MAX_FILES).toBe(10);
    expect(CHAT_ATTACHMENT_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(CHAT_ATTACHMENT_MAX_TOTAL_BYTES).toBe(300 * 1024 * 1024);
    expect(CHAT_ATTACHMENT_DEFAULT_USER_QUOTA_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });
});
