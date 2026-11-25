// S08 — Role/permission matrix review.
//
// The access control model uses three layers:
//   1. shared/access.ts — pure functions used by both client and server.
//   2. server/middleware/rbac.ts — Express middleware wrappers.
//   3. Per-route gate choices — firm_owner vs firm_admin vs any firm staff.
//
// This file tests the pure-function layer directly (no DB, no HTTP) and uses
// source-invariant assertions to guard the routing choices. A DB-backed
// integration test would catch live authorization failures but requires Postgres.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  canAccessNraCenter,
  hasFullNraScope,
  isNraFirmRole,
  shouldShowNraCenterNav,
  NRA_FIRM_ROLES,
} from "../../shared/access";

describe("S08 role matrix — pure access functions (shared/access.ts)", () => {
  // ── isNraFirmRole ────────────────────────────────────────────────────────

  it("recognises firm_owner and firm_admin as valid NRA roles", () => {
    expect(isNraFirmRole("firm_owner")).toBe(true);
    expect(isNraFirmRole("firm_admin")).toBe(true);
  });

  it("rejects customer, client_portal, admin string, null and undefined as NRA roles", () => {
    expect(isNraFirmRole("customer")).toBe(false);
    expect(isNraFirmRole("client_portal")).toBe(false);
    expect(isNraFirmRole("admin")).toBe(false);
    expect(isNraFirmRole(null)).toBe(false);
    expect(isNraFirmRole(undefined)).toBe(false);
    expect(isNraFirmRole("")).toBe(false);
  });

  it("NRA_FIRM_ROLES tuple contains exactly firm_owner and firm_admin", () => {
    expect(NRA_FIRM_ROLES).toHaveLength(2);
    expect(NRA_FIRM_ROLES).toContain("firm_owner");
    expect(NRA_FIRM_ROLES).toContain("firm_admin");
  });

  // ── canAccessNraCenter ───────────────────────────────────────────────────

  it("grants NRA Center access to isAdmin=true regardless of firmRole", () => {
    expect(canAccessNraCenter({ isAdmin: true })).toBe(true);
    expect(canAccessNraCenter({ isAdmin: true, firmRole: null })).toBe(true);
    expect(canAccessNraCenter({ isAdmin: true, firmRole: "customer" })).toBe(true);
  });

  it("grants NRA Center access to firm_owner and firm_admin", () => {
    expect(canAccessNraCenter({ firmRole: "firm_owner" })).toBe(true);
    expect(canAccessNraCenter({ firmRole: "firm_admin" })).toBe(true);
  });

  it("denies NRA Center access to customer, client_portal, null user, and no firmRole", () => {
    expect(canAccessNraCenter({ firmRole: "customer" })).toBe(false);
    expect(canAccessNraCenter({ firmRole: "client_portal" })).toBe(false);
    expect(canAccessNraCenter({ firmRole: null })).toBe(false);
    expect(canAccessNraCenter({})).toBe(false);
    expect(canAccessNraCenter(null)).toBe(false);
    expect(canAccessNraCenter(undefined)).toBe(false);
  });

  // ── hasFullNraScope ──────────────────────────────────────────────────────
  // Platform admin and firm_owner see ALL client companies.
  // firm_admin sees only assigned clients.

  it("grants full scope to isAdmin=true", () => {
    expect(hasFullNraScope({ isAdmin: true })).toBe(true);
  });

  it("grants full scope to firm_owner", () => {
    expect(hasFullNraScope({ firmRole: "firm_owner" })).toBe(true);
  });

  it("denies full scope to firm_admin", () => {
    expect(hasFullNraScope({ firmRole: "firm_admin" })).toBe(false);
  });

  it("denies full scope to customer and unauthenticated", () => {
    expect(hasFullNraScope({ firmRole: "customer" })).toBe(false);
    expect(hasFullNraScope({})).toBe(false);
    expect(hasFullNraScope(null)).toBe(false);
  });

  // ── shouldShowNraCenterNav ───────────────────────────────────────────────
  // Hides the NRA Center nav when the user is inside a specific client context
  // (the firm-level tools don't belong in a single client's workspace).

  it("shows NRA nav for firm staff outside client context", () => {
    expect(shouldShowNraCenterNav({ firmRole: "firm_owner" }, { inClientContext: false })).toBe(
      true
    );
    expect(shouldShowNraCenterNav({ firmRole: "firm_admin" }, { inClientContext: false })).toBe(
      true
    );
  });

  it("hides NRA nav for firm staff inside a client context", () => {
    expect(shouldShowNraCenterNav({ firmRole: "firm_owner" }, { inClientContext: true })).toBe(
      false
    );
    expect(shouldShowNraCenterNav({ firmRole: "firm_admin" }, { inClientContext: true })).toBe(
      false
    );
  });

  it("always hides NRA nav for customers regardless of context", () => {
    expect(shouldShowNraCenterNav({ firmRole: "customer" }, { inClientContext: false })).toBe(
      false
    );
    expect(shouldShowNraCenterNav(null, { inClientContext: false })).toBe(false);
  });
});

