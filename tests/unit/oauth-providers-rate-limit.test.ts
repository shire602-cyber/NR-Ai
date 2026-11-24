import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Behaviour test: the real security middleware in front of stub OAuth routes.
// The providers list fires on every login/register page load and must never
// consume the (action) OAuth budget; start/callback keep their limit.
let server: import("node:http").Server;
let base = "";

beforeAll(async () => {
  process.env.RL_AUTH_OAUTH_MAX = "3";
  vi.resetModules();
  const { applySecurityMiddleware } = await import("../../server/middleware/security");
  const app = express();
  applySecurityMiddleware(app);
  app.get("/api/auth/oauth/providers", (_req, res) => res.json({ providers: [] }));
  app.get("/api/auth/oauth/google", (_req, res) => res.json({ ok: true }));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  delete process.env.RL_AUTH_OAUTH_MAX;
  server?.close();
});

describe("/api/auth/oauth rate limiting", () => {
  it("never rate-limits the read-only providers list", async () => {
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${base}/api/auth/oauth/providers`);
      expect(res.status).toBe(200);
    }
  });

  it("still limits the OAuth start route", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await fetch(`${base}/api/auth/oauth/google`)).status);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses).toContain(429);
  });
});
