import type { Request, Response, NextFunction } from "express";
import { createLogger } from "../config/logger";

const log = createLogger("http");

// Requests slower than this (ms) are flagged at warn even when successful, so
// latency outliers surface in logs/alerting without an external APM. Tunable
// via env for noisy environments.
const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS) || 2000;

/**
 * HTTP request/response logger middleware.
 * Logs method, path, status code, and duration for all /api routes.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const path = req.originalUrl || req.url;

    // Only log API requests (skip static files)
    if (!path.startsWith("/api") && path !== "/health") return;

    const logData = {
      requestId: req.id,
      method: req.method,
      path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      userId: (req as any).user?.id,
    };

    const msg = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
    if (res.statusCode >= 500) {
      log.error(logData, msg);
    } else if (res.statusCode >= 400) {
      log.warn(logData, msg);
    } else if (duration >= SLOW_REQUEST_MS) {
      log.warn({ ...logData, slow: true }, `SLOW ${msg}`);
    } else {
      log.info(logData, msg);
    }
  });

  next();
}
