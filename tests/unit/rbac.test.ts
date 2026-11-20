import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Mock the db module before importing rbac so the queries inside
// getAccessibleCompanyIds (firm_staff_assignments + company_users) are
// intercepted. Both queries chain `.from().innerJoin().where()`, so the mock
// supports that shape (and also bare `.from().where()` for forward-compat).
const mockDbSelect = vi.fn();
vi.mock("../../server/db", () => {
  // where() is awaitable and also supports .limit() (firm membership lookup).
  const where = () => {
    const p = Promise.resolve(mockDbSelect());
    return Object.assign(p, { limit: () => p });
  };
  const builder: any = { where, innerJoin: () => ({ where }) };
  return {
    db: {
      select: () => ({ from: () => builder }),
    },
    pool: { query: vi.fn(async () => ({ rows: [] })) },
  };
});

import { pool } from "../../server/db";
import { requireFirmRole, getAccessibleCompanyIds } from "../../server/middleware/rbac";
import {
  COMPANY_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  grantableRoles,
  normalizeCompanyRole,
  roleHasPermission,
} from "../../shared/permissions";
import {
  POLICY_RULES,
  assertDifferentActor,
  rbacMode,
  resolvePermission,
  resolveRequestCompany,
} from "../../server/middleware/companyRolePolicy";

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("rbac.requireFirmRole", () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
  });

  it("blocks unauthenticated requests with 401", () => {
    const middleware = requireFirmRole();
    const req = {} as Request;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks users without a firm role", () => {
    const middleware = requireFirmRole();
    const req = { user: { id: "u1", firmRole: null } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks users with an unknown role string", () => {
    const middleware = requireFirmRole();
    const req = { user: { id: "u1", firmRole: "visitor" } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows firm_owner", () => {
    const middleware = requireFirmRole();
    const req = { user: { id: "u1", firmRole: "firm_owner" } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows firm_admin", () => {
    const middleware = requireFirmRole();
    const req = { user: { id: "u1", firmRole: "firm_admin" } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe("rbac.getAccessibleCompanyIds (W5-D firm-scoped)", () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
  });

  it("returns null only for platform admins without a firm role", async () => {
    expect(await getAccessibleCompanyIds("admin-1", "", true)).toBeNull();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("[R15-12] firm_owner gets the firm's client ids, never null (no cross-firm 'all')", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "c1" }, { id: "c2" }]);
    const result = await getAccessibleCompanyIds("user-1", "firm_owner");
    expect(result).toEqual(["c1", "c2"]);
  });

  it("firm_admin gets the assigned client ids from one scoped query", async () => {
    mockDbSelect.mockResolvedValueOnce([{ id: "c3" }]);
    const result = await getAccessibleCompanyIds("user-1", "firm_admin");
    expect(result).toEqual(["c3"]);
  });

  it("treats unknown role strings as non-staff unless a firm membership exists", async () => {
    mockDbSelect.mockResolvedValueOnce([]); // no firm_members row
    const result = await getAccessibleCompanyIds("user-1", "visitor");
    expect(result).toEqual([]);
  });
});

// ─── W2-C permission matrix and central policy (R01-02, R01-14) ─────────────

describe("R01-14 permission matrix", () => {
  it("defines the seven roles and only known permissions", () => {
    expect(COMPANY_ROLES).toEqual([
      "owner",
      "admin",
      "accountant",
      "bookkeeper",
      "approver",
      "employee",
      "viewer",
    ]);
    for (const role of COMPANY_ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
    expect(ROLE_PERMISSIONS.owner).toEqual(PERMISSIONS);
  });

  it("viewer is read-only; only owners hold billing and company deletion", () => {
    expect(ROLE_PERMISSIONS.viewer).toEqual(["reports.read"]);
    for (const role of COMPANY_ROLES.filter((r) => r !== "owner")) {
      expect(roleHasPermission(role, "billing.manage")).toBe(false);
      expect(roleHasPermission(role, "company.delete")).toBe(false);
    }
    expect(roleHasPermission("bookkeeper", "documents.approve")).toBe(false);
    expect(roleHasPermission("approver", "ledger.post")).toBe(false);
    expect(roleHasPermission("employee", "settings.company")).toBe(false);
  });

  it("R01-03: maps legacy free-text roles (unknown -> employee)", () => {
    expect(normalizeCompanyRole("cfo")).toBe("admin");
    expect(normalizeCompanyRole("Owner")).toBe("owner");
    expect(normalizeCompanyRole("superadmin")).toBe("employee");
    expect(normalizeCompanyRole(null)).toBe("employee");
  });

  it("only owners can grant the owner role", () => {
    expect(grantableRoles("owner")).toContain("owner");
    expect(grantableRoles("admin")).not.toContain("owner");
    expect(grantableRoles("accountant")).toEqual([]);
  });
});

describe("STEP5 portal invitation policy", () => {
  const C = "/companies/11111111-1111-4111-8111-111111111111";

  it("inviting, resending, revoking and removing access need documents.write; the status is readable", () => {
    expect(resolvePermission("POST", `${C}/customer-contacts/x/portal-invitations`)).toEqual([
      "documents.write",
    ]);
    expect(resolvePermission("POST", `${C}/portal-invitations/bulk`)).toEqual(["documents.write"]);
    expect(resolvePermission("POST", `${C}/portal-invitations/x/resend`)).toEqual([
      "documents.write",
    ]);
    expect(resolvePermission("POST", `${C}/portal-invitations/x/revoke`)).toEqual([
      "documents.write",
    ]);
    expect(resolvePermission("DELETE", `${C}/portal-accounts/x`)).toEqual(["documents.write"]);
    expect(resolvePermission("GET", `${C}/portal-access/summary`)).toEqual(["reports.read"]);
    expect(resolvePermission("GET", `${C}/customer-contacts/x/portal-access`)).toEqual([
      "reports.read",
    ]);
  });

  it("the public join routes sit outside the company policy", () => {
    expect(resolvePermission("GET", "/portal-invitations/abc")).toBeNull();
    expect(resolvePermission("POST", "/portal-invitations/abc/accept")).toBeNull();
  });
});

describe("R01-02 policy resolution", () => {
  const C = "/companies/11111111-1111-4111-8111-111111111111";

  it("defaults: reads need reports.read, writes need documents.write", () => {
    expect(resolvePermission("GET", `${C}/invoices`)).toEqual(["reports.read"]);
    expect(resolvePermission("POST", `${C}/invoices`)).toEqual(["documents.write"]);
  });

  it("explicit entries for settings, team, billing, backups, periods, posting, approvals, payroll", () => {
    expect(resolvePermission("PUT", C)).toEqual(["settings.company"]);
    expect(resolvePermission("DELETE", C)).toEqual(["company.delete"]);
    expect(resolvePermission("PUT", `${C}/team/x`)).toEqual(["team.manage"]);
    expect(resolvePermission("POST", `${C}/billing/checkout`)).toEqual(["billing.manage"]);
    expect(resolvePermission("GET", `${C}/backups`)).toEqual(["backups.manage"]);
    expect(resolvePermission("POST", `${C}/month-end/lock-period`)).toEqual(["period.lock"]);
    expect(resolvePermission("POST", "/period-lock/unlock")).toEqual(["period.unlock"]);
    expect(resolvePermission("POST", `${C}/journal`)).toEqual(["ledger.post"]);
    expect(resolvePermission("POST", "/invoices/x/post")).toEqual(["ledger.post"]);
    // J4: every transition that writes the GL needs the posting permission, not just /post.
    expect(resolvePermission("PATCH", "/invoices/x/status")).toEqual(["ledger.post"]);
    expect(resolvePermission("POST", "/credit-notes/x/issue")).toEqual(["ledger.post"]);
    expect(resolvePermission("POST", "/credit-notes/x/void")).toEqual(["ledger.post"]);
    expect(resolvePermission("POST", `${C}/invoices/x/payments`)).toEqual(["ledger.post"]);
    expect(resolvePermission("POST", `${C}/customer-credits/x/refund`)).toEqual(["ledger.post"]);
    expect(resolvePermission("POST", `${C}/fx-revaluations/x/undo`)).toEqual(["ledger.post"]);
    expect(resolvePermission("POST", "/bills/x/approve")).toEqual(["documents.approve"]);
    expect(resolvePermission("POST", "/bills/x/payments")).toEqual(["payments.release"]);
    expect(resolvePermission("POST", "/payroll-runs/x/approve")).toEqual(["payroll.approve"]);
    expect(resolvePermission("GET", `${C}/payroll-runs`)).toEqual([
      "payroll.manage",
      "payroll.approve",
    ]);
  });

  it("exempts identity, firm and admin surfaces", () => {
    expect(resolvePermission("POST", "/auth/login")).toBeNull();
    expect(resolvePermission("GET", "/firm/clients")).toBeNull();
    expect(resolvePermission("POST", "/admin/invitations")).toBeNull();
    expect(resolvePermission("POST", "/companies")).toBeNull();
    expect(resolvePermission("POST", "/team-invitations/abc/accept")).toBeNull();
  });

  it("every explicit rule names known permissions", () => {
    for (const rule of POLICY_RULES) {
      const perms = typeof rule.permission === "string" ? [rule.permission] : rule.permission;
      for (const p of perms) expect(PERMISSIONS).toContain(p);
    }
  });

  it("RBAC_ENFORCE modes", () => {
    expect(rbacMode(undefined)).toBe("enforce");
    expect(rbacMode("true")).toBe("enforce");
    expect(rbacMode("report")).toBe("report");
    expect(rbacMode("off")).toBe("off");
  });
});

describe("maker-checker helper", () => {
  it("assertDifferentActor rejects self-approval unless a single owner is allowed", () => {
    expect(() => assertDifferentActor("u1", "u2")).not.toThrow();
    expect(() => assertDifferentActor(null, "u2")).not.toThrow();
    expect(() => assertDifferentActor("u1", "u1")).toThrow(/cannot also approve/);
    expect(() => assertDifferentActor("u1", "u1", { allowSingleOwner: true })).not.toThrow();
  });
});

it("propagates resource ownership lookup errors before the authorization decision", async () => {
  const missingDatabase = new Error("database unavailable");
  vi.mocked(pool.query).mockRejectedValueOnce(missingDatabase);
  await expect(
    resolveRequestCompany({} as Request, "/invoices/11111111-1111-4111-8111-111111111111")
  ).rejects.toBe(missingDatabase);
});

it("applies the same permissions to mixed-case literals and canonicalizes company identifiers", async () => {
  const companyId = "a1111111-1111-4111-8111-111111111111";
  const path = "/Companies/%411111111-1111-4111-8111-111111111111/BACKUPS";
  expect(resolvePermission("GET", path)).toEqual(["backups.manage"]);
  await expect(resolveRequestCompany({} as Request, path)).resolves.toBe(companyId);
});
