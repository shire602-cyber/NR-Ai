import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const state = vi.hoisted(() => ({
  contact: { id: "contact-1", companyId: "company-2", name: "Acme" },
  hasAccess: false,
  tokenSet: false,
}));

vi.mock("../../server/middleware/auth", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", email: "user@example.com", isAdmin: false, userType: "customer" };
    next();
  },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getCustomerContact: vi.fn(async () => state.contact),
    hasCompanyAccess: vi.fn(async () => state.hasAccess),
    setPortalAccessToken: vi.fn(async () => {
      state.tokenSet = true;
      return state.contact;
    }),
  },
}));

import { registerPortalPublicRoutes } from "../../server/routes/portal.public.routes";

function appWithRoutes() {
  const app = express();
  app.use(express.json());
  registerPortalPublicRoutes(app);
  return app;
}

async function post(app: express.Express, body: unknown): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/portal/generate-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("portal access generation tenant isolation", () => {
  beforeEach(() => {
    state.hasAccess = false;
    state.tokenSet = false;
  });

  it("does not mint a portal token for a contact outside the user tenant", async () => {
    const res = await post(appWithRoutes(), { contactId: "contact-1" });

    expect(res.status).toBe(403);
    expect(state.tokenSet).toBe(false);
  });

  it("mints a portal token only after company access is proven", async () => {
    state.hasAccess = true;

    const res = await post(appWithRoutes(), { contactId: "contact-1" });

    expect(res.status).toBe(200);
    expect(res.body.portalUrl).toMatch(/^\/portal\//);
    expect(state.tokenSet).toBe(true);
  });
});
