/**
 * Leave management (R09-15): leave types with entitlement/accrual, requests
 * with an approval step, balances, and the per-period leave days that feed
 * payroll (unpaid days reduce pay) and the WPS SIF (days on leave).
 *
 * Default types follow Federal Decree-Law 33/2021 (counsel review, see
 * docs/payroll-legal-parameters.md): annual 30 days/year (accrued monthly),
 * sick 90 days (first 15 full pay — tracked as paid here; the half/unpaid
 * tiers are entered as separate requests), unpaid leave.
 */
import { DomainError } from "../../errors";
import type { LedgerTx } from "../../ledger";
import { completedAnniversaries, daysBetween, utcDate } from "./calc";
import { dayOf, num, q, q1 } from "./sql";

export const DEFAULT_LEAVE_TYPES = [
  {
    code: "annual",
    nameEn: "Annual leave",
    nameAr: "إجازة سنوية",
    isPaid: true,
    annualEntitlementDays: 30,
    accrualMethod: "monthly",
    carryForwardMaxDays: 15,
  },
  {
    code: "sick",
    nameEn: "Sick leave",
    nameAr: "إجازة مرضية",
    isPaid: true,
    annualEntitlementDays: 15,
    accrualMethod: "annual",
    carryForwardMaxDays: 0,
  },
  {
    code: "unpaid",
    nameEn: "Unpaid leave",
    nameAr: "إجازة بدون راتب",
    isPaid: false,
    annualEntitlementDays: 0,
    accrualMethod: "none",
    carryForwardMaxDays: 0,
  },
] as const;

export async function ensureDefaultLeaveTypes(companyId: string): Promise<void> {
  for (const t of DEFAULT_LEAVE_TYPES) {
    await q(
      `INSERT INTO leave_types (company_id, code, name_en, name_ar, is_paid, annual_entitlement_days,
                                accrual_method, carry_forward_max_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (company_id, code) DO NOTHING`,
      [
        companyId,
        t.code,
        t.nameEn,
        t.nameAr,
        t.isPaid,
        t.annualEntitlementDays,
        t.accrualMethod,
        t.carryForwardMaxDays,
      ]
    );
  }
}

const overlapDays = (aStart: string, aEnd: string, bStart: string, bEnd: string): number => {
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd < bEnd ? aEnd : bEnd;
  if (e < s) return 0;
  return daysBetween(utcDate(s), utcDate(e)) + 1;
};

interface LeaveRow {
  employee_id: string;
  start_date: unknown;
  end_date: unknown;
  days: unknown;
  is_paid: boolean;
}

/** Approved leave days per employee that fall inside [start, end] (ISO dates). */
export async function leaveDaysInRange(
  companyId: string,
  start: string,
  end: string,
  tx?: LedgerTx,
  employeeId?: string
): Promise<Map<string, { paid: number; unpaid: number }>> {
  const rows = await q<LeaveRow>(
    `SELECT r.employee_id, r.start_date, r.end_date, r.days, t.is_paid
       FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
      WHERE r.company_id = $1 AND r.status = 'approved'
        AND r.start_date <= $3::date AND r.end_date >= $2::date
        ${employeeId ? "AND r.employee_id = $4" : ""}`,
    employeeId ? [companyId, start, end, employeeId] : [companyId, start, end],
    tx
  );
  const out = new Map<string, { paid: number; unpaid: number }>();
  for (const r of rows) {
    const rs = dayOf(r.start_date);
    const re = dayOf(r.end_date);
    if (!rs || !re || !r.employee_id) continue;
    const span = daysBetween(utcDate(rs), utcDate(re)) + 1;
    const ov = overlapDays(rs, re, start, end);
    // Requests can be shorter than their calendar span (weekends): prorate.
    const days = Math.round(((num(r.days) * ov) / span) * 2) / 2;
    const cur = out.get(r.employee_id) ?? { paid: 0, unpaid: 0 };
    if (r.is_paid) cur.paid += days;
    else cur.unpaid += days;
    out.set(r.employee_id, cur);
  }
  return out;
}

