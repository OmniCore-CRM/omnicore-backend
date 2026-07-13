import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import jwt from "jsonwebtoken";
import { ConversationChannel } from "@prisma/client";
import { env } from "@/config/env.js";
import { prisma } from "@/config/db.js";
import type { WidgetSessionPayload } from "@/modules/widget/widget.session.js";

interface SocketUser {
  userId: string;
  companyId: string;
  role: string;
  sessionId: string;
}

type AgentSocketData = SocketUser & {
  authType: "agent";
};

type WidgetSocketData = WidgetSessionPayload & {
  authType: "widget";
};

type SocketData = AgentSocketData | WidgetSocketData;

let io: SocketIOServer;

const normalizeDomain = (domain: string) => {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) return "";

  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`
    );
    return url.host;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
};

const originToDomain = (origin: string | undefined) => {
  if (!origin) return "";

  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return normalizeDomain(origin);
  }
};

export const initializeSocketServer = (httpServer: HTTPServer) => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.SOCKET_ORIGINS,
    },
  });

  // Verify JWT before allowing any socket connection.
  // Token is provided by the frontend SocketProvider via socket.handshake.auth.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const decoded = jwt.verify(
        token,
        env.JWT_SECRET
      ) as Partial<SocketUser & WidgetSessionPayload>;

      if (decoded.tokenType === "widget_session") {
        if (
          !decoded.companyId ||
          !decoded.widgetInstallationId ||
          !decoded.conversationId ||
          !decoded.customerId
        ) {
          return next(new Error("Invalid widget session token"));
        }

        const installation = await prisma.widgetInstallation.findFirst({
          where: {
            id: decoded.widgetInstallationId,
            companyId: decoded.companyId,
            enabled: true,
          },
          select: {
            allowedDomains: true,
          },
        });
        const requestDomain = originToDomain(
          socket.handshake.headers.origin
        );

        if (
          !installation ||
          !requestDomain ||
          !installation.allowedDomains
            .map(normalizeDomain)
            .includes(requestDomain)
        ) {
          return next(new Error("Widget is not available"));
        }

        const conversation = await prisma.conversation.findFirst({
          where: {
            id: decoded.conversationId,
            companyId: decoded.companyId,
            customerId: decoded.customerId,
            channel: ConversationChannel.WEBSITE,
          },
          select: { id: true },
        });

        if (!conversation) {
          return next(new Error("Widget is not available"));
        }

        socket.data.authType = "widget";
        socket.data.companyId = decoded.companyId;
        socket.data.widgetInstallationId =
          decoded.widgetInstallationId;
        socket.data.conversationId = decoded.conversationId;
        socket.data.customerId = decoded.customerId;

        return next();
      }

      if (!decoded.userId || !decoded.companyId || !decoded.role || !decoded.sessionId) {
        return next(new Error("Invalid token"));
      }

      const session = await prisma.authSession.findFirst({
        where: {
          id: decoded.sessionId,
          userId: decoded.userId,
          companyId: decoded.companyId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: {
          user: {
            select: {
              id: true,
              companyId: true,
              role: true,
              isActive: true,
              company: { select: { id: true, isActive: true } },
            },
          },
        },
      });

      if (!session?.user.isActive || !session.user.company.isActive) {
        return next(new Error("Invalid or expired token"));
      }

      socket.data.authType = "agent";
      socket.data.userId = session.user.id;
      socket.data.companyId = session.user.companyId;
      socket.data.role = session.user.role;
      socket.data.sessionId = session.id;

      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const socketData = socket.data as SocketData;
    const { companyId } = socketData;

    if (socketData.authType === "agent") {
      // Agent sockets receive tenant-scoped broadcasts through their company room.
      void socket.join(`company:${companyId}`);
      void socket.join(`user:${socketData.userId}`);
      void socket.join(`session:${socketData.sessionId}`);
    }

    const socketEventBuckets = new Map<
      string,
      { count: number; resetAt: number }
    >();

    const allowSocketEvent = (key: string, max: number, windowMs: number) => {
      const now = Date.now();
      const current = socketEventBuckets.get(key);

      if (!current || current.resetAt <= now) {
        socketEventBuckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }

      current.count += 1;
      return current.count <= max;
    };

    const isSafeConversationId = (
      conversationId: unknown
    ): conversationId is string =>
      typeof conversationId === "string" &&
      conversationId.trim().length > 0 &&
      conversationId.length <= 128;

    const isAuthorizedConversation = async (conversationId: unknown) => {
      if (!isSafeConversationId(conversationId)) {
        return false;
      }

      if (
        socketData.authType === "widget" &&
        socketData.conversationId !== conversationId
      ) {
        return false;
      }

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          companyId,
          ...(socketData.authType === "widget"
            ? {
                customerId: socketData.customerId,
                channel: ConversationChannel.WEBSITE,
              }
            : {}),
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
        if (
          !allowSocketEvent("join_conversation", 30, 60 * 1000) ||
          !(await isAuthorizedConversation(conversationId))
        ) {
          emitRoomAuthorizationError();
          return;
        }

        await socket.join(`conversation:${conversationId}`);
      })();
    });

    socket.on("leave_conversation", (conversationId: string) => {
      if (isSafeConversationId(conversationId)) {
        void socket.leave(`conversation:${conversationId}`);
      }
    });

    // Forward typing indicators to other participants in the same conversation room.
    socket.on("typing:start", (payload: { conversationId: string }) => {
      void (async () => {
        const conversationId = payload?.conversationId;

        if (
          !allowSocketEvent("typing:start", 60, 60 * 1000) ||
          !(await isAuthorizedConversation(conversationId))
        ) {
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

        if (
          !allowSocketEvent("typing:stop", 60, 60 * 1000) ||
          !(await isAuthorizedConversation(conversationId))
        ) {
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

export const disconnectSessionSockets = (sessionId: string) => {
  if (!io) return;
  io.in(`session:${sessionId}`).disconnectSockets(true);
};

export const disconnectUserSockets = (userId: string) => {
  if (!io) return;
  io.in(`user:${userId}`).disconnectSockets(true);
};
