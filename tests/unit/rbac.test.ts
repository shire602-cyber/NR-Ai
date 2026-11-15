import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Mock the db module before importing rbac so the queries inside
// getAccessibleCompanyIds (firm_staff_assignments + company_users) are
// intercepted. Both queries chain `.from().innerJoin().where()`, so the mock
// supports that shape (and also bare `.from().where()` for forward-compat).
const mockDbSelect = vi.fn();
vi.mock("../../server/db", () => {
  const where = () => mockDbSelect();
  const builder: any = { where, innerJoin: () => ({ where }) };
  return {
    db: {
      select: () => ({ from: () => builder }),
    },
    pool: { query: vi.fn(async () => ({ rows: [] })) },
  };
});

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

describe("rbac.getAccessibleCompanyIds", () => {
  beforeEach(() => {
    mockDbSelect.mockReset();
  });

  it("returns null for firm_owner — caller should not filter", async () => {
    const result = await getAccessibleCompanyIds("user-1", "firm_owner");
    expect(result).toBeNull();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("unions firm_staff_assignments + company_users for firm_admin", async () => {
    // First call → firm_staff_assignments rows; second → company_users rows.
    mockDbSelect.mockResolvedValueOnce([{ companyId: "c1" }]);
    mockDbSelect.mockResolvedValueOnce([{ companyId: "c2" }]);

    const result = await getAccessibleCompanyIds("user-1", "firm_admin");
    expect(result).not.toBeNull();
    expect((result as string[]).sort()).toEqual(["c1", "c2"]);
  });

  it("deduplicates companies that appear in both access tables", async () => {
    mockDbSelect.mockResolvedValueOnce([{ companyId: "c1" }, { companyId: "c2" }]);
    mockDbSelect.mockResolvedValueOnce([{ companyId: "c2" }, { companyId: "c3" }]);

    const result = await getAccessibleCompanyIds("user-1", "firm_admin");
    expect((result as string[]).sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("returns an empty array when firm_admin has no access via either table", async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    mockDbSelect.mockResolvedValueOnce([]);

    const result = await getAccessibleCompanyIds("user-1", "firm_admin");
    expect(result).toEqual([]);
  });

  it("treats unknown role strings as restricted (does not return null)", async () => {
    // Defensive default: unknown roles fall through to the restricted-list
    // path so a misconfigured user never accidentally sees every client.
    mockDbSelect.mockResolvedValueOnce([{ companyId: "c1" }]);
    mockDbSelect.mockResolvedValueOnce([]);
    const result = await getAccessibleCompanyIds("user-1", "visitor");
    expect(Array.isArray(result)).toBe(true);
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
