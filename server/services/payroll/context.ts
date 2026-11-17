/**
 * Shared payroll context: company settings (legal parameters, approval
 * policy), payroll permissions, and the payroll chart-of-accounts codes.
 */
import type { Request } from "express";
import { DomainError } from "../../errors";
import { storage } from "../../storage";
import { getCompanyRole } from "../../middleware/companyRolePolicy";
import { isNraFirmRole } from "../../../shared/access";
import { roleHasAnyPermission, type Permission } from "../../../shared/permissions";
import type { LedgerTx } from "../../ledger";
import { resolveLegalParams, type PayrollLegalParams } from "./legal-params";
import { q, q1 } from "./sql";

export interface PayrollSettings {
  params: PayrollLegalParams;
  allowSingleOwnerApproval: boolean;
  adviserConfirmed: boolean;
  adviserConfirmedBy: string | null;
  adviserConfirmedAt: string | null;
  adviserNote: string | null;
  /** Raw stored overrides (only the keys the company changed). */
  overrides: Record<string, unknown>;
}

interface SettingsRow {
  legal_params: unknown;
  allow_single_owner_approval: boolean;
  adviser_confirmed: boolean;
  adviser_confirmed_by: string | null;
  adviser_confirmed_at: Date | null;
  adviser_note: string | null;
}

export async function loadPayrollSettings(
  companyId: string,
  tx?: LedgerTx
): Promise<PayrollSettings> {
  const row = await q1<SettingsRow>(
    `SELECT legal_params, allow_single_owner_approval, adviser_confirmed, adviser_confirmed_by,
            adviser_confirmed_at, adviser_note
       FROM payroll_settings WHERE company_id = $1`,
    [companyId],
    tx
  );
  const overrides =
    row?.legal_params && typeof row.legal_params === "object"
      ? (row.legal_params as Record<string, unknown>)
      : {};
  return {
    params: resolveLegalParams(overrides),
    allowSingleOwnerApproval: row?.allow_single_owner_approval ?? true,
    adviserConfirmed: row?.adviser_confirmed === true,
    adviserConfirmedBy: row?.adviser_confirmed_by ?? null,
    adviserConfirmedAt:
      row?.adviser_confirmed_at instanceof Date ? row.adviser_confirmed_at.toISOString() : null,
    adviserNote: row?.adviser_note ?? null,
    overrides,
  };
}

// ─── Access ─────────────────────────────────────────────────────────────────

type ReqUser = { id: string; isAdmin?: boolean | null; firmRole?: string | null };

export function actorOf(req: Request): ReqUser {
  const user = (req as Request & { user?: ReqUser }).user;
  if (!user?.id) throw new DomainError("AUTH_REQUIRED", 401);
  return user;
}

/**
 * Company access + role permission for routes addressed by a row id
 * (/api/payroll-runs/:id/...). A caller with no access to the row's company
 * gets 404 (no existence oracle); a member without the permission gets 403.
 */
export async function assertPayrollAccess(
  req: Request,
  companyId: string,
  permissions?: readonly [Permission, ...Permission[]]
): Promise<ReqUser> {
  const user = actorOf(req);
  if (!(await storage.hasCompanyAccess(user.id, companyId))) {
    throw new DomainError("NOT_FOUND", 404, undefined, "Not found");
  }
  if (!permissions) return user;
  if (user.isAdmin === true || isNraFirmRole(user.firmRole)) return user;
  const role = await getCompanyRole(user.id, companyId);
  if (!role || !roleHasAnyPermission(role, permissions)) {
    throw new DomainError(
      "PERMISSION_DENIED",
      403,
      { permission: permissions[0], permissions, role },
      "Your role in this company does not allow this action"
    );
  }
  return user;
}

export async function companyMemberCount(companyId: string, tx?: LedgerTx): Promise<number> {
  const row = await q1<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM company_users WHERE company_id = $1`,
    [companyId],
    tx
  );
  return Number(row?.n ?? 0);
}

// ─── Accounts ───────────────────────────────────────────────────────────────

export const PAYROLL_ACCOUNTS = {
  salariesExpense: "5020",
  pensionExpense: "5025",
  gratuityExpense: "5028",
  salariesPayable: "2030",
  pensionPayable: "2032",
  deductionsPayable: "2034",
  gratuityProvision: "2036",
} as const;
export type PayrollAccountKey = keyof typeof PAYROLL_ACCOUNTS;

export async function payrollAccounts(
  companyId: string,
  tx?: LedgerTx
): Promise<Partial<Record<PayrollAccountKey, string>>> {
  const rows = await q<{ id: string; code: string }>(
    `SELECT id, code FROM accounts
      WHERE company_id = $1 AND code = ANY($2::text[]) AND is_archived = false AND is_active = true`,
    [companyId, Object.values(PAYROLL_ACCOUNTS)],
    tx
  );
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  const out: Partial<Record<PayrollAccountKey, string>> = {};
  for (const [key, code] of Object.entries(PAYROLL_ACCOUNTS) as Array<
    [PayrollAccountKey, string]
  >) {
    const id = byCode.get(code);
    if (id) out[key] = id;
  }
  return out;
}

export function requireAccount(
  accounts: Partial<Record<PayrollAccountKey, string>>,
  key: PayrollAccountKey
): string {
  const id = accounts[key];
  if (!id) {
    throw new DomainError(
      "PAYROLL_ACCOUNT_MISSING",
      422,
      { account: PAYROLL_ACCOUNTS[key] },
      `Payroll account ${PAYROLL_ACCOUNTS[key]} is missing or archived in the chart of accounts`
    );
  }
  return id;
}

/** A cash/bank account the company may pay salaries from (active asset account). */
/** Cash / bank account rule shared with bill payments (X4/J3): asset + cash/bank sub-type
 *  or one of the seeded cash/bank codes. */
const CASH_SUBTYPES = new Set(["cash", "bank"]);
const CASH_CODES = new Set(["1010", "1020", "1030"]);

export async function assertPaymentAccount(
  companyId: string,
  accountId: string,
  tx?: LedgerTx
): Promise<void> {
  const acct = await q1<{ type: string; sub_type: string | null; code: string }>(
    `SELECT type, sub_type, code FROM accounts
      WHERE id = $1 AND company_id = $2 AND is_archived = false AND is_active = true`,
    [accountId, companyId],
    tx
  );
  if (!acct)
    throw new DomainError("ACCOUNT_NOT_FOUND", 422, { accountId }, "Payment account not found");
  if (
    acct.type !== "asset" ||
    !(CASH_SUBTYPES.has(acct.sub_type ?? "") || CASH_CODES.has(acct.code))
  ) {
    throw new DomainError(
      "PAYMENT_ACCOUNT_REQUIRED",
      422,
      { accountId },
      "Salaries must be paid from a cash or bank account"
    );
  }
}
