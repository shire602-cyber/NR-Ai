// Shared access checks for the HR routes (leave, employee loans, final settlements).
// Reads need company access; writes need an accountant or above (403 ROLE_REQUIRED). The one self-service write is
// hrOwnRecordWrite: an employee files and cancels leave for their own employee record only.

import type { Request, Response } from "express";
import { storage } from "../storage";
import { resolveActor } from "../services/approval-gate.service";
import { ROLE_RANK } from "../services/approval-rules";
import { linkedEmployeeIds, narrowEmployeeFilter, readsOnlyOwnRecords, type HrReadScope } from "../services/hr-scope";

export async function hrCompanyAccess(req: Request, res: Response, companyId: string, opts: { write: boolean }): Promise<boolean> {
  if (!(await storage.hasCompanyAccess(req.user!.id, companyId, { employeeSelfService: true }))) {
    res.status(403).json({ message: "Access denied" });
    return false;
  }
  if (opts.write) {
    const actor = await resolveActor(req.user!, companyId);
    if (actor.rank < ROLE_RANK.accountant) {
      res.status(403).json({ message: "Only an accountant, CFO or owner can change HR records.", code: "ROLE_REQUIRED" });
      return false;
    }
  }
  return true;
}

/**
 * Read access to HR records with the employee-role restriction: accountant and above (and firm staff) see everything,
 * an employee sees only the employee record linked to their own login. Answers 403 itself (null) when the caller has
 * no access to the company at all.
 */
export async function hrReadScope(req: Request, res: Response, companyId: string): Promise<HrReadScope | null> {
  if (!(await storage.hasCompanyAccess(req.user!.id, companyId, { employeeSelfService: true }))) {
    res.status(403).json({ message: "Access denied" });
    return null;
  }
  const actor = await resolveActor(req.user!, companyId);
  if (!readsOnlyOwnRecords(actor.rank)) return { all: true };
  return { all: false, employeeIds: await linkedEmployeeIds(companyId, req.user!.id) };
}

/**
 * A write an employee may make for their own record only (a leave request, cancelling their own leave): accountant
 * and above may act for anyone, an employee only for the employee record linked to their login (403 HR_OWN_RECORDS_ONLY).
 */
export async function hrOwnRecordWrite(req: Request, res: Response, companyId: string, employeeId: string | null | undefined): Promise<boolean> {
  if (!(await storage.hasCompanyAccess(req.user!.id, companyId, { employeeSelfService: true }))) {
    res.status(403).json({ message: "Access denied" });
    return false;
  }
  const actor = await resolveActor(req.user!, companyId);
  if (!readsOnlyOwnRecords(actor.rank)) return true;
  return allowEmployee(res, { all: false, employeeIds: await linkedEmployeeIds(companyId, req.user!.id) }, employeeId);
}

export const OWN_RECORDS_ONLY = { message: "You can only see your own HR records.", code: "HR_OWN_RECORDS_ONLY" } as const;

/** 403 for an own-records reader asking for another employee's records; returns false after answering. */
export function allowEmployee(res: Response, scope: HrReadScope, employeeId: string | null | undefined): boolean {
  if (scope.all || (employeeId && scope.employeeIds.includes(employeeId))) return true;
  res.status(403).json(OWN_RECORDS_ONLY);
  return false;
}

/**
 * The employee filter of a list request. null: refused and already answered (403). `empty`: the reader has no linked
 * employee record, so the answer is an empty list. Otherwise `employeeId` narrows the query (undefined = everyone).
 * A login is linked to at most one employee per company (unique index), so an own-records reader has one id.
 */
export function employeeFilterFor(res: Response, scope: HrReadScope, requested: string | undefined): { employeeId?: string; empty?: boolean } | null {
  const f = narrowEmployeeFilter(scope, requested);
  if (f.kind === "forbidden") {
    res.status(403).json(OWN_RECORDS_ONLY);
    return null;
  }
  if (f.kind === "any") return {};
  if (f.kind === "one") return { employeeId: f.id };
  return f.ids.length > 0 ? { employeeId: f.ids[0] } : { empty: true };
}

/** Company-wide payroll views (runs' totals, the register, the WPS file): accountant and above only. */
export async function hrFullAccess(req: Request, res: Response, companyId: string): Promise<boolean> {
  if (!(await storage.hasCompanyAccess(req.user!.id, companyId, { employeeSelfService: true }))) {
    res.status(403).json({ message: "Access denied" });
    return false;
  }
  const actor = await resolveActor(req.user!, companyId);
  if (readsOnlyOwnRecords(actor.rank)) {
    res.status(403).json({ message: "Only an accountant, CFO or owner can see company-wide payroll.", code: "ROLE_REQUIRED" });
    return false;
  }
  return true;
}
