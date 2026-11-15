import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { pool } from "../db";
import { DomainError } from "../errors";
import {
  ensureGenerated,
  listCalendar,
  type CalendarRow,
} from "../services/compliance-obligations.service";
import { getEffectiveLock } from "../services/period-lock.service";
import { addDays, lastDayOfMonth, uaeToday } from "../services/corporate-tax/deadlines";

type FilingState = "up_to_date" | "overdue" | "due_soon";

export interface AuditCheck {
  key: string;
  label: string;
  labelAr: string;
  weight: number;
  score: number;
  status: "pass" | "partial" | "fail" | "not_applicable";
  explanation: string;
}

/**
 * Filing status of one obligation type (R08-03): the next open obligation
 * (rolls forward once a period's return is filed), its deadline, and whether
 * anything is overdue. Status follows the return state, not the period end.
 */
function filingStatus(rows: CalendarRow[], type: string, today: string, dueSoonDays: number) {
  const ofType = rows.filter((r) => r.obligationType === type);
  const open = ofType.filter((r) => r.status === "upcoming" || r.status === "overdue");
  const completed = ofType.filter((r) => r.status === "completed");
  const overdue = open.filter((r) => r.status === "overdue");
  const next = open.find((r) => r.status === "upcoming") ?? null;
  const lastFiled = completed[completed.length - 1] ?? null;
  let state: FilingState = "up_to_date";
  if (overdue.length > 0) state = "overdue";
  else if (next && next.daysUntilDue <= dueSoonDays) state = "due_soon";
  return {
    lastReturn: lastFiled?.periodEnd ? `${lastFiled.periodEnd}T00:00:00.000Z` : null,
    nextDue: (overdue[0] ?? next)?.dueDate ?? null,
    nextPeriodEnd: (overdue[0] ?? next)?.periodEnd ?? null,
    nextObligationId: (overdue[0] ?? next)?.id ?? null,
    overdueCount: overdue.length,
    state,
    dueInDays: (overdue[0] ?? next)?.daysUntilDue ?? null,
    asOf: today,
  };
}

function check(
  key: string,
  label: string,
  labelAr: string,
  weight: number,
  ratio: number | null,
  explanation: string
): AuditCheck {
  if (ratio === null) {
    return { key, label, labelAr, weight, score: weight, status: "not_applicable", explanation };
  }
  const clamped = Math.max(0, Math.min(1, ratio));
  const score = Math.round(weight * clamped * 10) / 10;
  return {
    key,
    label,
    labelAr,
    weight,
    score,
    status: clamped >= 1 ? "pass" : clamped <= 0 ? "fail" : "partial",
    explanation,
  };
}

