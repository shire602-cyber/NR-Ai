// Whose HR records a user may read (Phase 9 follow-up B4).
//
// Accountant, CFO, owner, firm staff and platform admins read every employee's HR records. An employee-role member
// reads only the employee record(s) linked to their own login (employees.user_id, set by an accountant or above).
// The decision is pure so it can be tested without a database; the lookup of the linked records is one query.

import { pool } from "../db";
import { ROLE_RANK } from "./approval-rules";

export type HrReadScope = { all: true } | { all: false; employeeIds: readonly string[] };

/** Ranks below accountant (the employee role) are limited to their own records. */
export function readsOnlyOwnRecords(rank: number): boolean {
  return rank < ROLE_RANK.accountant;
}

export function canSeeEmployee(scope: HrReadScope, employeeId: string | null | undefined): boolean {
  if (scope.all) return true;
  return !!employeeId && scope.employeeIds.includes(employeeId);
}

/**
 * The employee id a list request may filter by: undefined (no filter) for a full-access reader who asked for none,
 * the asked id when it is visible, or "forbidden" when an own-records reader asked for somebody else's.
 * An own-records reader who asked for nothing is narrowed to their own records ("own").
 */
export function narrowEmployeeFilter(scope: HrReadScope, requested: string | undefined): { kind: "any" } | { kind: "one"; id: string } | { kind: "own"; ids: readonly string[] } | { kind: "forbidden" } {
  if (scope.all) return requested ? { kind: "one", id: requested } : { kind: "any" };
  if (requested) return scope.employeeIds.includes(requested) ? { kind: "one", id: requested } : { kind: "forbidden" };
  return { kind: "own", ids: scope.employeeIds };
}

/** The employee records of a company that belong to this login. */
export async function linkedEmployeeIds(companyId: string, userId: string): Promise<string[]> {
  const rows = (await pool.query(`SELECT id::text AS id FROM employees WHERE company_id = $1 AND user_id = $2`, [companyId, userId])).rows;
  return rows.map((r: { id: string }) => r.id);
}
