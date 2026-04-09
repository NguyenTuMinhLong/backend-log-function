const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const { loadUserAuthState } = require("./middlewares/auth.middleware");

let io = null;

const initSocketServer = (server) => {
  io = new Server(server, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const rawToken =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization ||
        socket.handshake.query?.token;

      if (!rawToken) {
        return next(new Error("Unauthorized"));
      }

      const token = String(rawToken).startsWith("Bearer ")
        ? String(rawToken).slice(7)
        : String(rawToken);

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const { user, reason } = await loadUserAuthState(decoded.id);

      if (!user) {
        return next(new Error(reason || "Unauthorized"));
      }

      socket.user = user;
      return next();
    } catch (_error) {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId = Number(socket.user.id);

    socket.join(`user:${userId}`);

    if (socket.user.role === "admin") {
      socket.join("admins");
    }
  });

  return io;
};

const getIO = () => io;

const emitAiConversationChanged = (userId, payload = {}) => {
  if (!io) {
    return;
  }

  io.to(`user:${Number(userId)}`).emit("chat:ai_updated", payload);
};

const emitSupportConversationChanged = (userId, payload = {}) => {
  if (!io) {
    return;
  }

  io.to(`user:${Number(userId)}`).emit("chat:support_updated", payload);
  io.to("admins").emit("admin:support_updated", payload);
};

module.exports = {
  initSocketServer,
  getIO,
  emitAiConversationChanged,
  emitSupportConversationChanged,
};
