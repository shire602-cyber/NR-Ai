import { Server as SocketServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { getEnv, isProduction } from "../config/env";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { verifyAccessJwt } from "../middleware/auth";
import { isSessionActive } from "./sessions";
import type { InsertNotification, Notification } from "../../shared/schema";

const log = createLogger("socket");

let io: SocketServer | null = null;

function buildAllowedOrigins(): string[] {
  const env = getEnv();
  const origins: string[] = [];

  if (env.FRONTEND_URL) origins.push(env.FRONTEND_URL);

  const extra = process.env.CORS_ORIGIN;
  if (extra)
    origins.push(
      ...extra
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );

  if (!isProduction()) {
    origins.push(
      "http://localhost:5173",
      "http://localhost:5000",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5000",
      "http://127.0.0.1:3000"
    );
  }

  return origins;
}

export function initSocketServer(httpServer: HttpServer): SocketServer {
  const allowedOrigins = buildAllowedOrigins();

  io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        log.warn({ origin }, "Blocked Socket.io connection from unauthorized origin");
        callback(new Error("Not allowed by CORS"), false);
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/socket.io",
  });

  io.use(async (socket, next) => {
    const rawToken =
      (socket.handshake.auth as Record<string, string>).token ||
      socket.handshake.headers.authorization?.replace("Bearer ", "");

    if (!rawToken) {
      return next(new Error("Authentication required"));
    }

    try {
      // Access tokens only (a refresh token must not open a socket), and a
      // revoked session loses its sockets' next connection too.
      const decoded = verifyAccessJwt(rawToken);
      // A token confined to 2FA enrolment must not open a live data channel.
      if (decoded.scope === "2fa_enrol") return next(new Error("Two-factor enrolment required"));
      if (decoded.sid && !(await isSessionActive(decoded.sid))) {
        return next(new Error("Session revoked"));
      }
      const user = await storage.getUser(decoded.userId);
      if (!user || user.isActive === false) {
        return next(new Error("User not found"));
      }
      socket.data.userId = user.id;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);
    log.debug({ userId }, "WebSocket client connected");

    socket.on("disconnect", () => {
      log.debug({ userId }, "WebSocket client disconnected");
    });
  });

  log.info("Socket.io server initialized");
  return io;
}

export function getIO(): SocketServer | null {
  return io;
}

export async function createAndEmitNotification(data: InsertNotification): Promise<Notification> {
  const notification = await storage.createNotification(data);
  io?.to(`user:${data.userId}`).emit("notification:new", notification);
  return notification;
}