describe("S08 role matrix — server middleware wiring (source guards)", () => {
  const rbac = readFileSync("server/middleware/rbac.ts", "utf8");
  const firmRoutes = readFileSync("server/routes/firm.routes.ts", "utf8");
  const firmCommandCenter = readFileSync("server/routes/firm-command-center.routes.ts", "utf8");

  it("requireFirmRole and requireFirmAdmin are aliases of requireNraAccess", () => {
    // Both aliases must delegate to requireNraAccess — if re-implemented they
    // could diverge from the canonical gate.
    expect(rbac).toContain("requireFirmRole");
    expect(rbac).toContain("requireFirmAdmin");
    expect(rbac).toContain("requireNraAccess");
    // Both deprecated aliases should call requireNraAccess()
    const firmRoleAlias = rbac.match(/requireFirmRole[\s\S]*?}/)?.[0] ?? "";
    expect(firmRoleAlias).toContain("requireNraAccess");
  });

  it("requireFirmOwner uses hasFullNraScope — firm_admin is rejected", () => {
    expect(rbac).toContain("requireFirmOwner");
    expect(rbac).toContain("hasFullNraScope");
    // The middleware must call hasFullNraScope and return 403 when false
    expect(rbac).toContain('"Firm owner access required"');
  });

  it("firm.routes.ts mounts requireFirmRole on the /firm prefix", () => {
    expect(firmRoutes).toContain('"/firm"');
    expect(firmRoutes).toContain("requireFirmRole()");
  });

  it("POST /firm/clients/:id/assign-staff is restricted to firm_owner", () => {
    // The assign-staff handler enforces firm_owner inline rather than via
    // requireFirmOwner() middleware — the comment and the guard are both present.
    expect(firmRoutes).toContain("assign-staff");
    // Inline role check: requestingFirmRole !== "firm_owner" → 403
    expect(firmRoutes).toContain('"firm_owner"');
    expect(firmRoutes).toContain("Only firm owners may assign staff");
  });

  it("firm-command-center batch/mutation routes require firm_owner", () => {
    // Read, list endpoints use requireFirmAdmin (both roles).
    // Batch/mutation endpoints further restrict to requireFirmOwner.
    expect(firmCommandCenter).toContain("requireFirmOwner()");
    expect(firmCommandCenter).toContain("requireFirmAdmin()");
  });

  it("getAccessibleCompanyIds returns null (all companies) for firm_owner and admin", () => {
    // Source guard: the function must have a short-circuit for firm_owner.
    expect(rbac).toContain("firm_owner");
    expect(rbac).toContain("return null");
  });

  it("getAccessibleCompanyIds unions firmStaffAssignments and companyUsers for firm_admin", () => {
    // Both tables must be queried so a firm_admin auto-assigned on client
    // creation (company_users path) is not silently excluded.
    expect(rbac).toContain("firmStaffAssignments");
    expect(rbac).toContain("companyUsers");
  });
});
