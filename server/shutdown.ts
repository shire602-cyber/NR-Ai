import type { Server as HttpServer } from 'http';
import type { Server as IoServer } from 'socket.io';
import { createLogger } from './config/logger';

const log = createLogger('shutdown');

interface ShutdownDeps {
  httpServer: HttpServer | null;
  ioServer?: IoServer | null;
  closePool: () => Promise<void>;
}

/**
 * Bound graceful shutdown for Railway / Docker zero-downtime deploys.
 *
 * Order matters:
 * 1. Stop accepting new HTTP/WS connections (server.close stops listening,
 *    in-flight requests still get to finish).
 * 2. Disconnect socket.io clients with a polite reason so the client can
 *    reconnect to the new instance instead of hanging.
 * 3. Wait for in-flight HTTP work, bounded by `httpDrainMs`.
 * 4. Drain the DB pool, bounded by `poolDrainMs`.
 * 5. Exit. Hard timeout at `hardExitMs` no matter what — orchestrators
 *    will SIGKILL us anyway, but a clean exit code is friendlier.
 */
export function installGracefulShutdown(
  deps: ShutdownDeps,
  opts: {
    httpDrainMs?: number;
    poolDrainMs?: number;
    hardExitMs?: number;
  } = {},
): (signal: string) => Promise<void> {
  const httpDrainMs = opts.httpDrainMs ?? 10_000;
  const poolDrainMs = opts.poolDrainMs ?? 10_000;
  const hardExitMs = opts.hardExitMs ?? 25_000;

  let inFlight = 0;
  let shuttingDown = false;

  // Track in-flight HTTP requests so we know when the queue is empty.
  if (deps.httpServer) {
    deps.httpServer.on('request', (_req, res) => {
      inFlight++;
      res.on('finish', () => inFlight--);
      res.on('close', () => inFlight--);
    });
  }

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      log.warn({ signal }, 'Shutdown already in progress; ignoring duplicate signal');
      return;
    }
    shuttingDown = true;
    const startedAt = Date.now();
    log.info({ signal }, 'Graceful shutdown initiated');

    // Hard exit watchdog — even if every step hangs, we always exit.
    const hardExit = setTimeout(() => {
      log.fatal({ inFlight }, 'Hard exit timeout reached; forcing process.exit(1)');
      process.exit(1);
    }, hardExitMs);
    hardExit.unref();

    // Step 1: stop listening so the load balancer takes us out of rotation.
    if (deps.httpServer) {
      log.info('Closing HTTP server (stop accepting new connections)');
      await new Promise<void>((resolve) => {
        deps.httpServer!.close(() => resolve());
        // Belt-and-suspenders: if .close hangs, we proceed anyway after drain timeout.
        setTimeout(resolve, httpDrainMs).unref();
      });
    }

    // Step 2: disconnect WebSocket clients politely.
    if (deps.ioServer) {
      try {
        log.info('Closing Socket.io server');
        await new Promise<void>((resolve) => {
          deps.ioServer!.close(() => resolve());
          setTimeout(resolve, 5_000).unref();
        });
      } catch (err) {
        log.error({ err }, 'Error closing Socket.io server');
      }
    }

    // Step 3: drain remaining in-flight HTTP work.
    if (inFlight > 0) {
      log.info({ inFlight }, 'Waiting for in-flight requests to complete');
      const drainStarted = Date.now();
      while (inFlight > 0 && Date.now() - drainStarted < httpDrainMs) {
        await new Promise((r) => setTimeout(r, 100));
      }
      log.info({ remaining: inFlight }, 'In-flight drain finished');
    }

    // Step 4: close the DB pool.
    try {
      log.info('Closing database pool');
      await Promise.race([
        deps.closePool(),
        new Promise<void>((resolve) => setTimeout(resolve, poolDrainMs).unref()),
      ]);
    } catch (err) {
      log.error({ err }, 'Error closing database pool');
    }

    log.info({ elapsedMs: Date.now() - startedAt }, 'Graceful shutdown complete');
    clearTimeout(hardExit);
    process.exit(0);
  }

  return shutdown;
}
