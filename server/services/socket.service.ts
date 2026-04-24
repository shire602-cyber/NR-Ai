import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env';
import { storage } from '../storage';
import { createLogger } from '../config/logger';
import type { InsertNotification, Notification } from '../../shared/schema';

const log = createLogger('socket');

let io: SocketServer | null = null;

export function initSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: '*',
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
