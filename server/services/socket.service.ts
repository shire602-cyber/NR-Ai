import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { getEnv, isProduction } from '../config/env';
import { storage } from '../storage';
import { createLogger } from '../config/logger';
import type { InsertNotification, Notification } from '../../shared/schema';

const log = createLogger('socket');

let io: SocketServer | null = null;

function buildAllowedOrigins(): string[] {
  const env = getEnv();
  const origins: string[] = [];

  if (env.FRONTEND_URL) origins.push(env.FRONTEND_URL);

  const extra = process.env.CORS_ORIGIN;
  if (extra) origins.push(...extra.split(',').map((s) => s.trim()).filter(Boolean));

  if (!isProduction()) {
    origins.push(
      'http://localhost:5173',
      'http://localhost:5000',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5000',
      'http://127.0.0.1:3000',
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
        log.warn({ origin }, 'Blocked Socket.io connection from unauthorized origin');
        callback(new Error('Not allowed by CORS'), false);
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io',
  });

  io.use(async (socket, next) => {
    const rawToken =
      (socket.handshake.auth as Record<string, string>).token ||
      socket.handshake.headers.authorization?.replace('Bearer ', '');

    if (!rawToken) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(rawToken, getEnv().JWT_SECRET) as { userId: string };
      const user = await storage.getUser(decoded.userId);
      if (!user) {
        return next(new Error('User not found'));
      }
      socket.data.userId = user.id;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);
    log.debug({ userId }, 'WebSocket client connected');

    socket.on('disconnect', () => {
      log.debug({ userId }, 'WebSocket client disconnected');
    });
  });

  log.info('Socket.io server initialized');
  return io;
}

export function getIO(): SocketServer | null {
  return io;
}

export async function createAndEmitNotification(
  data: InsertNotification
): Promise<Notification> {
  const notification = await storage.createNotification(data);
  io?.to(`user:${data.userId}`).emit('notification:new', notification);
  return notification;
}
