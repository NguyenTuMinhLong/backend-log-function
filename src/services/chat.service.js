const pool = require("../config/db");
const assistantChatService = require("./admin.chat.service");
const {
  emitAiConversationChanged,
  emitSupportConversationChanged,
} = require("../socket");

const CONVERSATION_TYPES = ["ai", "support"];
const SUPPORT_STATUSES = ["open", "pending_admin", "pending_user", "resolved"];
const MESSAGE_ROLES = ["user", "admin", "assistant", "system"];
const MESSAGE_LIMIT = 80;

const buildPreview = (value = "") => String(value).trim().replace(/\s+/g, " ").slice(0, 160);

const requireMessage = (payload = {}) => {
  const message = String(payload.message || "").trim();
  if (!message) {
    throw new Error("message là bắt buộc");
  }

  return message;
};

const ensureConversationType = (type) => {
  if (!CONVERSATION_TYPES.includes(type)) {
    throw new Error(`type phải là: ${CONVERSATION_TYPES.join(", ")}`);
  }
};

const ensureSupportStatus = (status) => {
  if (!SUPPORT_STATUSES.includes(status)) {
    throw new Error(`status phải là: ${SUPPORT_STATUSES.join(", ")}`);
  }
};

const mapConversation = (row) => {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    type: row.type,
    status: row.status,
    last_message_preview: row.last_message_preview,
    last_message_at: row.last_message_at,
    last_user_read_at: row.last_user_read_at,
    last_admin_read_at: row.last_admin_read_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    unread_count:
      row.unread_count !== undefined && row.unread_count !== null
        ? Number(row.unread_count)
        : 0,
    assigned_admin: row.assigned_admin_id
      ? {
          id: Number(row.assigned_admin_id),
          full_name: row.assigned_admin_full_name || null,
          email: row.assigned_admin_email || null,
        }
      : null,
    user: row.user_id
      ? {
          id: Number(row.user_id),
          full_name: row.user_full_name,
          email: row.user_email,
          phone: row.user_phone,
        }
      : null,
  };
};

const mapMessage = (row) => ({
  id: Number(row.id),
  conversation_id: Number(row.conversation_id),
  sender_id: row.sender_id ? Number(row.sender_id) : null,
  sender_role: row.sender_role,
  sender_name: row.sender_name,
  content: row.content,
  meta: row.meta || {},
  created_at: row.created_at,
});

const getConversationDetailById = async (client, conversationId, unreadFor = "user") => {
  const unreadRole = unreadFor === "admin" ? "user" : "admin";
  const readColumn = unreadFor === "admin" ? "last_admin_read_at" : "last_user_read_at";

  const result = await client.query(
    `
    SELECT
      c.id,
      c.user_id,
      c.type,
      c.status,
      c.assigned_admin_id,
      c.last_message_preview,
      c.last_message_at,
      c.last_user_read_at,
      c.last_admin_read_at,
      c.created_at,
      c.updated_at,
      u.full_name AS user_full_name,
      u.email AS user_email,
      u.phone AS user_phone,
      admin_u.full_name AS assigned_admin_full_name,
      admin_u.email AS assigned_admin_email,
      COALESCE((
        SELECT COUNT(*)
        FROM chat_messages m
        WHERE m.conversation_id = c.id
          AND m.sender_role = $2
          AND m.created_at > COALESCE(c.${readColumn}, TO_TIMESTAMP(0))
      ), 0) AS unread_count
    FROM chat_conversations c
    JOIN users u
      ON u.id = c.user_id
    LEFT JOIN users admin_u
      ON admin_u.id = c.assigned_admin_id
    WHERE c.id = $1
    LIMIT 1
    `,
    [conversationId, unreadRole]
  );

  return result.rows[0] || null;
};