/** Audit readiness (R08-13): weighted by real checks, each explained. */
export async function computeAuditReadiness(
  companyId: string,
  rows: CalendarRow[],
  now: Date = new Date()
): Promise<{ score: number; issues: string[]; checks: AuditCheck[] }> {
  const today = uaeToday(now);
  const since = addDays(today, -90);
  const checks: AuditCheck[] = [];

  // 1. Bank reconciliation completeness (last 90 days).
  const bank = await pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_reconciled)::int AS reconciled
       FROM bank_transactions
      WHERE company_id = $1 AND transaction_date::date >= $2::date`,
    [companyId, since]
  );
  const bankTotal = Number(bank.rows[0]?.total) || 0;
  const bankRec = Number(bank.rows[0]?.reconciled) || 0;
  checks.push(
    check(
      "bank_reconciliation",
      "Bank reconciliation completeness",
      "اكتمال التسوية البنكية",
      25,
      bankTotal === 0 ? null : bankRec / bankTotal,
      bankTotal === 0
        ? "No bank transactions in the last 90 days."
        : `${bankRec} of ${bankTotal} bank transactions in the last 90 days are reconciled.`
    )
  );

  // 2. VAT return status per period (obligations already due).
  const vatDue = rows.filter((r) => r.obligationType === "vat_return" && r.dueDate <= today);
  const vatFiled = vatDue.filter((r) => r.status === "completed").length;
  checks.push(
    check(
      "vat_returns",
      "VAT returns filed for every due period",
      "تقديم إقرارات ضريبة القيمة المضافة لكل فترة مستحقة",
      25,
      vatDue.length === 0 ? null : vatFiled / vatDue.length,
      vatDue.length === 0
        ? "No VAT return was due yet (or the company is not VAT registered)."
        : `${vatFiled} of ${vatDue.length} VAT returns that were due are filed.`
    )
  );

  // 3. Period locks: the last completed month is locked.
  const [y, m] = today.split("-").map(Number);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const lastMonthEnd = lastDayOfMonth(prev.y, prev.m);
  const lock = await getEffectiveLock(companyId, lastMonthEnd);
  checks.push(
    check(
      "period_locks",
      "Last month closed and locked",
      "إقفال الشهر الماضي",
      15,
      lock ? 1 : 0,
      lock
        ? `Books are locked through ${lastMonthEnd}.`
        : `The month ending ${lastMonthEnd} is not locked yet.`
    )
  );

  // 4. Unposted documents: draft invoices, unposted receipts, draft journals.
  const docs = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM invoices WHERE company_id = $1)::int AS inv_total,
       (SELECT COUNT(*) FROM invoices WHERE company_id = $1 AND status = 'draft')::int AS inv_draft,
       (SELECT COUNT(*) FROM receipts WHERE company_id = $1)::int AS rec_total,
       (SELECT COUNT(*) FROM receipts WHERE company_id = $1 AND posted = false)::int AS rec_unposted,
       (SELECT COUNT(*) FROM journal_entries WHERE company_id = $1)::int AS je_total,
       (SELECT COUNT(*) FROM journal_entries WHERE company_id = $1 AND status = 'draft')::int AS je_draft`,
    [companyId]
  );
  const d = docs.rows[0] ?? {};
  const totalDocs =
    (Number(d.inv_total) || 0) + (Number(d.rec_total) || 0) + (Number(d.je_total) || 0);
  const unposted =
    (Number(d.inv_draft) || 0) + (Number(d.rec_unposted) || 0) + (Number(d.je_draft) || 0);
  checks.push(
    check(
      "unposted_documents",
      "Documents posted to the ledger",
      "ترحيل المستندات إلى دفتر الأستاذ",
      20,
      totalDocs === 0 ? null : 1 - unposted / totalDocs,
      totalDocs === 0
        ? "No invoices, receipts or journals yet."
        : `${unposted} of ${totalDocs} documents are still unposted (${Number(d.inv_draft) || 0} draft invoices, ${Number(d.rec_unposted) || 0} receipts, ${Number(d.je_draft) || 0} draft journals).`
    )
  );

  // 5. Corporate tax return status (returns already due).
  const ctDue = rows.filter(
    (r) => r.obligationType === "corporate_tax_return" && r.dueDate <= today
  );
  const ctFiled = ctDue.filter((r) => r.status === "completed").length;
  checks.push(
    check(
      "corporate_tax_returns",
      "Corporate tax returns filed when due",
      "تقديم إقرارات ضريبة الشركات في موعدها",
      15,
      ctDue.length === 0 ? null : ctFiled / ctDue.length,
      ctDue.length === 0
        ? "No corporate tax return was due yet."
        : `${ctFiled} of ${ctDue.length} corporate tax returns that were due are filed.`
    )
  );

  const score = Math.round(checks.reduce((s, c) => s + c.score, 0));
  const issues = checks
    .filter((c) => c.status === "fail" || c.status === "partial")
    .map((c) => c.explanation);
  return { score, issues, checks };
}

export function registerComplianceDashboardRoutes(app: Express) {
  // =====================================
  // COMPLIANCE DASHBOARD (UAE Overview)
  // =====================================

  app.get(
    "/api/companies/:companyId/compliance/overview",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const hasAccess = await storage.hasCompanyAccess(req.user!.id, companyId);
      if (!hasAccess) throw new DomainError("ACCESS_DENIED", 403, undefined, "Access denied");

      const now = new Date();
      const today = uaeToday(now);
      await ensureGenerated(companyId, now);
      const rows = await listCalendar(companyId, { now });

      const vat = filingStatus(rows, "vat_return", today, 14);
      const ct = filingStatus(rows, "corporate_tax_return", today, 30);

      const documents = await pool.query(
        `SELECT (SELECT COUNT(*) FROM invoices WHERE company_id = $1)::int
              + (SELECT COUNT(*) FROM receipts WHERE company_id = $1)::int AS total`,
        [companyId]
      );
      let withVersionHistory = 0;
      try {
        const versions = await pool.query(
          `SELECT COUNT(DISTINCT (document_type, document_id))::int AS n
             FROM document_versions WHERE company_id = $1`,
          [companyId]
        );
        withVersionHistory = Number(versions.rows[0]?.n) || 0;
      } catch {
        withVersionHistory = 0;
      }

      const auditReadiness = await computeAuditReadiness(companyId, rows, now);

      res.json({
        vatStatus: {
          lastReturn: vat.lastReturn,
          nextDue: vat.nextDue,
          nextPeriodEnd: vat.nextPeriodEnd,
          overdueCount: vat.overdueCount,
          dueInDays: vat.dueInDays,
          filingStatus: vat.state,
        },
        corporateTaxStatus: {
          lastReturn: ct.lastReturn,
          nextDue: ct.nextDue,
          nextPeriodEnd: ct.nextPeriodEnd,
          overdueCount: ct.overdueCount,
          dueInDays: ct.dueInDays,
          status: ct.state,
        },
        documentCompleteness: {
          totalDocuments: Number(documents.rows[0]?.total) || 0,
          withVersionHistory,
        },
        auditReadiness,
        upcomingObligations: rows
          .filter((r) => r.status === "upcoming" || r.status === "overdue")
          .slice(0, 10),
      });
    })
  );
}
