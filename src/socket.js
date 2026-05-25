const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const { loadUserAuthState } = require("./middlewares/auth.middleware");

// THÊM MỚI: import hàm tính vị trí máy bay
const { getFlightPosition } = require("./services/flight.service");

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
        socket.handshake.auth?.guestSessionId ||
          socket.handshake.query?.guestSessionId
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

    // THÊM MỚI: Flight Tracker events
    // Khi user mở trang FlightTracker → frontend gửi event "flight:join"
    // Server sẽ cho socket join vào room riêng "flight:{id}"
    // Mục đích: nhiều user cùng xem 1 chuyến bay → server broadcast 1 lần cho cả room
    socket.on("flight:join", async ({ flightId }) => {
      // Bỏ qua nếu flightId không hợp lệ
      if (!flightId || isNaN(Number(flightId))) return;

      // Join vào room riêng của chuyến bay này
      // VD: "flight:76" — tất cả user xem flight 76 đều ở room này
      socket.join(`flight:${flightId}`);

      // Gửi vị trí hiện tại ngay lập tức khi user vừa vào
      // Để user thấy vị trí máy bay ngay, không cần chờ 30 giây
      try {
        const position = await getFlightPosition(Number(flightId));
        socket.emit("flight:updated", position);
      } catch (err) {
        socket.emit("flight:error", { message: err.message });
      }
    });

    // THÊM MỚI: Khi user rời trang FlightTracker
    // Frontend gửi event "flight:leave" → server cho socket rời room
    // Mục đích: tránh broadcast cho socket đã không còn xem nữa
    socket.on("flight:leave", ({ flightId }) => {
      socket.leave(`flight:${flightId}`);
    });
  });

  // THÊM MỚI: Broadcast vị trí máy bay mỗi 30 giây
  // Chạy liên tục — duyệt qua tất cả room đang có người xem
  // Chỉ broadcast room nào có tên bắt đầu bằng "flight:"
  setInterval(async () => {
    const rooms = io.sockets.adapter.rooms;

    for (const [roomName] of rooms) {
      // Bỏ qua các room không phải flight tracker
      // VD: "user:1", "admins", "guest:abc" → bỏ qua
      if (!roomName.startsWith("flight:")) continue;

      // Lấy flight ID từ tên room. VD: "flight:76" → 76
      const flightId = roomName.split(":")[1];

      // Chỉ broadcast nếu room có ít nhất 1 người đang xem
      const roomSize = rooms.get(roomName)?.size || 0;
      if (roomSize === 0) continue;

      try {
        // Tính vị trí mới và broadcast cho tất cả user trong room
        const position = await getFlightPosition(Number(flightId));
        io.to(roomName).emit("flight:updated", position);
      } catch (err) {
        console.error(`[FlightTracker] ${roomName}:`, err.message);
      }
    }
  }, 100); // 100ms

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

// Dùng cho sự kiện admin đọc/mở hội thoại — chỉ thông báo user, KHÔNG broadcast admins
// Tránh vòng lặp: admin mở → socket → admin reload → admin mở → ...
const emitSupportReadByAdmin = (actor, payload = {}) => {
  if (!io) return;
  const room = getRoomForActor(actor);
  if (room) {
    io.to(room).emit("chat:support_updated", payload);
  }
};

module.exports = {
  initSocketServer,
  getIO,
  emitAiConversationChanged,
  emitSupportConversationChanged,
  emitSupportReadByAdmin,

  // THÊM MỚI: Hàm broadcast thủ công cho 1 chuyến bay cụ thể
  // Dùng khi admin cập nhật status chuyến bay → push realtime cho user đang xem
  broadcastFlightPosition: async (flightId) => {
    if (!io) return;
    try {
      const position = await getFlightPosition(Number(flightId));
      io.to(`flight:${flightId}`).emit("flight:updated", position);
    } catch (err) {
      console.error("[broadcastFlightPosition]", err.message);
    }
  },
};