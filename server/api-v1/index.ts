import type { Express } from "express";
import { buildV1Router, dispatchMiddleware } from "./routes";

/**
 * Mount order matters: the v1 router first (it answers reads itself and hands
 * writes/reports to next("router")), then the dispatcher that rewrites the
 * request so the rest of the app serves it.
 */
export function registerApiV1(app: Express): void {
  app.use("/api/v1", buildV1Router());
  app.use(dispatchMiddleware);
}
