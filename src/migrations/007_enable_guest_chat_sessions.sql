ALTER TABLE chat_conversations
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS guest_session_id VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS guest_name VARCHAR(120) NULL;

ALTER TABLE chat_conversations
  DROP CONSTRAINT IF EXISTS uq_chat_conversations_user_type;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conversations_user_type
  ON chat_conversations (user_id, type)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conversations_guest_type
  ON chat_conversations (guest_session_id, type)
  WHERE guest_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_guest_session
  ON chat_conversations (guest_session_id)
  WHERE guest_session_id IS NOT NULL;
