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
    if (!/^\/api(?:[/?]|$)/i.test(path) && path !== "/health") return;

    // Express's route template is registered by the server. Raw paths and
    // query strings can contain share tokens, account IDs or arbitrary text.
    const route = typeof req.route?.path === "string" ? req.route.path : undefined;
    const logData = {
      requestId: req.id,
      method: req.method,
      route,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    };

    const msg = `${req.method} ${res.statusCode} in ${duration}ms`;
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