const getConversationByUserAndType = async (client, userId, type, unreadFor = "user") => {
  ensureConversationType(type);

  const result = await client.query(
    `
    SELECT id
    FROM chat_conversations
    WHERE user_id = $1
      AND type = $2
    LIMIT 1
    `,
    [userId, type]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return getConversationDetailById(client, result.rows[0].id, unreadFor);
};

const createOrGetConversation = async (client, userId, type) => {
  ensureConversationType(type);

  const result = await client.query(
    `
    INSERT INTO chat_conversations (
      user_id,
      type,
      status,
      last_user_read_at
    )
    VALUES (
      $1,
      $2,
      'open',
      NOW()
    )
    ON CONFLICT (user_id, type)
    DO UPDATE SET updated_at = NOW()
    RETURNING id
    `,
    [userId, type]
  );

  return result.rows[0];
};

const updateConversation = async (client, conversationId, updates = {}) => {
  const assignments = [];
  const values = [];
  let index = 1;

  Object.entries(updates).forEach(([column, value]) => {
    if (value === undefined) {
      return;
    }

    assignments.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  });

  assignments.push("updated_at = NOW()");
  values.push(conversationId);

  const result = await client.query(
    `
    UPDATE chat_conversations
    SET ${assignments.join(", ")}
    WHERE id = $${index}
    RETURNING id
    `,
    values
  );

  return result.rows[0] || null;
};

const insertMessage = async (client, { conversationId, senderId = null, senderRole, content, meta = {} }) => {
  if (!MESSAGE_ROLES.includes(senderRole)) {
    throw new Error(`senderRole phải là: ${MESSAGE_ROLES.join(", ")}`);
  }

  const result = await client.query(
    `
    INSERT INTO chat_messages (
      conversation_id,
      sender_id,
      sender_role,
      content,
      meta
    )
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING
      id,
      conversation_id,
      sender_id,
      sender_role,
      content,
      meta,
      created_at
    `,
    [conversationId, senderId, senderRole, content, JSON.stringify(meta)]
  );

  return result.rows[0];
};

const getMessagesByConversationId = async (client, conversationId, limit = MESSAGE_LIMIT) => {
  const result = await client.query(
    `
    SELECT *
    FROM (
      SELECT
        m.id,
        m.conversation_id,
        m.sender_id,
        m.sender_role,
        m.content,
        m.meta,
        m.created_at,
        COALESCE(
          u.full_name,
          CASE
            WHEN m.sender_role = 'assistant' THEN 'Vivudee AI'
            WHEN m.sender_role = 'admin' THEN 'Admin'
            WHEN m.sender_role = 'system' THEN 'Hệ thống'
            ELSE 'User'
          END
        ) AS sender_name
      FROM chat_messages m
      LEFT JOIN users u
        ON u.id = m.sender_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $2
    ) recent_messages
    ORDER BY created_at ASC, id ASC
    `,
    [conversationId, limit]
  );

  return result.rows.map(mapMessage);
};

const buildAiHistory = async (client, conversationId, maxHistory = 8) => {
  const result = await client.query(
    `
    SELECT sender_role, content
    FROM chat_messages
    WHERE conversation_id = $1
      AND sender_role IN ('user', 'assistant')
    ORDER BY created_at DESC, id DESC
    LIMIT $2
    `,
    [conversationId, maxHistory]
  );

  return result.rows
    .reverse()
    .map((item) => ({
      role: item.sender_role === "assistant" ? "assistant" : "user",
      content: item.content,
    }));
};

const getConversationPayload = async (client, conversationId, unreadFor = "user") => {
  const conversation = await getConversationDetailById(client, conversationId, unreadFor);
  const messages = await getMessagesByConversationId(client, conversationId);

  return {
    conversation: mapConversation(conversation),
    messages,
  };
};

const getConversationByType = async (user, type) => {
  ensureConversationType(type);

  const client = await pool.connect();

  try {
    const conversation = await getConversationByUserAndType(client, user.id, type, "user");

    if (!conversation) {
      return {
        conversation: null,
        messages: [],
      };
    }

    if (type === "support") {
      await updateConversation(client, conversation.id, {
        last_user_read_at: new Date(),
      });
    }

    return getConversationPayload(client, conversation.id, "user");
  } finally {
    client.release();
  }
};

const sendAiMessage = async (user, payload = {}) => {
  const message = requireMessage(payload);

  const client = await pool.connect();
  let conversationId;
  let userMessageRow;
  let history;

  try {
    await client.query("BEGIN");

    const created = await createOrGetConversation(client, user.id, "ai");
    conversationId = Number(created.id);

    userMessageRow = await insertMessage(client, {
      conversationId,
      senderId: user.id,
      senderRole: "user",
      content: message,
      meta: { source: "user" },
    });

    await updateConversation(client, conversationId, {
      last_message_preview: buildPreview(message),
      last_message_at: userMessageRow.created_at,
      last_user_read_at: userMessageRow.created_at,
    });

    history = await buildAiHistory(client, conversationId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const aiResult = await assistantChatService.chat({ message, history });

  const writeClient = await pool.connect();
  let supportConversationId = null;

  try {
    await writeClient.query("BEGIN");

    const assistantMessage = await insertMessage(writeClient, {
      conversationId,
      senderRole: "assistant",
      content: aiResult.reply,
      meta: {
        route: aiResult.route,
        reason: aiResult.reason || null,
        provider: aiResult.provider || null,
        provider_failures: aiResult.provider_failures || [],
        intent: aiResult.intent || null,
        confidence: aiResult.confidence || null,
        quick_replies: aiResult.quick_replies || [],
      },
    });

    await updateConversation(writeClient, conversationId, {
      last_message_preview: buildPreview(aiResult.reply),
      last_message_at: assistantMessage.created_at,
      last_user_read_at: assistantMessage.created_at,
    });

    if (aiResult.route === "admin") {
      const supportConversation = await createOrGetConversation(writeClient, user.id, "support");
      supportConversationId = Number(supportConversation.id);

      const supportUserMessage = await insertMessage(writeClient, {
        conversationId: supportConversationId,
        senderId: user.id,
        senderRole: "user",
        content: message,
        meta: {
          source: "ai_escalation",
          reason: aiResult.reason || null,
        },
      });

      await updateConversation(writeClient, supportConversationId, {
        status: "pending_admin",
        last_message_preview: buildPreview(message),
        last_message_at: supportUserMessage.created_at,
      });
    }

    await writeClient.query("COMMIT");
  } catch (error) {
    await writeClient.query("ROLLBACK");
    throw error;
  } finally {
    writeClient.release();
  }

  const readClient = await pool.connect();

  try {
    const payloadData = await getConversationPayload(readClient, conversationId, "user");
    emitAiConversationChanged(user.id, {
      conversationId,
      type: "ai",
      userId: Number(user.id),
    });

    if (supportConversationId) {
      emitSupportConversationChanged(user.id, {
        conversationId: supportConversationId,
        type: "support",
        userId: Number(user.id),
      });
    }

    return {
      ...payloadData,
      route: aiResult.route,
      reason: aiResult.reason || null,
      provider: aiResult.provider || null,
      intent: aiResult.intent || null,
      confidence: aiResult.confidence || null,
      quick_replies: aiResult.quick_replies || [],
      support_conversation_id: supportConversationId,
      should_contact_admin: aiResult.route === "admin",
    };
  } finally {
    readClient.release();
  }
};

const sendSupportMessage = async (user, payload = {}) => {
  const message = requireMessage(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const conversationRef = await createOrGetConversation(client, user.id, "support");
    const conversationId = Number(conversationRef.id);

    const supportUserMessage = await insertMessage(client, {
      conversationId,
      senderId: user.id,
      senderRole: "user",
      content: message,
      meta: { source: "support" },
    });

    await updateConversation(client, conversationId, {
      status: "pending_admin",
      last_message_preview: buildPreview(message),
      last_message_at: supportUserMessage.created_at,
      last_user_read_at: supportUserMessage.created_at,
    });

    await client.query("COMMIT");

    const payloadData = await getConversationPayload(client, conversationId, "user");
    emitSupportConversationChanged(user.id, {
      conversationId,
      type: "support",
      userId: Number(user.id),
    });
    return payloadData;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const listSupportConversations = async (params = {}) => {
  const {
    page = 1,
    limit = 20,
    search,
    status,
  } = params;

  if (status) {
    ensureSupportStatus(status);
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
  const offset = (pageNum - 1) * limitNum;

  const conditions = ["c.type = 'support'", "c.last_message_at IS NOT NULL"];
  const values = [];
  let index = 1;

  if (search) {
    conditions.push(`(
      u.full_name ILIKE $${index}
      OR u.email ILIKE $${index}
      OR COALESCE(u.phone, '') ILIKE $${index}
      OR CAST(u.id AS TEXT) ILIKE $${index}
    )`);
    values.push(`%${search}%`);
    index += 1;
  }

  if (status) {
    conditions.push(`c.status = $${index}`);
    values.push(status);
    index += 1;
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await pool.query(
    `
    SELECT COUNT(*) AS total
    FROM chat_conversations c
    JOIN users u
      ON u.id = c.user_id
    ${whereClause}
    `,
    values
  );

  const dataResult = await pool.query(
    `
    SELECT
      c.id,
      c.user_id,
      c.type,
      c.status,
      c.assigned_admin_id,
      c.last_message_preview,
      c.last_message_at,
      c.last_user_read_at,
      c.last_admin_read_at,
      c.created_at,
      c.updated_at,
      u.full_name AS user_full_name,
      u.email AS user_email,
      u.phone AS user_phone,
      admin_u.full_name AS assigned_admin_full_name,
      admin_u.email AS assigned_admin_email,
      COALESCE((
        SELECT COUNT(*)
        FROM chat_messages m
        WHERE m.conversation_id = c.id
          AND m.sender_role = 'user'
          AND m.created_at > COALESCE(c.last_admin_read_at, TO_TIMESTAMP(0))
      ), 0) AS unread_count
    FROM chat_conversations c
    JOIN users u
      ON u.id = c.user_id
    LEFT JOIN users admin_u
      ON admin_u.id = c.assigned_admin_id
    ${whereClause}
    ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
    LIMIT $${index} OFFSET $${index + 1}
    `,
    [...values, limitNum, offset]
  );

  const total = Number(countResult.rows[0]?.total || 0);

  return {
    data: dataResult.rows.map((row) => mapConversation(row)),
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.max(1, Math.ceil(total / limitNum)),
    },
  };
};

const getSupportConversationForAdmin = async (conversationId, adminUser) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const conversation = await getConversationDetailById(client, conversationId, "admin");

    if (!conversation || conversation.type !== "support") {
      throw new Error("Không tìm thấy hội thoại hỗ trợ");
    }

    await updateConversation(client, conversationId, {
      assigned_admin_id: adminUser.id,
      last_admin_read_at: new Date(),
    });

    await client.query("COMMIT");

    const payloadData = await getConversationPayload(client, conversationId, "admin");
    emitSupportConversationChanged(conversation.user_id, {
      conversationId: Number(conversationId),
      type: "support",
      userId: Number(conversation.user_id),
    });
    return payloadData;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const replySupportConversation = async (conversationId, adminUser, payload = {}) => {
  const message = requireMessage(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const conversation = await getConversationDetailById(client, conversationId, "admin");

    if (!conversation || conversation.type !== "support") {
      throw new Error("Không tìm thấy hội thoại hỗ trợ");
    }

    const adminMessage = await insertMessage(client, {
      conversationId,
      senderId: adminUser.id,
      senderRole: "admin",
      content: message,
      meta: { source: "admin_reply" },
    });

    await updateConversation(client, conversationId, {
      assigned_admin_id: adminUser.id,
      status: "pending_user",
      last_message_preview: buildPreview(message),
      last_message_at: adminMessage.created_at,
      last_admin_read_at: adminMessage.created_at,
    });

    await client.query("COMMIT");

    return getConversationPayload(client, conversationId, "admin");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const updateSupportConversationStatus = async (conversationId, status, adminUser) => {
  ensureSupportStatus(status);

  const client = await pool.connect();

  try {
    const conversation = await getConversationDetailById(client, conversationId, "admin");

    if (!conversation || conversation.type !== "support") {
      throw new Error("Không tìm thấy hội thoại hỗ trợ");
    }

    await updateConversation(client, conversationId, {
      status,
      assigned_admin_id: adminUser.id,
      last_admin_read_at: new Date(),
    });

    const payloadData = await getConversationPayload(client, conversationId, "admin");
    emitSupportConversationChanged(conversation.user_id, {
      conversationId: Number(conversationId),
      type: "support",
      userId: Number(conversation.user_id),
    });
    return payloadData;
  } finally {
    client.release();
  }
};

module.exports = {
  getConversationByType,
  sendAiMessage,
  sendSupportMessage,
  listSupportConversations,
  getSupportConversationForAdmin,
  replySupportConversation,
  updateSupportConversationStatus,
};
