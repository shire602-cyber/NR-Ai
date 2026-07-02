/**
 * Regression: the client-side error telemetry sink (/api/client-errors) must be
 * exempt from CSRF. It is a fire-and-forget 204 endpoint that has to accept
 * reports even when the app is broken and never fetched a CSRF token (e.g. a
 * chunk failed to load). If it requires CSRF, production errors are silently
 * dropped — which is exactly what happened in the live audit (403s).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";

vi.mock("../../server/config/env", () => ({
  getEnv: () => ({ NODE_ENV: "test", SESSION_SECRET: "s".repeat(32) }),
  isProduction: () => false,
}));

vi.mock("../../server/config/logger", () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { csrfProtection, csrfErrorHandler } from "../../server/middleware/csrf";

function appWithCsrf() {
  const app = express();
  app.use(express.json());
  app.use(csrfProtection);
  // Mirrors registerClientErrorRoutes: fire-and-forget 204.
  app.post("/api/client-errors", (_req, res) => res.status(204).end());
  // A normal mutating route that should stay CSRF-protected.
  app.post("/api/companies/:id/notes", (_req, res) => res.json({ ok: true }));
  app.use(csrfErrorHandler);
  return app;
}

async function postNoToken(app: express.Express, path: string) {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "boom" }),
    });
    return res.status;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

afterEach(() => vi.clearAllMocks());

describe("client-errors CSRF exemption", () => {
  it("accepts /api/client-errors POST with no CSRF token (204)", async () => {
    const status = await postNoToken(appWithCsrf(), "/api/client-errors");
    expect(status).toBe(204);
  });

  it("still blocks a normal mutating route without a CSRF token", async () => {
    // The exemption must be scoped to /api/client-errors only: any other
    // mutating route without a token is rejected (never reaches the handler,
    // so never returns 2xx).
    const status = await postNoToken(appWithCsrf(), "/api/companies/abc/notes");
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).not.toBe(204);
  });
});
