import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const authState = vi.hoisted(() => ({
  user: {
    id: "user-1",
    email: "user@example.com",
    isAdmin: false,
    firmRole: "firm_owner",
    userType: "customer",
  },
}));

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = authState.user;
    next();
  },
}));

vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getCompaniesByUserId: vi.fn(async () => [{ id: "company-1", name: "Company" }]),
  },
}));

import { registerWhatsAppRoutes } from "../../server/routes/whatsapp.routes";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerWhatsAppRoutes(app);
  return app;
}

async function get(app: express.Express, path: string): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("WhatsApp status routes", () => {
  beforeEach(() => {
    authState.user = {
      id: "user-1",
      email: "user@example.com",
      isAdmin: false,
      firmRole: "firm_owner",
      userType: "customer",
    };
  });

  it("keeps the legacy status URL aligned with the canonical integration URL for NR firm staff", async () => {
    const app = appWithRoutes();

    const canonical = await get(app, "/api/integrations/whatsapp/status");
    const legacy = await get(app, "/api/whatsapp/status");

    expect(canonical.status).toBe(200);
    expect(legacy.status).toBe(200);
    expect(legacy.body).toEqual(canonical.body);
    expect(legacy.body.deliveryStatus).toBe("logged_only");
  });

  it("rejects regular SaaS customers from WhatsApp status routes", async () => {
    authState.user = {
      id: "user-2",
      email: "customer@example.com",
      isAdmin: false,
      firmRole: null as any,
      userType: "customer",
    };
    const app = appWithRoutes();

    const canonical = await get(app, "/api/integrations/whatsapp/status");
    const legacy = await get(app, "/api/whatsapp/status");

    expect(canonical.status).toBe(403);
    expect(legacy.status).toBe(403);
    expect(canonical.body.message).toBe("NRA firm staff access required");
    expect(legacy.body.message).toBe("NRA firm staff access required");
  });
});
