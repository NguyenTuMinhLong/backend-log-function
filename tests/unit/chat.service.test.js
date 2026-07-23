const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const servicePath = path.resolve(__dirname, "../../src/services/chat.service.js");
const dbPath = path.resolve(__dirname, "../../src/config/db.js");
const adminChatServicePath = path.resolve(__dirname, "../../src/services/admin.chat.service.js");
const socketPath = path.resolve(__dirname, "../../src/socket.js");

function loadChatService(poolOverride) {
  delete require.cache[servicePath];
  delete require.cache[dbPath];
  delete require.cache[adminChatServicePath];
  delete require.cache[socketPath];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports:
      poolOverride ||
      {
        connect: async () => {
          throw new Error("db.connect should not be called in chat.service unit tests");
        },
        query: async () => {
          throw new Error("db.query should not be called in chat.service unit tests");
        },
      },
  };

  require.cache[adminChatServicePath] = {
    id: adminChatServicePath,
    filename: adminChatServicePath,
    loaded: true,
    exports: {
      chat: async () => {
        throw new Error("assistant chat should not be called in chat.service unit tests");
      },
    },
  };

  require.cache[socketPath] = {
    id: socketPath,
    filename: socketPath,
    loaded: true,
    exports: {
      emitAiConversationChanged: () => {},
      emitSupportConversationChanged: () => {},
    },
  };

  return require(servicePath);
}

test("parseOutgoingMessage: cho phep gui attachment ma khong can text", () => {
  const chatService = loadChatService();
  const { parseOutgoingMessage } = chatService.__test;

  const result = parseOutgoingMessage(
    {
      attachments: [
        {
          type: "image",
          name: "ve-may-bay.jpg",
          mime_type: "image/jpeg",
          size: 12345,
          data_url: "data:image/jpeg;base64,ZmFrZQ==",
        },
      ],
    },
    { allowAttachments: true }
  );

  assert.equal(result.message, "");
  assert.equal(result.attachments.length, 1);
  assert.equal(result.preview, "[Hinh anh] ve-may-bay.jpg");
});

test("parseOutgoingMessage: chan attachment neu kenh khong ho tro", () => {
  const chatService = loadChatService();
  const { parseOutgoingMessage } = chatService.__test;

  assert.throws(
    () =>
      parseOutgoingMessage(
        {
          attachments: [
            {
              type: "file",
              name: "ticket.pdf",
              mime_type: "application/pdf",
              size: 2048,
              data_url: "data:application/pdf;base64,ZmFrZQ==",
            },
          ],
        },
        { allowAttachments: false }
      ),
    /Kenh nay chi ho tro gui tin nhan van ban/
  );
});

test("buildAttachmentPreview: tra ve preview tong hop cho nhieu tep", () => {
  const chatService = loadChatService();
  const { buildAttachmentPreview } = chatService.__test;

  const preview = buildAttachmentPreview([
    { type: "sticker", name: "smile.svg" },
    { type: "file", name: "ticket.pdf" },
  ]);

  assert.equal(preview, "[2 tep dinh kem]");
});

test("getConversationByType: doi xong payload roi moi release client", async () => {
  const events = [];
  let releaseCount = 0;

  const client = {
    query: async (sql) => {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      events.push(`query:${normalized.slice(0, 48)}`);

      if (normalized.startsWith("SELECT id FROM chat_conversations")) {
        return { rows: [{ id: 77 }] };
      }

      if (normalized.startsWith("SELECT c.id,")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push("detail:done");
        return {
          rows: [
            {
              id: 77,
              user_id: null,
              guest_session_id: "guest_demo_session_123",
              guest_name: "Khach TEST",
              type: "ai",
              status: "open",
              assigned_admin_id: null,
              last_message_preview: "Xin chao",
              last_message_at: "2026-04-23T10:00:00.000Z",
              last_user_read_at: null,
              last_admin_read_at: null,
              created_at: "2026-04-23T10:00:00.000Z",
              updated_at: "2026-04-23T10:00:00.000Z",
              user_full_name: null,
              user_email: null,
              user_phone: null,
              assigned_admin_full_name: null,
              assigned_admin_email: null,
              unread_count: 0,
            },
          ],
        };
      }

      if (normalized.startsWith("SELECT * FROM ( SELECT m.id,")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push("messages:done");
        return {
          rows: [
            {
              id: 5,
              conversation_id: 77,
              sender_id: null,
              sender_role: "user",
              sender_name: "Khach TEST",
              content: "Xin chao",
              meta: {},
              created_at: "2026-04-23T10:00:00.000Z",
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${normalized}`);
    },
    release: () => {
      releaseCount += 1;
      events.push("release");
    },
  };

  const poolMock = {
    connect: async () => client,
    query: async () => {
      throw new Error("pool.query should not be called in getConversationByType test");
    },
  };

  const chatService = loadChatService(poolMock);

  const result = await chatService.getConversationByType(
    null,
    "ai",
    { guestSessionId: "guest_demo_session_123" }
  );

  assert.equal(releaseCount, 1);
  assert.deepEqual(result.messages.map((message) => message.content), ["Xin chao"]);
  assert.ok(events.indexOf("detail:done") < events.indexOf("release"));
  assert.ok(events.indexOf("messages:done") < events.indexOf("release"));
});
