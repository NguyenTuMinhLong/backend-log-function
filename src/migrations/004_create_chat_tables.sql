-- MIGRATION 004: Create Chat Tables

CREATE TABLE IF NOT EXISTS chat_conversations (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    assigned_admin_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    last_message_preview TEXT NULL,
    last_message_at TIMESTAMP NULL,
    last_user_read_at TIMESTAMP NULL,
    last_admin_read_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_chat_conversations_type
        CHECK (type IN ('ai', 'support')),
    CONSTRAINT chk_chat_conversations_status
        CHECK (status IN ('open', 'pending_admin', 'pending_user', 'resolved')),
    CONSTRAINT uq_chat_conversations_user_type UNIQUE (user_id, type)
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_type_last_message
    ON chat_conversations (type, last_message_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_id
    ON chat_conversations (user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    sender_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    sender_role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_chat_messages_sender_role
        CHECK (sender_role IN ('user', 'admin', 'assistant', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created_at
    ON chat_messages (conversation_id, created_at DESC, id DESC);
