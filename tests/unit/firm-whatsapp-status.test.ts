/**
 * R15-08: the WhatsApp status endpoints must not claim a connection or
 * delivery that does not exist. No provider is connected; messages are
 * WhatsApp Web drafts that staff send by hand and the server only logs them.
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";

const authState = vi.hoisted(() => ({
  user: {
    id: "user-1",
    email: "staff@example.com",
    isAdmin: false,
    firmRole: "firm_owner" as string | null,
    userType: "customer",
  },
}));

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = authState.user;
    next();
  },
}));
vi.mock("../../server/db", () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() } }));
vi.mock("../../server/storage", () => ({
  storage: { getCompaniesByUserId: vi.fn(async () => [{ id: "company-1" }]) },
}));

import {
  personalWhatsAppStatusPayload,
  registerWhatsAppRoutes,
} from "../../server/routes/whatsapp.routes";

async function get(path: string) {
  const app = express();
  app.use(express.json());
  registerWhatsAppRoutes(app);
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe("[R15-08] WhatsApp status truthfulness", () => {
  it("never reports connected while delivery is logged_only", () => {
    const p = personalWhatsAppStatusPayload();
    expect(p.deliveryStatus).toBe("logged_only");
    expect(p.connected).toBe(false);
    expect(p.providerConnected).toBe(false);
    expect(p.canSend).toBe(false);
    expect(p.capability).toBe("requires_external");
    expect(p.note.en).toMatch(/No WhatsApp provider is connected/);
    expect(p.note.ar.length).toBeGreaterThan(10);
  });

  it("serves the same truthful payload on both status URLs to NR staff", async () => {
    authState.user.firmRole = "firm_owner";
    const a = await get("/api/integrations/whatsapp/status");
    const b = await get("/api/whatsapp/status");
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(a.body.connected).toBe(false);
  });

  it("stays NR-only: a user without an NR firm role is rejected", async () => {
    authState.user.firmRole = null;
    expect((await get("/api/whatsapp/status")).status).toBe(403);
    authState.user.firmRole = "firm_owner";
  });
});
