-- Production migration for persistent chat attachments.
-- Dev/test environments use TypeORM synchronize instead.
-- Apply manually when NODE_ENV=production (synchronize is off).

CREATE TABLE IF NOT EXISTS chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename character varying(255) NOT NULL,
  storage_key character varying(512) NOT NULL,
  mime_type character varying(127) NOT NULL,
  byte_length integer NOT NULL,
  moodle_user_id integer NOT NULL,
  course_id integer NOT NULL,
  conversation_id uuid NULL,
  message_id uuid NULL,
  status character varying(16) NOT NULL DEFAULT 'uploaded',
  processing_error text NULL,
  chunk_refs jsonb NULL,
  extension character varying(16) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_moodle_user_id
  ON chat_attachments (moodle_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_course_id
  ON chat_attachments (course_id);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_conversation_id
  ON chat_attachments (conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_message_id
  ON chat_attachments (message_id);

CREATE TABLE IF NOT EXISTS chat_attachment_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES chat_attachments(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  char_count integer NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_attachment_chunks_attachment_id
  ON chat_attachment_chunks (attachment_id);
