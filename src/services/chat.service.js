const pool = require("../config/db");
const assistantChatService = require("./admin.chat.service");
const {
  emitAiConversationChanged,
  emitSupportConversationChanged,
} = require("../socket");
const Q = require("../queries/chat.queries");

const CONVERSATION_TYPES = ["ai", "support"];
const SUPPORT_STATUSES   = ["open", "pending_admin", "pending_user", "resolved"];
const MESSAGE_ROLES      = ["user", "admin", "assistant", "system"];
const MESSAGE_LIMIT      = 80;

const buildPreview = (value = "") => String(value).trim().replace(/\s+/g, " ").slice(0, 160);

const requireMessage = (payload = {}) => {
  const message = String(payload.message || "").trim();
  if (!message) throw new Error("message la bat buoc");
  return message;
};

const ensureConversationType = (type) => {
  if (!CONVERSATION_TYPES.includes(type)) throw new Error(`type phai la: ${CONVERSATION_TYPES.join(", ")}`);
};

const ensureSupportStatus = (status) => {
  if (!SUPPORT_STATUSES.includes(status)) throw new Error(`status phai la: ${SUPPORT_STATUSES.join(", ")}`);
};

const sanitizeGuestSessionId = (value) => {
  const guestSessionId = String(value || "").trim();
  if (!guestSessionId) return "";
  if (!/^[a-zA-Z0-9_-]{12,120}$/.test(guestSessionId)) throw new Error("guest_session_id khong hop le");
  return guestSessionId;
};

const sanitizeGuestName = (value, guestSessionId = "") => {
  const normalized = String(value || "").trim().slice(0, 120);
  if (normalized) return normalized;
  const suffix = guestSessionId ? guestSessionId.slice(-6).toUpperCase() : "GUEST";
  return `Khach ${suffix}`;
};

const resolveActor = (user, payload = {}, reqMeta = {}) => {
  if (user?.id) {
    return {
      kind:        "user",
      userId:      Number(user.id),
      senderId:    Number(user.id),
      displayName: user.full_name || user.email || "Ban",
    };
  }

  const guestSessionId = sanitizeGuestSessionId(
    reqMeta.guestSessionId || payload.guest_session_id || payload.guestSessionId
  );
  if (!guestSessionId) throw new Error("Ban can dang nhap hoac cung cap guest session hop le");

  return {
    kind:          "guest",
    userId:        null,
    senderId:      null,
    guestSessionId,
    displayName:   sanitizeGuestName(payload.guest_name || payload.guestName, guestSessionId),
  };
};

const getActorRoom = (actor = {}) => ({
  userId:         actor.userId ? Number(actor.userId) : null,
  guestSessionId: actor.guestSessionId || null,
});

const mapConversation = (row) => {
  if (!row) return null;
  return {
    id:                   Number(row.id),
    type:                 row.type,
    status:               row.status,
    guest_session_id:     row.guest_session_id || null,
    guest_name:           row.guest_name || null,
    last_message_preview: row.last_message_preview,
    last_message_at:      row.last_message_at,
    last_user_read_at:    row.last_user_read_at,
    last_admin_read_at:   row.last_admin_read_at,
    created_at:           row.created_at,
    updated_at:           row.updated_at,
    unread_count:         row.unread_count !== undefined && row.unread_count !== null ? Number(row.unread_count) : 0,
    assigned_admin: row.assigned_admin_id
      ? { id: Number(row.assigned_admin_id), full_name: row.assigned_admin_full_name || null, email: row.assigned_admin_email || null }
      : null,
    user: row.user_id
      ? { id: Number(row.user_id), full_name: row.user_full_name, email: row.user_email, phone: row.user_phone }
      : null,
    guest: row.guest_session_id || row.guest_name
      ? { session_id: row.guest_session_id || null, name: row.guest_name || null }
      : null,
  };
};

const mapMessage = (row) => ({
  id:              Number(row.id),
  conversation_id: Number(row.conversation_id),
  sender_id:       row.sender_id ? Number(row.sender_id) : null,
  sender_role:     row.sender_role,
  sender_name:     row.sender_name,
  content:         row.content,
  meta:            row.meta || {},
  created_at:      row.created_at,
});

