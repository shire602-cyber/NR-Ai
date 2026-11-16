/**
 * W5-D pure contracts: firm role permission table (R15-13), the guard
 * behaviour for read-only roles and NR-only routes (R15-12), the shared bulk
 * request contract (R15-07), the client TRN rule (R15-05), VAT-stagger task
 * periods (R15-15) and WIP valuation / letter rendering (R15-11).
 */
import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

vi.mock("../../server/db", () => ({ db: {}, pool: { query: vi.fn() } }));

import {
  FIRM_PERMISSIONS,
  FIRM_ROLE_COMPANY_ROLE,
  FIRM_ROLE_PERMISSIONS,
  FIRM_ROLES,
  canAccessNraCenter,
  canPrepareFirmWorkpaper,
  canReviewFirmWorkpaper,
  firmRoleCanWrite,
  firmRoleHasPermission,
  firmRoleSeesAllClients,
  isNraFirmRole,
} from "../../shared/access";
import {
  requireFirmAccess,
  requireFirmPermission,
  requireNraAccess,
  requireNrFirm,
} from "../../server/middleware/rbac";
import {
  bulkScopeSchema,
  parseCsv,
  resolveBulkPeriod,
} from "../../server/services/firm/bulk.service";
import { annualPeriods, vatPeriods } from "../../server/services/firm/workflow.service";
import { entryValueFils, renderLetter } from "../../server/services/firm/billing.service";
import {
  clientNameKey,
  validateImportedClient,
  zOptionalClientTrn,
} from "../../server/services/firm-clients.service";

function res() {
  const r = { locals: {} as Record<string, unknown>, status: vi.fn(), json: vi.fn() };
  r.status.mockReturnValue(r);
  r.json.mockReturnValue(r);
  return r as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    locals: Record<string, unknown>;
  };
}

describe("[R15-13] firm roles and permissions", () => {
  it("defines five roles; only known permissions; firm_owner holds all", () => {
    expect(FIRM_ROLES).toEqual(["firm_owner", "firm_admin", "preparer", "reviewer", "viewer"]);
    for (const role of FIRM_ROLES) {
      for (const p of FIRM_ROLE_PERMISSIONS[role]) expect(FIRM_PERMISSIONS).toContain(p);
    }
    expect(FIRM_ROLE_PERMISSIONS.firm_owner).toEqual(FIRM_PERMISSIONS);
  });

  it("preparer edits but cannot archive, assign staff, bulk-run or review", () => {
    expect(firmRoleHasPermission("preparer", "firm.clients.write")).toBe(true);
    expect(firmRoleHasPermission("preparer", "firm.clients.archive")).toBe(false);
    expect(firmRoleHasPermission("preparer", "firm.staff.manage")).toBe(false);
    expect(firmRoleHasPermission("preparer", "firm.bulk.run")).toBe(false);
    expect(canPrepareFirmWorkpaper("preparer")).toBe(true);
    expect(canReviewFirmWorkpaper("preparer")).toBe(false);
    expect(canReviewFirmWorkpaper("reviewer")).toBe(true);
    expect(canPrepareFirmWorkpaper("reviewer")).toBe(false);
  });

  it("viewer is read-only and only firm_owner sees every client", () => {
    expect(FIRM_ROLE_PERMISSIONS.viewer).toEqual(["firm.clients.read"]);
    expect(firmRoleCanWrite("viewer")).toBe(false);
    expect(firmRoleCanWrite("preparer")).toBe(true);
    expect(FIRM_ROLES.filter(firmRoleSeesAllClients)).toEqual(["firm_owner"]);
    expect(FIRM_ROLE_COMPANY_ROLE.viewer).toBe("viewer");
    expect(FIRM_ROLE_COMPANY_ROLE.preparer).toBe("bookkeeper");
  });

  it("legacy bypass stays limited to firm_owner/firm_admin; NR center admits every NR firm role", () => {
    expect(isNraFirmRole("preparer")).toBe(false);
    expect(isNraFirmRole("viewer")).toBe(false);
    for (const role of FIRM_ROLES) expect(canAccessNraCenter({ firmRole: role })).toBe(true);
    expect(canAccessNraCenter({ firmRole: "staff" })).toBe(false);
  });
});

