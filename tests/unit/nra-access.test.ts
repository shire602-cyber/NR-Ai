/**
 * Canonical NRA Center access model (shared/access.ts + middleware/rbac.ts).
 *
 * The matrix the plan requires: platform admins and firm staff get in,
 * SaaS customers and client-portal users are rejected on every NRA surface —
 * even when they guess URLs directly.
 */
import { describe, expect, it } from "vitest";
import express from "express";

import { canAccessNraCenter, hasFullNraScope, isNraFirmRole } from "../../shared/access";
import { requireNraAccess, requireFirmOwner, requireFirmRole } from "../../server/middleware/rbac";

type TestUser = {
  id: string;
  isAdmin?: boolean;
  userType?: string;
  firmRole?: string | null;
} | null;

const PERSONAS: Record<string, TestUser> = {
  anonymous: null,
  customer: { id: "u-customer", userType: "customer", isAdmin: false, firmRole: null },
  clientPortal: { id: "u-portal", userType: "client_portal", isAdmin: false, firmRole: null },
  firmAdmin: { id: "u-firmadmin", userType: "customer", isAdmin: false, firmRole: "firm_admin" },
  firmOwner: { id: "u-firmowner", userType: "customer", isAdmin: false, firmRole: "firm_owner" },
  platformAdmin: { id: "u-admin", userType: "admin", isAdmin: true, firmRole: null },
};

function appWithGuard(guard: () => express.RequestHandler, user: TestUser) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).user = user ?? undefined;
    next();
  });
  app.get("/api/firm/probe", guard(), (_req, res) => res.json({ ok: true }));
  return app;
}

async function probe(app: express.Express): Promise<number> {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (typeof addr === "string" || !addr) throw new Error("no address");
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/firm/probe`);
    return res.status;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("canAccessNraCenter (shared predicate)", () => {
  it("admits platform admins and firm staff only", () => {
    expect(canAccessNraCenter(PERSONAS.platformAdmin)).toBe(true);
    expect(canAccessNraCenter(PERSONAS.firmOwner)).toBe(true);
    expect(canAccessNraCenter(PERSONAS.firmAdmin)).toBe(true);
    expect(canAccessNraCenter(PERSONAS.customer)).toBe(false);
    expect(canAccessNraCenter(PERSONAS.clientPortal)).toBe(false);
    expect(canAccessNraCenter(null)).toBe(false);
    expect(canAccessNraCenter(undefined)).toBe(false);
  });

  it("rejects lookalike or empty firm roles", () => {
    expect(canAccessNraCenter({ isAdmin: false, firmRole: "firm_owner_x" })).toBe(false);
    expect(canAccessNraCenter({ isAdmin: false, firmRole: "" })).toBe(false);
    expect(isNraFirmRole("staff")).toBe(false);
  });

  it("isAdmin must be strictly true — truthy strings do not qualify", () => {
    expect(canAccessNraCenter({ isAdmin: "yes" as unknown as boolean, firmRole: null })).toBe(
      false
    );
  });
});

describe("hasFullNraScope (all-clients scope)", () => {
  it("grants full scope to platform admins and firm_owner, not firm_admin", () => {
    expect(hasFullNraScope(PERSONAS.platformAdmin)).toBe(true);
    expect(hasFullNraScope(PERSONAS.firmOwner)).toBe(true);
    expect(hasFullNraScope(PERSONAS.firmAdmin)).toBe(false);
    expect(hasFullNraScope(PERSONAS.customer)).toBe(false);
  });
});

describe("requireNraAccess middleware", () => {
  const matrix: Array<[string, TestUser, number]> = [
    ["anonymous", PERSONAS.anonymous, 401],
    ["customer", PERSONAS.customer, 403],
    ["client portal user", PERSONAS.clientPortal, 403],
    ["firm_admin", PERSONAS.firmAdmin, 200],
    ["firm_owner", PERSONAS.firmOwner, 200],
    ["platform admin", PERSONAS.platformAdmin, 200],
  ];

  for (const [label, user, expected] of matrix) {
    it(`${label} → ${expected}`, async () => {
      expect(await probe(appWithGuard(requireNraAccess, user))).toBe(expected);
    });
  }

  it("requireFirmRole stays an alias of requireNraAccess (admins now pass)", async () => {
    expect(await probe(appWithGuard(requireFirmRole, PERSONAS.platformAdmin))).toBe(200);
    expect(await probe(appWithGuard(requireFirmRole, PERSONAS.customer))).toBe(403);
  });
});

describe("requireFirmOwner middleware", () => {
  it("admits firm_owner and platform admins, rejects firm_admin and customers", async () => {
    expect(await probe(appWithGuard(requireFirmOwner, PERSONAS.firmOwner))).toBe(200);
    expect(await probe(appWithGuard(requireFirmOwner, PERSONAS.platformAdmin))).toBe(200);
    expect(await probe(appWithGuard(requireFirmOwner, PERSONAS.firmAdmin))).toBe(403);
    expect(await probe(appWithGuard(requireFirmOwner, PERSONAS.customer))).toBe(403);
    expect(await probe(appWithGuard(requireFirmOwner, PERSONAS.anonymous))).toBe(401);
  });
});