const getConversationLookupClause = (actor = {}, startIndex = 1) => {
  if (actor.kind === "user")  return { clause: `user_id = $${startIndex}`,         values: [actor.userId] };
  if (actor.kind === "guest") return { clause: `guest_session_id = $${startIndex}`, values: [actor.guestSessionId] };
  throw new Error("Khong xac dinh duoc actor chat");
};

const getConversationDetailById = async (client, conversationId, unreadFor = "user") => {
  const unreadRole = unreadFor === "admin" ? "user" : "admin";
  const readColumn = unreadFor === "admin" ? "last_admin_read_at" : "last_user_read_at";

  const result = await client.query(
    Q.SELECT_CONVERSATION_DETAIL(readColumn, unreadRole),
    [conversationId]
  );
  return result.rows[0] || null;
};

const getConversationByActorAndType = async (client, actor, type, unreadFor = "user") => {
  ensureConversationType(type);

  const lookup = getConversationLookupClause(actor, 1);
  const result = await client.query(
    Q.SELECT_CONVERSATION_ID_BY_ACTOR(lookup.clause, lookup.values.length + 1),
    [...lookup.values, type]
  );

  if (result.rows.length === 0) return null;
  return getConversationDetailById(client, result.rows[0].id, unreadFor);
};

const createOrGetConversation = async (client, actor, type) => {
  ensureConversationType(type);

  if (actor.kind === "user") {
    const result = await client.query(Q.INSERT_CONVERSATION_USER, [actor.userId, type]);
    return result.rows[0];
  }

  const result = await client.query(Q.INSERT_CONVERSATION_GUEST, [actor.guestSessionId, actor.displayName, type]);
  return result.rows[0];
};

const updateConversation = async (client, conversationId, updates = {}) => {
  const assignments = [];
  const values      = [];
  let   index       = 1;

  Object.entries(updates).forEach(([column, value]) => {
    if (value === undefined) return;
    assignments.push(`${column} = $${index}`);
    values.push(value);
    index += 1;
  });

  values.push(conversationId);
  const result = await client.query(Q.UPDATE_CONVERSATION(assignments, index), values);
  return result.rows[0] || null;
};

const insertMessage = async (client, { conversationId, senderId = null, senderRole, content, meta = {} }) => {
  if (!MESSAGE_ROLES.includes(senderRole)) throw new Error(`senderRole phai la: ${MESSAGE_ROLES.join(", ")}`);

  const result = await client.query(Q.INSERT_MESSAGE, [
    conversationId, senderId, senderRole, content, JSON.stringify(meta),
  ]);
  return result.rows[0];
};

const getMessagesByConversationId = async (client, conversationId, limit = MESSAGE_LIMIT) => {
  const result = await client.query(Q.SELECT_MESSAGES_BY_CONVERSATION, [conversationId, limit]);
  return result.rows.map(mapMessage);
};

const buildAiHistory = async (client, conversationId, maxHistory = 8) => {
  const result = await client.query(Q.SELECT_AI_HISTORY, [conversationId, maxHistory]);
  return result.rows.reverse().map((item) => ({
    role:    item.sender_role === "assistant" ? "assistant" : "user",
    content: item.content,
  }));
};

const getConversationPayload = async (client, conversationId, unreadFor = "user") => {
  const conversation = await getConversationDetailById(client, conversationId, unreadFor);
  const messages     = await getMessagesByConversationId(client, conversationId);
  return { conversation: mapConversation(conversation), messages };
};

const getConversationByType = async (user, type, options = {}) => {
  ensureConversationType(type);

  const actor  = resolveActor(user, {}, options);
  const client = await pool.connect();

  try {
    const conversation = await getConversationByActorAndType(client, actor, type, "user");
    if (!conversation) return { conversation: null, messages: [] };

    if (type === "support") {
      await updateConversation(client, conversation.id, { last_user_read_at: new Date() });
    }

    return getConversationPayload(client, conversation.id, "user");
  } finally {
    client.release();
  }
};