describe("[R15-12][R15-13] guards", () => {
  it("requireFirmAccess blocks writes for a viewer and resolves NR staff without a DB hit", () => {
    const next = vi.fn() as unknown as NextFunction;
    const r1 = res();
    requireFirmAccess()(
      { method: "POST", user: { id: "v", firmRole: "viewer" } } as unknown as Request,
      r1,
      next
    );
    expect(r1.status).toHaveBeenCalledWith(403);
    const r2 = res();
    requireFirmAccess()(
      { method: "GET", user: { id: "v", firmRole: "viewer" } } as unknown as Request,
      r2,
      next
    );
    expect(next).toHaveBeenCalledOnce();
    expect(r2.locals.firmContext).toMatchObject({ isNr: true, role: "viewer" });
  });

  it("requireFirmPermission and requireNrFirm read the resolved context", () => {
    const next = vi.fn() as unknown as NextFunction;
    const r = res();
    r.locals.firmContext = {
      firmId: "f",
      isNr: false,
      role: "preparer",
      userId: "u",
      platformAdmin: false,
    };
    requireFirmPermission("firm.clients.archive")({} as Request, r, next);
    expect(r.status).toHaveBeenCalledWith(403);
    const r2 = res();
    r2.locals.firmContext = r.locals.firmContext;
    requireNrFirm()({} as Request, r2, next);
    expect(r2.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("requireNraAccess keeps NR viewers read-only on NR-only surfaces", () => {
    const next = vi.fn() as unknown as NextFunction;
    const r = res();
    requireNraAccess()(
      { method: "POST", user: { id: "v", firmRole: "viewer" } } as unknown as Request,
      r,
      next
    );
    expect(r.status).toHaveBeenCalledWith(403);
    requireNraAccess()(
      { method: "GET", user: { id: "v", firmRole: "viewer" } } as unknown as Request,
      res(),
      next
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("[R15-07] bulk request contract", () => {
  it("accepts { companyIds?, period? } and rejects unknown period shapes", () => {
    expect(bulkScopeSchema.safeParse({}).success).toBe(true);
    expect(bulkScopeSchema.safeParse({ period: "2026-07" }).success).toBe(true);
    expect(bulkScopeSchema.safeParse({ period: "Q3 2026" }).success).toBe(true);
    const bad = bulkScopeSchema.safeParse({ period: "next quarter" });
    expect(bad.success).toBe(false);
    const empty = bulkScopeSchema.safeParse({ companyIds: [] });
    expect(empty.success).toBe(false);
    if (!empty.success)
      expect(empty.error.issues[0].message).toBe("companyIds must list at least one client");
  });

  it("normalises periods and defaults to the current quarter", () => {
    expect(resolveBulkPeriod("2026-Q3")).toEqual({
      label: "Q3 2026",
      start: "2026-07-01",
      end: "2026-09-30",
    });
    expect(resolveBulkPeriod("2026-02")).toEqual({
      label: "2026-02",
      start: "2026-02-01",
      end: "2026-02-28",
    });
    expect(resolveBulkPeriod(undefined, new Date("2026-11-15T00:00:00Z")).label).toBe("Q4 2026");
  });

  it("parses quoted CSV fields", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
});

describe("[R15-04][R15-05] client validation", () => {
  it("TRN must be 15 digits after removing spaces and hyphens", () => {
    expect(zOptionalClientTrn.safeParse("123").success).toBe(false);
    expect(zOptionalClientTrn.parse("100-000-000-000-003")).toBe("100000000000003");
    expect(zOptionalClientTrn.parse("")).toBeUndefined();
    const row = validateImportedClient({ name: "X", trnVatNumber: "abc" });
    expect(row).toMatchObject({ ok: false, field: "trnVatNumber" });
  });

  it("duplicate key ignores case and repeated spaces", () => {
    expect(clientNameKey("  Agent15   Client One LLC ")).toBe(
      clientNameKey("agent15 client one llc")
    );
  });
});

describe("[R15-15] task periods follow the VAT stagger", () => {
  it("quarterly stagger starting in February", () => {
    expect(
      vatPeriods("quarterly", 2, "2026-01-01", "2026-12-31").map((p) => `${p.start}..${p.end}`)
    ).toEqual([
      "2025-11-01..2026-01-31",
      "2026-02-01..2026-04-30",
      "2026-05-01..2026-07-31",
      "2026-08-01..2026-10-31",
    ]);
    expect(vatPeriods("monthly", 1, "2026-03-01", "2026-04-30")).toHaveLength(2);
    expect(annualPeriods(1, "2026-01-01", "2026-12-31").map((p) => p.end)).toEqual(["2026-12-31"]);
  });
});

describe("[R15-11] WIP valuation and letters", () => {
  it("values time exactly in fils (half-up)", () => {
    expect(entryValueFils(90, 400)).toBe(60000);
    expect(entryValueFils(10, 100)).toBe(1667);
    expect(entryValueFils(0, 100)).toBe(0);
  });

  it("renders template placeholders", () => {
    expect(
      renderLetter("{{firm_name}} for {{ client_name }}: {{missing}}.", {
        firm_name: "A",
        client_name: "B",
      })
    ).toBe("A for B: .");
  });
});
