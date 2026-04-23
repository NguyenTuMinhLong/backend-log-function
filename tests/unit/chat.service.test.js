const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const servicePath = path.resolve(__dirname, "../../src/services/chat.service.js");
const dbPath = path.resolve(__dirname, "../../src/config/db.js");
const adminChatServicePath = path.resolve(__dirname, "../../src/services/admin.chat.service.js");
const socketPath = path.resolve(__dirname, "../../src/socket.js");

function loadChatService() {
  delete require.cache[servicePath];
  delete require.cache[dbPath];
  delete require.cache[adminChatServicePath];
  delete require.cache[socketPath];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
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