const sendAiMessage = async (user, payload = {}, options = {}) => {
  const message = requireMessage(payload);
  const actor   = resolveActor(user, payload, options);
  const client  = await pool.connect();

  let conversationId;
  let userMessageRow;
  let history;

  try {
    await client.query("BEGIN");

    const created = await createOrGetConversation(client, actor, "ai");
    conversationId = Number(created.id);

    userMessageRow = await insertMessage(client, {
      conversationId, senderId: actor.senderId, senderRole: "user", content: message,
      meta: { source: actor.kind, guest_session_id: actor.guestSessionId || null },
    });

    await updateConversation(client, conversationId, {
      guest_name:           actor.kind === "guest" ? actor.displayName : undefined,
      last_message_preview: buildPreview(message),
      last_message_at:      userMessageRow.created_at,
      last_user_read_at:    userMessageRow.created_at,
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
      conversationId, senderRole: "assistant", content: aiResult.reply,
      meta: {
        route: aiResult.route, reason: aiResult.reason || null,
        provider: aiResult.provider || null, provider_failures: aiResult.provider_failures || [],
        intent: aiResult.intent || null, confidence: aiResult.confidence || null,
        quick_replies: aiResult.quick_replies || [],
      },
    });

    await updateConversation(writeClient, conversationId, {
      last_message_preview: buildPreview(aiResult.reply),
      last_message_at:      assistantMessage.created_at,
      last_user_read_at:    assistantMessage.created_at,
    });

    if (aiResult.route === "admin") {
      const supportConversation = await createOrGetConversation(writeClient, actor, "support");
      supportConversationId     = Number(supportConversation.id);

      const supportUserMessage = await insertMessage(writeClient, {
        conversationId: supportConversationId, senderId: actor.senderId, senderRole: "user", content: message,
        meta: { source: "ai_escalation", reason: aiResult.reason || null, guest_session_id: actor.guestSessionId || null },
      });

      await updateConversation(writeClient, supportConversationId, {
        guest_name:           actor.kind === "guest" ? actor.displayName : undefined,
        status:               "pending_admin",
        last_message_preview: buildPreview(message),
        last_message_at:      supportUserMessage.created_at,
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
    const roomActor   = getActorRoom(actor);

    emitAiConversationChanged(roomActor, { conversationId, type: "ai", userId: roomActor.userId, guestSessionId: roomActor.guestSessionId });

    if (supportConversationId) {
      emitSupportConversationChanged(roomActor, { conversationId: supportConversationId, type: "support", userId: roomActor.userId, guestSessionId: roomActor.guestSessionId });
    }

    return {
      ...payloadData,
      route:                   aiResult.route,
      reason:                  aiResult.reason || null,
      provider:                aiResult.provider || null,
      intent:                  aiResult.intent || null,
      confidence:              aiResult.confidence || null,
      quick_replies:           aiResult.quick_replies || [],
      support_conversation_id: supportConversationId,
      should_contact_admin:    aiResult.route === "admin",
    };
  } finally {
    readClient.release();
  }
};

const sendSupportMessage = async (user, payload = {}, options = {}) => {
  const message = requireMessage(payload);
  const actor   = resolveActor(user, payload, options);
  const client  = await pool.connect();

  try {
    await client.query("BEGIN");

    const conversationRef = await createOrGetConversation(client, actor, "support");
    const conversationId  = Number(conversationRef.id);

    const supportUserMessage = await insertMessage(client, {
      conversationId, senderId: actor.senderId, senderRole: "user", content: message,
      meta: { source: "support", guest_session_id: actor.guestSessionId || null },
    });

    await updateConversation(client, conversationId, {
      guest_name:           actor.kind === "guest" ? actor.displayName : undefined,
      status:               "pending_admin",
      last_message_preview: buildPreview(message),
      last_message_at:      supportUserMessage.created_at,
      last_user_read_at:    supportUserMessage.created_at,
    });

    await client.query("COMMIT");

    const payloadData = await getConversationPayload(client, conversationId, "user");
    const roomActor   = getActorRoom(actor);

    emitSupportConversationChanged(roomActor, { conversationId, type: "support", userId: roomActor.userId, guestSessionId: roomActor.guestSessionId });

    return payloadData;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const listSupportConversations = async (params = {}) => {
  const { page = 1, limit = 20, search, status } = params;
  if (status) ensureSupportStatus(status);

  const pageNum  = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
  const offset   = (pageNum - 1) * limitNum;

  const conditions = ["c.type = 'support'", "c.last_message_at IS NOT NULL"];
  const values     = [];
  let   index      = 1;

  if (search) {
    conditions.push(`(
      COALESCE(u.full_name, '') ILIKE $${index}
      OR COALESCE(u.email, '') ILIKE $${index}
      OR COALESCE(u.phone, '') ILIKE $${index}
      OR COALESCE(c.guest_name, '') ILIKE $${index}
      OR COALESCE(c.guest_session_id, '') ILIKE $${index}
      OR CAST(COALESCE(c.user_id, c.id) AS TEXT) ILIKE $${index}
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

  const countResult = await pool.query(Q.COUNT_SUPPORT_CONVERSATIONS(whereClause), values);
  const dataResult  = await pool.query(
    Q.SELECT_SUPPORT_CONVERSATIONS(whereClause, index, index + 1),
    [...values, limitNum, offset]
  );

  const total = Number(countResult.rows[0]?.total || 0);
  return {
    data: dataResult.rows.map((row) => mapConversation(row)),
    pagination: { total, page: pageNum, limit: limitNum, total_pages: Math.max(1, Math.ceil(total / limitNum)) },
  };
};

const getSupportConversationForAdmin = async (conversationId, adminUser) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const conversation = await getConversationDetailById(client, conversationId, "admin");
    if (!conversation || conversation.type !== "support") throw new Error("Khong tim thay hoi thoai ho tro");

    await updateConversation(client, conversationId, { assigned_admin_id: adminUser.id, last_admin_read_at: new Date() });

    await client.query("COMMIT");

    const payloadData = await getConversationPayload(client, conversationId, "admin");
    emitSupportConversationChanged(
      { userId: conversation.user_id ? Number(conversation.user_id) : null, guestSessionId: conversation.guest_session_id || null },
      { conversationId: Number(conversationId), type: "support", userId: conversation.user_id ? Number(conversation.user_id) : null, guestSessionId: conversation.guest_session_id || null }
    );
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
  const client  = await pool.connect();

  try {
    await client.query("BEGIN");

    const conversation = await getConversationDetailById(client, conversationId, "admin");
    if (!conversation || conversation.type !== "support") throw new Error("Khong tim thay hoi thoai ho tro");

    const adminMessage = await insertMessage(client, {
      conversationId, senderId: adminUser.id, senderRole: "admin", content: message,
      meta: { source: "admin_reply" },
    });

    await updateConversation(client, conversationId, {
      assigned_admin_id:    adminUser.id,
      status:               "pending_user",
      last_message_preview: buildPreview(message),
      last_message_at:      adminMessage.created_at,
      last_admin_read_at:   adminMessage.created_at,
    });

    await client.query("COMMIT");
    const payloadData = await getConversationPayload(client, conversationId, "admin");
    emitSupportConversationChanged(
      { userId: conversation.user_id ? Number(conversation.user_id) : null, guestSessionId: conversation.guest_session_id || null },
      { conversationId: Number(conversationId), type: "support", userId: conversation.user_id ? Number(conversation.user_id) : null, guestSessionId: conversation.guest_session_id || null }
    );
    return payloadData;
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
    if (!conversation || conversation.type !== "support") throw new Error("Khong tim thay hoi thoai ho tro");

    await updateConversation(client, conversationId, {
      status, assigned_admin_id: adminUser.id, last_admin_read_at: new Date(),
    });

    const payloadData = await getConversationPayload(client, conversationId, "admin");
    emitSupportConversationChanged(
      { userId: conversation.user_id ? Number(conversation.user_id) : null, guestSessionId: conversation.guest_session_id || null },
      { conversationId: Number(conversationId), type: "support", userId: conversation.user_id ? Number(conversation.user_id) : null, guestSessionId: conversation.guest_session_id || null }
    );
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