/** Calendar span of a request in days (inclusive). */
export function requestSpanDays(startDate: string, endDate: string): number {
  return daysBetween(utcDate(startDate), utcDate(endDate)) + 1;
}

export interface LeaveBalance {
  leaveTypeId: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  isPaid: boolean;
  entitlementDays: number;
  accruedDays: number;
  takenDays: number;
  pendingDays: number;
  balanceDays: number;
}

/**
 * Balance for the calendar leave year containing `asOf`: accrued entitlement
 * minus approved days taken. Monthly accrual = entitlement x months served in
 * the year / 12 (from the join date when it falls in the year); annual
 * accrual = the full entitlement once the first service anniversary is
 * reached. Carry-forward from earlier years is not modelled yet.
 */
export async function leaveBalances(
  companyId: string,
  employeeId: string,
  asOf: string
): Promise<LeaveBalance[]> {
  const emp = await q1<{ join_date: unknown }>(
    `SELECT join_date FROM employees WHERE id = $1 AND company_id = $2`,
    [employeeId, companyId]
  );
  if (!emp) throw new DomainError("EMPLOYEE_NOT_FOUND", 404, undefined, "Employee not found");
  const year = Number(asOf.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const join = dayOf(emp.join_date);
  const accrualStart = join && join > yearStart ? join : yearStart;
  const monthsServed = (() => {
    if (asOf < accrualStart) return 0;
    const a = utcDate(accrualStart);
    const b = utcDate(asOf);
    let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    if (b.getUTCDate() >= a.getUTCDate()) m += 1; // the running month counts once started
    return Math.max(0, Math.min(12, m));
  })();
  const types = await q<{
    id: string;
    code: string;
    name_en: string;
    name_ar: string | null;
    is_paid: boolean;
    annual_entitlement_days: unknown;
    accrual_method: string;
  }>(
    `SELECT id, code, name_en, name_ar, is_paid, annual_entitlement_days, accrual_method
       FROM leave_types WHERE company_id = $1 AND is_active = true ORDER BY code`,
    [companyId]
  );
  const taken = await q<{ leave_type_id: string; status: string; days: string }>(
    `SELECT leave_type_id, status, SUM(days)::text AS days FROM leave_requests
      WHERE company_id = $1 AND employee_id = $2 AND status IN ('approved', 'pending')
        AND start_date <= $4::date AND end_date >= $3::date
      GROUP BY leave_type_id, status`,
    [companyId, employeeId, yearStart, yearEnd]
  );
  const anniversaryReached = join
    ? completedAnniversaries(utcDate(join), utcDate(asOf)).years >= 1
    : false;
  return types.map((t) => {
    const entitlement = num(t.annual_entitlement_days);
    let accrued = 0;
    if (t.accrual_method === "monthly") accrued = (entitlement * monthsServed) / 12;
    else if (t.accrual_method === "annual") accrued = anniversaryReached || !join ? entitlement : 0;
    accrued = Math.round(accrued * 100) / 100;
    const takenDays = num(
      taken.find((x) => x.leave_type_id === t.id && x.status === "approved")?.days
    );
    const pendingDays = num(
      taken.find((x) => x.leave_type_id === t.id && x.status === "pending")?.days
    );
    return {
      leaveTypeId: t.id,
      code: t.code,
      nameEn: t.name_en,
      nameAr: t.name_ar,
      isPaid: t.is_paid,
      entitlementDays: entitlement,
      accruedDays: accrued,
      takenDays,
      pendingDays,
      balanceDays: t.accrual_method === "none" ? 0 : Math.round((accrued - takenDays) * 100) / 100,
    };
  });
}

/** Total approved unpaid-leave days between two dates (service-length exclusion). */
export async function unpaidLeaveDaysBetween(
  companyId: string,
  employeeId: string,
  start: string,
  end: string,
  tx?: LedgerTx
): Promise<number> {
  const m = await leaveDaysInRange(companyId, start, end, tx, employeeId);
  return m.get(employeeId)?.unpaid ?? 0;
}
