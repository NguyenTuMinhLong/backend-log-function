const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const { loadUserAuthState } = require("./middlewares/auth.middleware");

let io = null;

const sanitizeGuestSessionId = (value) => {
  const guestSessionId = String(value || "").trim();

  if (!guestSessionId) {
    return "";
  }

  if (!/^[a-zA-Z0-9_-]{12,120}$/.test(guestSessionId)) {
    throw new Error("Invalid guest session");
  }

  return guestSessionId;
};

const getRoomForActor = (actor = {}) => {
  if (actor.userId) {
    return `user:${Number(actor.userId)}`;
  }

  if (actor.guestSessionId) {
    return `guest:${actor.guestSessionId}`;
  }

  return "";
};

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

      if (rawToken) {
        const token = String(rawToken).startsWith("Bearer ")
          ? String(rawToken).slice(7)
          : String(rawToken);

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { user, reason } = await loadUserAuthState(decoded.id);

        if (!user) {
          return next(new Error(reason || "Unauthorized"));
        }

        socket.user = user;
        socket.actor = { userId: Number(user.id), guestSessionId: null };
        return next();
      }

      const guestSessionId = sanitizeGuestSessionId(
        socket.handshake.auth?.guestSessionId || socket.handshake.query?.guestSessionId
      );

      if (!guestSessionId) {
        return next(new Error("Unauthorized"));
      }

      socket.user = null;
      socket.actor = { userId: null, guestSessionId };
      return next();
    } catch (_error) {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const room = getRoomForActor(socket.actor);

    if (room) {
      socket.join(room);
    }

    if (socket.user?.role === "admin") {
      socket.join("admins");
    }
  });

  return io;
};

const getIO = () => io;

const emitAiConversationChanged = (actor, payload = {}) => {
  if (!io) {
    return;
  }

  const room = getRoomForActor(actor);
  if (!room) {
    return;
  }

  io.to(room).emit("chat:ai_updated", payload);
};

const emitSupportConversationChanged = (actor, payload = {}) => {
  if (!io) {
    return;
  }

  const room = getRoomForActor(actor);
  if (room) {
    io.to(room).emit("chat:support_updated", payload);
  }
  io.to("admins").emit("admin:support_updated", payload);
};

module.exports = {
  initSocketServer,
  getIO,
  emitAiConversationChanged,
  emitSupportConversationChanged,
};
