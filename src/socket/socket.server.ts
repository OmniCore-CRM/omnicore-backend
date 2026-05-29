import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import jwt from "jsonwebtoken";
import { env } from "@/config/env.js";
import { prisma } from "@/config/db.js";

interface SocketUser {
  userId: string;
  companyId: string;
  role: string;
}

let io: SocketIOServer;

export const initializeSocketServer = (httpServer: HTTPServer) => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.SOCKET_ORIGINS,
    },
  });

  // Verify JWT before allowing any socket connection.
  // Token is provided by the frontend SocketProvider via socket.handshake.auth.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as SocketUser;

      socket.data.userId = decoded.userId;
      socket.data.companyId = decoded.companyId;
      socket.data.role = decoded.role;

      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const { companyId } = socket.data as SocketUser;

    // Auto-join company room so tenant-scoped broadcasts reach this socket.
    void socket.join(`company:${companyId}`);

    const isAuthorizedConversation = async (conversationId: string) => {
      if (!conversationId) {
        return false;
      }

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          companyId,
        },
        select: {
          id: true,
        },
      });

      return Boolean(conversation);
    };

    const emitRoomAuthorizationError = () => {
      socket.emit("conversation:join_error", {
        message: "Conversation not available",
      });
    };

    socket.on("join_conversation", (conversationId: string) => {
      void (async () => {
        if (!(await isAuthorizedConversation(conversationId))) {
          emitRoomAuthorizationError();
          return;
        }

        await socket.join(`conversation:${conversationId}`);
      })();
    });

    socket.on("leave_conversation", (conversationId: string) => {
      if (conversationId) {
        void socket.leave(`conversation:${conversationId}`);
      }
    });

    // Forward typing indicators to other participants in the same conversation room.
    socket.on("typing:start", (payload: { conversationId: string }) => {
      void (async () => {
        const conversationId = payload?.conversationId;

        if (!(await isAuthorizedConversation(conversationId))) {
          return;
        }

        socket.to(`conversation:${conversationId}`).emit("typing:start", {
          conversationId,
        });
      })();
    });

    socket.on("typing:stop", (payload: { conversationId: string }) => {
      void (async () => {
        const conversationId = payload?.conversationId;

        if (!(await isAuthorizedConversation(conversationId))) {
          return;
        }

        socket.to(`conversation:${conversationId}`).emit("typing:stop", {
          conversationId,
        });
      })();
    });
  });

  return io;
};

// Access initialized socket server instance
export const getIO = () => {
  if (!io) {
    throw new Error(
      "Socket.IO server has not been initialized"
    );
  }

  return io;
};
