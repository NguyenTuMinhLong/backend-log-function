"use strict";

/**
 * SQL queries liên quan đến bảng chat_conversations và chat_messages
 * Được dùng bởi: chat.service.js
 */

// ── Conversations ──────────────────────────────────────────────────────────────

const SELECT_CONVERSATION_DETAIL = (readColumn, unreadRole) =>
  `SELECT
     c.id,
     c.user_id, c.guest_session_id, c.guest_name,
     c.type, c.status, c.assigned_admin_id,
     c.last_message_preview, c.last_message_at,
     c.last_user_read_at, c.last_admin_read_at,
     c.created_at, c.updated_at,
     u.full_name AS user_full_name,
     u.email     AS user_email,
     u.phone     AS user_phone,
     admin_u.full_name AS assigned_admin_full_name,
     admin_u.email     AS assigned_admin_email,
     COALESCE((
       SELECT COUNT(*)
       FROM chat_messages m
       WHERE m.conversation_id = c.id
         AND m.sender_role = '${unreadRole}'
         AND m.created_at > COALESCE(c.${readColumn}, TO_TIMESTAMP(0))
     ), 0) AS unread_count
   FROM chat_conversations c
   LEFT JOIN users u       ON u.id = c.user_id
   LEFT JOIN users admin_u ON admin_u.id = c.assigned_admin_id
   WHERE c.id = $1
   LIMIT 1`;

const SELECT_CONVERSATION_ID_BY_ACTOR = (lookupClause, typeIdx) =>
  `SELECT id FROM chat_conversations
   WHERE ${lookupClause} AND type = $${typeIdx}
   LIMIT 1`;

const INSERT_CONVERSATION_USER =
  `INSERT INTO chat_conversations (user_id, type, status, last_user_read_at)
   VALUES ($1, $2, 'open', NOW())
   ON CONFLICT (user_id, type)
   WHERE user_id IS NOT NULL
   DO UPDATE SET updated_at = NOW()
   RETURNING id`;

const INSERT_CONVERSATION_GUEST =
  `INSERT INTO chat_conversations (user_id, guest_session_id, guest_name, type, status, last_user_read_at)
   VALUES (NULL, $1, $2, $3, 'open', NOW())
   ON CONFLICT (guest_session_id, type)
   WHERE guest_session_id IS NOT NULL
   DO UPDATE SET
     updated_at = NOW(),
     guest_name = COALESCE(EXCLUDED.guest_name, chat_conversations.guest_name)
   RETURNING id`;

const UPDATE_CONVERSATION = (assignments, idx) =>
  `UPDATE chat_conversations SET ${assignments.join(", ")}, updated_at = NOW()
   WHERE id = $${idx}
   RETURNING id`;

// ── Messages ───────────────────────────────────────────────────────────────────

const INSERT_MESSAGE =
  `INSERT INTO chat_messages (conversation_id, sender_id, sender_role, content, meta)
   VALUES ($1, $2, $3, $4, $5::jsonb)
   RETURNING id, conversation_id, sender_id, sender_role, content, meta, created_at`;

const SELECT_MESSAGES_BY_CONVERSATION =
  `SELECT *
   FROM (
     SELECT
       m.id, m.conversation_id, m.sender_id, m.sender_role,
       m.content, m.meta, m.created_at,
       COALESCE(
         u.full_name,
         CASE
           WHEN m.sender_role = 'assistant' THEN 'Vivudee AI'
           WHEN m.sender_role = 'admin'     THEN 'Admin'
           WHEN m.sender_role = 'system'    THEN 'He thong'
           WHEN m.sender_role = 'user'      THEN COALESCE(c.guest_name, 'Khach')
           ELSE 'User'
         END
       ) AS sender_name
     FROM chat_messages m
     LEFT JOIN users u              ON u.id = m.sender_id
     LEFT JOIN chat_conversations c ON c.id = m.conversation_id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $2
   ) recent_messages
   ORDER BY created_at ASC, id ASC`;

const SELECT_AI_HISTORY =
  `SELECT sender_role, content
   FROM chat_messages
   WHERE conversation_id = $1
     AND sender_role IN ('user', 'assistant')
   ORDER BY created_at DESC, id DESC
   LIMIT $2`;

// ── Admin: List support conversations ─────────────────────────────────────────

const COUNT_SUPPORT_CONVERSATIONS = (whereClause) =>
  `SELECT COUNT(*) AS total
   FROM chat_conversations c
   LEFT JOIN users u ON u.id = c.user_id
   ${whereClause}`;

const SELECT_SUPPORT_CONVERSATIONS = (whereClause, limitIdx, offsetIdx) =>
  `SELECT
     c.id, c.user_id, c.guest_session_id, c.guest_name,
     c.type, c.status, c.assigned_admin_id,
     c.last_message_preview, c.last_message_at,
     c.last_user_read_at, c.last_admin_read_at,
     c.created_at, c.updated_at,
     u.full_name AS user_full_name,
     u.email     AS user_email,
     u.phone     AS user_phone,
     admin_u.full_name AS assigned_admin_full_name,
     admin_u.email     AS assigned_admin_email,
     COALESCE((
       SELECT COUNT(*)
       FROM chat_messages m
       WHERE m.conversation_id = c.id
         AND m.sender_role = 'user'
         AND m.created_at > COALESCE(c.last_admin_read_at, TO_TIMESTAMP(0))
     ), 0) AS unread_count
   FROM chat_conversations c
   LEFT JOIN users u       ON u.id = c.user_id
   LEFT JOIN users admin_u ON admin_u.id = c.assigned_admin_id
   ${whereClause}
   ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
   LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

module.exports = {
  SELECT_CONVERSATION_DETAIL,
  SELECT_CONVERSATION_ID_BY_ACTOR,
  INSERT_CONVERSATION_USER,
  INSERT_CONVERSATION_GUEST,
  UPDATE_CONVERSATION,
  INSERT_MESSAGE,
  SELECT_MESSAGES_BY_CONVERSATION,
  SELECT_AI_HISTORY,
  COUNT_SUPPORT_CONVERSATIONS,
  SELECT_SUPPORT_CONVERSATIONS,
};
