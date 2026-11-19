import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { db, pool } from "../db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { invoices, invoiceLines } from "../../shared/schema";
import type { Invoice, InvoiceLine } from "../../shared/schema";
import { uaeDayStart, uaeDayEnd } from "../utils/date";
import { UAE_VAT_RATE } from "../constants";
import { DomainError } from "../errors";
import {
  buildReportCatalogDiscovery,
  isReportCatalogPersona,
} from "../services/report-catalog.service";
import {
  addMonths,
  agedPayables,
  agedReceivables,
  cashAccounts,
  cashFlow,
  cashFlowBuckets,
  generalLedger,
  monthEnd,
  profitAndLoss,
  readAsOf,
  readRange,
  trialBalance,
  uaeToday,
  type Granularity,
} from "../reporting";
import { assertReportAccess, deprecate, readFormat, sendTabular } from "../reporting/http";
import {
  payableOpenSql,
  payableStatusSql,
  receivableOpenSql,
  receivableStatusSql,
} from "../reporting/settlement";
import { computeVat201, loadVatCompany, type VatComputation } from "../tax/vat-engine";
import { EMIRATE_BOX_PREFIX, type Vat201Key } from "../tax/vat-boxes";
import { periodContaining } from "../tax/vat-periods";
import { EMIRATES } from "../../shared/validators/primitives";
import { requirePermission } from "../middleware/companyRolePolicy";
import { fiscalYearStart, loadCompany } from "../reporting";
import {
  STATEMENT_KINDS,
  computeChangesInEquity,
  computeExecutiveSummary,
  isStatementKind,
  loadRenderCompany,
  renderStatement,
} from "../services/report-render/statements";
import { journalLineText } from "../services/report-render/journal-text";
import { formatIsoDateAr } from "../services/report-render/model";
import {
  buildSharePackZip,
  buildStatementFile,
  withRenderLang,
} from "../services/report-render/pack";
import { buildFaf, renderFafText } from "../services/faf-export.service";

function vatBox1Total(c: VatComputation, suffix: "Amount" | "Vat"): number {
  const fils = EMIRATES.reduce(
    (s, e) => s + c.boxesFils[`${EMIRATE_BOX_PREFIX[e]}${suffix}` as Vat201Key],
    0
  );
  return fils / 100;
}

/**
 * Register advanced report routes (cash flow, aging, period comparison).
 */
export function registerReportRoutes(app: Express) {
  app.get(
    "/api/reports/catalog",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const persona = req.query.persona;
      if (persona !== undefined && !isReportCatalogPersona(persona)) {
        return res.status(400).json({
          message: "persona must be owner, freelancer, or accountant",
          code: "INVALID_PERSONA",
        });
      }

      // S4: the catalog is derived from static code (changes only on deploy),
      // so let the browser cache it briefly — cuts repeat fetches on every
      // dashboard/report-center load. Private (per-user) + short TTL.
      res.set("Cache-Control", "private, max-age=300");
      res.json(
        buildReportCatalogDiscovery({
          persona: isReportCatalogPersona(persona) ? persona : null,
        })
      );
    })
  );

  // =====================================
  // ADVANCED REPORTS
  // =====================================

  // Legacy bucketed cash flow (AdvancedReports, operating-cash-flow comparison
  // metric). Rebuilt on the reporting kernel; accepts from/to (or
  // startDate/endDate) for a custom window, otherwise the historical
  // relative-to-today windows. Canonical statement: /api/companies/:id/reports/cash-flow.
  app.get(
    "/api/reports/:companyId/cash-flow/:period?",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, period: pathPeriod } = req.params;
      const period = String(pathPeriod || req.query.period || "quarter");
      if (!["month", "quarter", "year"].includes(period)) {
        throw new DomainError(
          "INVALID_PERIOD",
          400,
          undefined,
          "period must be month, quarter or year"
        );
      }
      await assertReportAccess(req, companyId);
      deprecate(res, `/api/companies/${companyId}/reports/cash-flow`);
      const today = uaeToday();
      const range = readRange(req.query as Record<string, unknown>, { defaultTo: today });
      let from = range.from;
      if (!from) {
        const y = Number(today.slice(0, 4));
        const m = Number(today.slice(5, 7));
        if (period === "month") from = addMonths(`${today.slice(0, 7)}-01`, -6);
        else if (period === "year") from = `${y - 2}-01-01`;
        else
          from = addMonths(
            `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`,
            -12
          );
      }
      const result = await cashFlowBuckets({
        companyId,
        from,
        to: range.to,
        granularity: period as Granularity,
      });
      res.json(result.buckets);
    })
  );

  // Legacy aging (array of customer/vendor rows). Now reconstructed as of a
  // date (asOf, default today) and rounded per document (R11-07).
  app.get(
    "/api/reports/:companyId/aging",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      deprecate(res, `/api/companies/${companyId}/reports/aged-receivables`);
      const asOf = readAsOf(req.query as Record<string, unknown>);
      const [ar, ap] = await Promise.all([
        agedReceivables({ companyId, asOf }),
        agedPayables({ companyId, asOf }),
      ]);
      res.json([...ar.rows, ...ap.rows]);
    })
  );

  // Canonical aged receivables / payables with GL reconciliation (R11-15).
  for (const kind of ["receivables", "payables"] as const) {
    app.get(
      `/api/companies/:companyId/reports/aged-${kind}`,
      authMiddleware,
      asyncHandler(async (req: Request, res: Response) => {
        const { companyId } = req.params;
        await assertReportAccess(req, companyId);
        const asOf = readAsOf(req.query as Record<string, unknown>);
        const format = readFormat(req.query.format);
        const report =
          kind === "receivables"
            ? await agedReceivables({ companyId, asOf })
            : await agedPayables({ companyId, asOf });
        if (format === "json") return res.json(report);
        await sendTabular(res, format, `aged-${kind}-${asOf}`, [
          {
            sheetName: kind === "receivables" ? "Aged receivables" : "Aged payables",
            columns: [
              { header: "Name", key: "name", width: 30 },
              { header: "Current", key: "current" },
              { header: "1-30", key: "days30" },
              { header: "31-60", key: "days60" },
              { header: "61-90", key: "days90" },
              { header: "90+", key: "over90" },
              { header: "Total (AED)", key: "total" },
            ],
            rows: [
              ...report.rows.map((r) => ({ ...r })),
              { name: "Total", ...report.totals },
              {
                name: `GL control ${report.reconciliation.controlAccountCode ?? ""}`.trim(),
                total: report.reconciliation.glBalance,
              },
              { name: "Difference", total: report.reconciliation.difference },
            ],
          },
        ]);
      })
    );
  }

  // Trial Balance — reporting kernel (R11-02, R11-09). Balance-sheet accounts
  // are cumulative through `to`, income/expense accounts carry [from, to]
  // activity, and prior-period earnings appear as a synthetic "Retained
  // earnings brought forward" row so debits equal credits for any range.
  app.get(
    "/api/companies/:id/reports/trial-balance",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = req.params.id;
      await assertReportAccess(req, companyId);
      const range = readRange(req.query as Record<string, unknown>);
      const format = readFormat(req.query.format);
      const tb = await trialBalance({ companyId, from: range.from, to: range.to });
      if (format === "json") return res.json(tb);
      await sendTabular(res, format, `trial-balance-${range.to}`, [
        {
          sheetName: "Trial Balance",
          columns: [
            { header: "Code", key: "accountCode", width: 10 },
            { header: "Account", key: "accountName", width: 36 },
            { header: "Type", key: "accountType", width: 12 },
            { header: "Debit", key: "totalDebit" },
            { header: "Credit", key: "totalCredit" },
            { header: "Debit balance", key: "debitBalance" },
            { header: "Credit balance", key: "creditBalance" },
          ],
          rows: [
            ...tb.rows.map((r) => ({ ...r })),
            {
              accountName: "Total",
              totalDebit: tb.totals.sumDebits,
              totalCredit: tb.totals.sumCredits,
              debitBalance: tb.totals.sumDebitBalances,
              creditBalance: tb.totals.sumCreditBalances,
            },
          ],
        },
      ]);
    })
  );

  // Current customer/vendor balance summaries (current open balances, not as-of).
  app.get(
    "/api/companies/:id/reports/balance-summaries",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const companyId = req.params.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });

      const [customerResult, vendorResult] = await Promise.all([
        // Open balances use the one settlement rule (server/reporting/settlement.ts, D5c), the
        // same as aged receivables / payables: payments, credit notes, applied customer
        // credits; bill payments and debit-note / prepayment applications on approved bills.
        pool.query(
          `WITH docs AS (
            SELECT i.customer_name, i.currency, i.total, i.due_date,
                   ${receivableOpenSql("i")} AS open, COALESCE(NULLIF(i.exchange_rate, 0), 1) AS fx
              FROM invoices i
             WHERE i.company_id = $1 AND ${receivableStatusSql("i")}
               AND COALESCE(i.invoice_type, 'invoice') <> 'credit_note'
          )
          SELECT
            customer_name,
            currency,
            COUNT(*)::int AS invoice_count,
            COALESCE(SUM(total), 0)::float AS total_invoiced,
            COALESCE(SUM(total - open), 0)::float AS paid_amount,
            COALESCE(SUM(open), 0)::float AS open_balance,
            COALESCE(SUM(open * fx), 0)::float AS open_balance_aed,
            COALESCE(SUM(open) FILTER (WHERE due_date < NOW()), 0)::float AS overdue_balance,
            COALESCE(SUM(open * fx) FILTER (WHERE due_date < NOW()), 0)::float AS overdue_balance_aed,
            MAX(CASE WHEN due_date < NOW() THEN DATE_PART('day', NOW() - due_date) ELSE 0 END)::int
              AS max_days_overdue
          FROM docs
          WHERE open > 0
          GROUP BY customer_name, currency
          ORDER BY open_balance DESC`,
          [companyId]
        ),
        pool.query(
          `WITH docs AS (
            SELECT b.vendor_name, b.currency, COALESCE(b.total_amount, 0) AS total, b.due_date,
                   ${payableOpenSql("b")} AS open, COALESCE(NULLIF(b.exchange_rate, 0), 1) AS fx
              FROM vendor_bills b
             WHERE b.company_id = $1 AND ${payableStatusSql("b")}
          )
          SELECT
            vendor_name,
            currency,
            COUNT(*)::int AS bill_count,
            COALESCE(SUM(total), 0)::float AS total_billed,
            COALESCE(SUM(total - open), 0)::float AS paid_amount,
            COALESCE(SUM(open), 0)::float AS open_balance,
            COALESCE(SUM(open * fx), 0)::float AS open_balance_aed,
            COALESCE(SUM(open) FILTER (WHERE due_date < NOW()), 0)::float AS overdue_balance,
            COALESCE(SUM(open * fx) FILTER (WHERE due_date < NOW()), 0)::float AS overdue_balance_aed,
            MAX(CASE WHEN due_date < NOW() THEN DATE_PART('day', NOW() - due_date) ELSE 0 END)::int
              AS max_days_overdue
          FROM docs
          WHERE open > 0
          GROUP BY vendor_name, currency
          ORDER BY open_balance DESC`,
          [companyId]
        ),
      ]);

      res.json({
        generatedAt: new Date().toISOString(),
        customers: customerResult.rows.map((row) => ({
          name: row.customer_name || "Unknown Customer",
          currency: row.currency || "AED",
          invoiceCount: Number(row.invoice_count) || 0,
          totalInvoiced: Number(row.total_invoiced) || 0,
          paidAmount: Number(row.paid_amount) || 0,
          openBalance: Number(row.open_balance) || 0,
          openBalanceAed: Number(row.open_balance_aed) || 0,
          overdueBalance: Number(row.overdue_balance) || 0,
          overdueBalanceAed: Number(row.overdue_balance_aed) || 0,
          maxDaysOverdue: Number(row.max_days_overdue) || 0,
        })),
        vendors: vendorResult.rows.map((row) => ({
          name: row.vendor_name || "Unknown Vendor",
          currency: row.currency || "AED",
          billCount: Number(row.bill_count) || 0,
          totalBilled: Number(row.total_billed) || 0,
          paidAmount: Number(row.paid_amount) || 0,
          openBalance: Number(row.open_balance) || 0,
          openBalanceAed: Number(row.open_balance_aed) || 0,
          overdueBalance: Number(row.overdue_balance) || 0,
          overdueBalanceAed: Number(row.overdue_balance_aed) || 0,
          maxDaysOverdue: Number(row.max_days_overdue) || 0,
        })),
      });
    })
  );

  // Sales by Product/Service report — groups issued invoice lines by line description.
  app.get(
    "/api/companies/:id/reports/sales-product-service",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = req.user!.id;
      const companyId = req.params.id;
      const { startDate, endDate, from, to } = req.query as {
        startDate?: string;
        endDate?: string;
        from?: string;
        to?: string;
      };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess)
        return res.status(403).json({ message: "Access denied", code: "COMPANY_ACCESS_DENIED" });

      const periodStart = startDate ?? from;
      const periodEnd = endDate ?? to;
      const fromDate = periodStart ? uaeDayStart(periodStart) : undefined;
      const toDate = periodEnd ? uaeDayEnd(periodEnd) : undefined;

      const invoiceRows: Invoice[] = (
        await db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.companyId, companyId),
              fromDate ? gte(invoices.date, fromDate) : undefined,
              toDate ? lte(invoices.date, toDate) : undefined
            )
          )
      ).filter(
        (invoice: Invoice) =>
          invoice.status !== "draft" && invoice.status !== "void" && invoice.status !== "cancelled"
      );

      const invoiceIds = invoiceRows.map((invoice) => invoice.id);
      const lineRows: InvoiceLine[] =
        invoiceIds.length > 0
          ? await db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, invoiceIds))
          : [];
      const invoiceById = new Map(invoiceRows.map((invoice) => [invoice.id, invoice]));
      const groupedRows = new Map<
        string,
        {
          productService: string;
          invoiceIds: Set<string>;
          lineCount: number;
          quantity: number;
          amountAed: number;
          vatAed: number;
          supplyTypes: Set<string>;
        }
      >();

      for (const line of lineRows) {
        const invoice = invoiceById.get(line.invoiceId);
        if (!invoice) continue;

        const productService = line.description.trim().replace(/\s+/g, " ") || "Unlabeled item";
        const exchangeRate = Number(invoice.exchangeRate ?? 1);
        const rate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
        const quantity = Number(line.quantity ?? 0) || 0;
        const unitPrice = Number(line.unitPrice ?? 0) || 0;
        const vatRate = Number(line.vatRate ?? UAE_VAT_RATE) || 0;
        const amountAed = quantity * unitPrice * rate;
        const vatAed = amountAed * vatRate;
        const row = groupedRows.get(productService) ?? {
          productService,
          invoiceIds: new Set<string>(),
          lineCount: 0,
          quantity: 0,
          amountAed: 0,
          vatAed: 0,
          supplyTypes: new Set<string>(),
        };

        row.invoiceIds.add(line.invoiceId);
        row.lineCount += 1;
        row.quantity += quantity;
        row.amountAed += amountAed;
        row.vatAed += vatAed;
        row.supplyTypes.add(line.vatSupplyType ?? "standard_rated");
        groupedRows.set(productService, row);
      }

      const rows = Array.from(groupedRows.values())
        .map((row) => ({
          productService: row.productService,
          invoiceCount: row.invoiceIds.size,
          lineCount: row.lineCount,
          quantity: Math.round(row.quantity * 100) / 100,
          amountAed: Math.round(row.amountAed * 100) / 100,
          vatAed: Math.round(row.vatAed * 100) / 100,
          averageUnitPriceAed:
            row.quantity > 0 ? Math.round((row.amountAed / row.quantity) * 100) / 100 : 0,
          supplyTypes: Array.from(row.supplyTypes).sort(),
        }))
        .sort(
          (a, b) => b.amountAed - a.amountAed || a.productService.localeCompare(b.productService)
        );
      const totalAmountAed = rows.reduce((sum, row) => sum + row.amountAed, 0);

      res.json({
        period: {
          startDate: periodStart ?? null,
          endDate: periodEnd ?? null,
        },
        totals: {
          productServiceCount: rows.length,
          invoiceCount: invoiceRows.length,
          lineCount: lineRows.length,
          quantity: Math.round(rows.reduce((sum, row) => sum + row.quantity, 0) * 100) / 100,
          amountAed: Math.round(totalAmountAed * 100) / 100,
          vatAed: Math.round(rows.reduce((sum, row) => sum + row.vatAed, 0) * 100) / 100,
          topProductServiceShare:
            totalAmountAed > 0 && rows[0]
              ? Math.round((rows[0].amountAed / totalAmountAed) * 10000) / 100
              : 0,
        },
        rows,
      });
    })
  );

  // VAT Return report (UAE). R07-03 / R12-03: the one VAT engine (documents + manual VAT
  // journal adjustments, Box 1 by emirate of supply) with its VAT-to-GL reconciliation.
  app.get(
    "/api/companies/:id/reports/vat-return",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const companyId = req.params.id;
      // R12-05: accept from/to or startDate/endDate.
      const q = req.query as Record<string, string | undefined>;
      const fromQ = q.from ?? q.startDate ?? q.periodStart;
      const toQ = q.to ?? q.endDate ?? q.periodEnd;
      if (!fromQ || !toQ) {
        return res.status(400).json({
          message: "from and to date params are required (YYYY-MM-DD)",
          code: "REPORT_RANGE_REQUIRED",
        });
      }
      const range = readRange({ from: fromQ, to: toQ });
      await assertReportAccess(req, companyId);
      const c = await computeVat201({
        companyId,
        from: range.from!,
        to: range.to,
        allowIncomplete: true,
      });
      const b = c.boxes;
      const standard = vatBox1Total(c, "Amount");
      res.json({
        period: { from: range.from, to: range.to },
        engineVersion: c.engineVersion,
        // Legacy summary keys (kept for existing clients), now engine-backed.
        box1_standardRatedSupplies: standard,
        box2_zeroRatedSupplies: b.box4ZeroRatedAmount,
        box3_exemptSupplies: b.box5ExemptAmount,
        box4_totalSupplies:
          Math.round((standard + b.box4ZeroRatedAmount + b.box5ExemptAmount) * 100) / 100,
        box5_outputVat: b.box12TotalDueTax,
        box6_standardRatedExpenses: b.box9ExpensesAmount,
        box7_inputVatRecoverable: b.box13RecoverableTax,
        box8_netVatDue: b.box14PayableTax,
        boxes: b,
        issues: c.issues,
        complete: c.complete,
        excluded: { outOfScopeAmount: c.excluded.outOfScopeFils / 100 },
        reconciliation: c.reconciliation,
      });
    })
  );

  // VAT summary (dashboard / reports centre). W2-B carry-over: accepts from/to or
  // startDate/endDate, reads the VAT engine (so ledger-only VAT journals count) and returns
  // the reconciliation. Without a start date it covers the tax period containing `to`.
  app.get(
    "/api/companies/:companyId/reports/vat-summary",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const range = readRange(req.query as Record<string, unknown>);
      let from = range.from;
      if (!from) {
        const company = await loadVatCompany(companyId);
        from = periodContaining(range.to, company.frequency, company.startMonth).from;
      }
      const c = await computeVat201({ companyId, from, to: range.to, allowIncomplete: true });
      const b = c.boxes;
      const salesSubtotal =
        Math.round((vatBox1Total(c, "Amount") + b.box4ZeroRatedAmount + b.box5ExemptAmount) * 100) /
        100;
      res.json({
        reportCurrency: "AED",
        period: { from, to: range.to },
        salesSubtotal,
        salesVAT: b.box12TotalDueTax,
        purchasesSubtotal: b.box11TotalAmount,
        purchasesVAT: b.box13RecoverableTax,
        netVATPayable: b.box14PayableTax,
        boxes: b,
        issues: c.issues,
        reconciliation: {
          hasUnexplainedDifference: c.reconciliation.hasUnexplainedDifference,
          ...c.reconciliation.aed,
        },
      });
    })
  );

  // ── Period comparison on the ledger (R11-03 / R12-02) ──────────────────────

  async function invoiceStats(companyId: string, from: string | null, to: string) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n,
              COALESCE(SUM(ROUND(subtotal * COALESCE(NULLIF(exchange_rate, 0), 1) * 100)), 0)::bigint AS v
         FROM invoices
        WHERE company_id = $1
          AND status NOT IN ('draft', 'void', 'cancelled')
          AND ($2::date IS NULL OR ((date + interval '4 hours')::date) >= $2::date)
          AND ((date + interval '4 hours')::date) <= $3::date`,
      [companyId, from, to]
    );
    return { count: Number(r.rows[0]?.n) || 0, valueFils: Number(r.rows[0]?.v) || 0 };
  }

  function metric(name: string, current: number, previous: number) {
    const cf = Math.round(current * 100);
    const pf = Math.round(previous * 100);
    return {
      metric: name,
      current,
      previous,
      change: (cf - pf) / 100,
      changePercent: pf ? Math.round(((cf - pf) / Math.abs(pf)) * 10000) / 100 : 0,
    };
  }

  async function buildComparison(
    companyId: string,
    current: { from: string; to: string },
    compareTo: "prior_period" | "prior_year" | "budget",
    budgetId?: string | null
  ) {
    const pl = await profitAndLoss({
      companyId,
      from: current.from,
      to: current.to,
      compareTo,
      budgetId: budgetId ?? null,
    });
    const cmp = pl.comparison!;
    const [ci, pi] = await Promise.all([
      invoiceStats(companyId, current.from, current.to),
      compareTo === "budget"
        ? Promise.resolve({ count: 0, valueFils: 0 })
        : invoiceStats(companyId, cmp.from, cmp.to),
    ]);
    const avg = (s: { count: number; valueFils: number }) =>
      s.count ? Math.round(s.valueFils / s.count) / 100 : 0;
    return {
      reportCurrency: "AED",
      basis: compareTo,
      current: { from: current.from, to: current.to, ...pickTotals(pl) },
      previous: { from: cmp.from, to: cmp.to, label: cmp.label, ...cmp.totals },
      variance: cmp.variance,
      metrics: [
        metric("Total Revenue", pl.totalIncome, cmp.totals.totalIncome),
        metric("Total Expenses", pl.totalExpenses, cmp.totals.totalExpenses),
        metric("Net Profit", pl.netProfit, cmp.totals.netProfit),
        metric("Invoice Count", ci.count, pi.count),
        metric("Avg Invoice Value", avg(ci), avg(pi)),
      ],
    };
  }

  function pickTotals(pl: PlTotalsLike) {
    return {
      revenue: pl.revenue,
      costOfSales: pl.costOfSales,
      grossProfit: pl.grossProfit,
      operatingExpenses: pl.operatingExpenses,
      operatingProfit: pl.operatingProfit,
      otherIncome: pl.otherIncome,
      otherExpenses: pl.otherExpenses,
      totalIncome: pl.totalIncome,
      totalExpenses: pl.totalExpenses,
      netProfit: pl.netProfit,
    };
  }

  function readCompareTo(value: unknown, fallback: "prior_period" | "prior_year") {
    if (value === undefined || value === "") return fallback;
    if (value === "prior_period" || value === "prior_year" || value === "budget") return value;
    throw new DomainError(
      "INVALID_COMPARE_TO",
      400,
      undefined,
      "compareTo must be prior_period, prior_year or budget"
    );
  }

  /** Current calendar month/quarter/year window (UAE) for the legacy endpoint. */
  function currentWindow(period: string): { from: string; to: string } {
    const today = uaeToday();
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    if (period === "month") return { from: `${today.slice(0, 7)}-01`, to: monthEnd(today) };
    if (period === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
    const qm = Math.floor((m - 1) / 3) * 3 + 1;
    const from = `${y}-${String(qm).padStart(2, "0")}-01`;
    return { from, to: monthEnd(addMonths(from, 2)) };
  }

  // Canonical: GET /api/companies/:companyId/reports/comparison?from&to&compareTo&budgetId
  app.get(
    "/api/companies/:companyId/reports/comparison",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const range = readRange(req.query as Record<string, unknown>, { requireFrom: true });
      const compareTo = readCompareTo(req.query.compareTo, "prior_period");
      res.json(
        await buildComparison(
          companyId,
          { from: range.from!, to: range.to },
          compareTo,
          typeof req.query.budgetId === "string" ? req.query.budgetId : null
        )
      );
    })
  );

  // Legacy: GET /api/reports/:companyId/comparison/:period? -> metric rows array.
  app.get(
    "/api/reports/:companyId/comparison/:period?",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, period: pathPeriod } = req.params;
      const period = String(pathPeriod || req.query.period || "quarter");
      if (!["month", "quarter", "year"].includes(period)) {
        throw new DomainError(
          "INVALID_PERIOD",
          400,
          undefined,
          "period must be month, quarter or year"
        );
      }
      await assertReportAccess(req, companyId);
      deprecate(res, `/api/companies/${companyId}/reports/comparison`);
      const custom = readRange(req.query as Record<string, unknown>, { defaultTo: uaeToday() });
      const window = custom.from ? { from: custom.from, to: custom.to } : currentWindow(period);
      const compareTo = readCompareTo(
        req.query.compareTo,
        period === "year" ? "prior_year" : "prior_period"
      );
      const result = await buildComparison(companyId, window, compareTo);
      res.json(result.metrics);
    })
  );

  // ── Canonical statements (R12-05) ──────────────────────────────────────────

  app.get(
    "/api/companies/:companyId/reports/profit-loss",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const range = readRange(req.query as Record<string, unknown>);
      const columns = req.query.columns;
      if (columns !== undefined && !["total", "monthly", "quarterly"].includes(String(columns))) {
        throw new DomainError(
          "INVALID_COLUMNS",
          400,
          undefined,
          "columns must be total, monthly or quarterly"
        );
      }
      const compareTo =
        req.query.compareTo === undefined || req.query.compareTo === ""
          ? null
          : readCompareTo(req.query.compareTo, "prior_period");
      const format = readFormat(req.query.format);
      const pl = await profitAndLoss({
        companyId,
        from: range.from,
        to: range.to,
        compareTo,
        budgetId: typeof req.query.budgetId === "string" ? req.query.budgetId : null,
        columns: (columns as "total" | "monthly" | "quarterly" | undefined) ?? "total",
      });
      if (format === "json") return res.json(pl);
      const rows: Record<string, unknown>[] = [];
      const add = (
        label: string,
        sectionLines: {
          accountCode: string;
          accountName: string;
          amount: number;
          accountId: string;
        }[],
        total: number
      ) => {
        rows.push({ account: label.toUpperCase() });
        for (const l of sectionLines)
          rows.push({
            code: l.accountCode,
            account: l.accountName,
            amount: l.amount,
            comparison: pl.comparison ? (pl.comparison.byAccount[l.accountId] ?? 0) : undefined,
          });
        rows.push({ account: `Total ${label}`, amount: total });
      };
      add("Revenue", pl.sections.revenue.lines, pl.revenue);
      add("Cost of sales", pl.sections.costOfSales.lines, pl.costOfSales);
      rows.push({
        account: "GROSS PROFIT",
        amount: pl.grossProfit,
        comparison: pl.comparison?.totals.grossProfit,
      });
      add("Operating expenses", pl.sections.operatingExpenses.lines, pl.operatingExpenses);
      add("Other income", pl.sections.otherIncome.lines, pl.otherIncome);
      add("Other expenses", pl.sections.otherExpenses.lines, pl.otherExpenses);
      rows.push({
        account: "PROFIT BEFORE TAX",
        amount: pl.profitBeforeTax,
        comparison: pl.comparison?.totals.profitBeforeTax,
      });
      add("Income tax expense", pl.sections.incomeTax.lines, pl.incomeTaxExpense);
      rows.push({
        account: "NET PROFIT",
        amount: pl.netProfit,
        comparison: pl.comparison?.totals.netProfit,
      });
      await sendTabular(res, format, `profit-loss-${range.to}`, [
        {
          sheetName: "Profit & Loss",
          columns: [
            { header: "Code", key: "code", width: 10 },
            { header: "Account", key: "account", width: 36 },
            { header: "Amount (AED)", key: "amount" },
            ...(pl.comparison ? [{ header: pl.comparison.label, key: "comparison" }] : []),
          ],
          rows,
        },
      ]);
    })
  );

  app.get(
    "/api/companies/:companyId/reports/cash-flow",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const range = readRange(req.query as Record<string, unknown>);
      const method = req.query.method ?? "indirect";
      if (method !== "indirect" && method !== "direct") {
        throw new DomainError(
          "INVALID_METHOD",
          400,
          undefined,
          "method must be indirect or direct"
        );
      }
      res.json(await cashFlow({ companyId, from: range.from, to: range.to, method }));
    })
  );

  app.get(
    "/api/companies/:companyId/reports/cash-accounts",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const asOf = readAsOf(req.query as Record<string, unknown>);
      res.json({ asOf, accounts: await cashAccounts(companyId, asOf) });
    })
  );

  // General ledger across all (or selected) accounts, JSON / xlsx / csv (R11-16, R02-20).
  const glHandler = asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;
    await assertReportAccess(req, companyId);
    const range = readRange(req.query as Record<string, unknown>);
    const raw = req.query.accountIds ?? req.query.accountId;
    const accountIds = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [])
      .map((s) => String(s).trim())
      .filter(Boolean);
    if (accountIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
      throw new DomainError("INVALID_ACCOUNT_ID", 400);
    }
    const format = req.path.endsWith("/export")
      ? readFormat(req.query.format ?? "xlsx")
      : readFormat(req.query.format);
    const gl = await generalLedger({
      companyId,
      from: range.from,
      to: range.to,
      accountIds,
      includeClosing: req.query.includeClosing === "true",
    });
    if (format === "json") return res.json(gl);
    // `lang=ar|en`; absent means the language of the company (the same default as the PDF/XLSX
    // statements). Arabic renders system lines from their stored keys, with Arabic dates/headings.
    const lang = readOutputLang(req.query.lang) ?? (await loadRenderCompany(companyId)).locale;
    const ar = lang === "ar";
    const rows: Record<string, unknown>[] = [];
    for (const a of gl.accounts) {
      const accountName = ar && a.accountNameAr ? a.accountNameAr : a.accountName;
      const account = `${a.accountCode} ${accountName}`.trim();
      rows.push({
        account,
        description: ar ? "الرصيد الافتتاحي" : "Opening balance",
        balance: a.openingBalance,
      });
      for (const l of a.lines) {
        rows.push({
          date: ar ? formatIsoDateAr(l.date) : l.date,
          account,
          entryNumber: l.entryNumber,
          description: journalLineText(
            lang,
            { description: l.description || null, lineKey: l.lineKey, lineParams: l.lineParams },
            l
          ),
          debit: l.debit,
          credit: l.credit,
          balance: l.balance,
        });
      }
      rows.push({
        account,
        description: ar ? "الرصيد الختامي" : "Closing balance",
        debit: a.debitTotal,
        credit: a.creditTotal,
        balance: a.closingBalance,
      });
    }
    await sendTabular(res, format, `general-ledger-${range.from ?? "inception"}-${range.to}`, [
      {
        sheetName: ar ? "دفتر الأستاذ العام" : "General Ledger",
        columns: [
          { header: ar ? "التاريخ" : "Date", key: "date", width: 12 },
          { header: ar ? "الحساب" : "Account", key: "account", width: 32 },
          { header: ar ? "القيد" : "Entry", key: "entryNumber", width: 18 },
          { header: ar ? "البيان" : "Description", key: "description", width: 36 },
          { header: ar ? "مدين" : "Debit", key: "debit" },
          { header: ar ? "دائن" : "Credit", key: "credit" },
          { header: ar ? "الرصيد" : "Balance", key: "balance" },
        ],
        rows,
      },
    ]);
  });
  app.get("/api/companies/:companyId/reports/general-ledger", authMiddleware, glHandler);
  app.get("/api/companies/:companyId/reports/general-ledger/export", authMiddleware, glHandler);

  // R12-05 alias: /api/reports/:companyId/vat-summary -> canonical company route.
  app.get(
    "/api/reports/:companyId/vat-summary",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const range = readRange(req.query as Record<string, unknown>);
      const qs = new URLSearchParams();
      if (range.from) qs.set("startDate", range.from);
      qs.set("endDate", range.to);
      const target = `/api/companies/${companyId}/reports/vat-summary?${qs.toString()}`;
      deprecate(res, target);
      res.redirect(307, target);
    })
  );

  registerReportOutputRoutes(app);
}

// ─── W5-A: server-rendered statement outputs, equity, executive summary, FAF ──
// (R11-12, R12-09, R12-08a). New endpoints only; the handlers above are unchanged.

async function outputRange(req: Request, companyId: string): Promise<{ from: string; to: string }> {
  const range = readRange(req.query as Record<string, unknown>);
  if (range.from) return { from: range.from, to: range.to };
  const settings = await loadCompany(companyId);
  return { from: fiscalYearStart(range.to, settings.fiscalYearStartMonth), to: range.to };
}

function sendFile(res: Response, file: { filename: string; contentType: string; content: Buffer }) {
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(file.content);
}

function readOutputFormat(value: unknown): "pdf" | "xlsx" | "json" {
  if (value === undefined || value === "" || value === "pdf") return "pdf";
  if (value === "xlsx" || value === "json") return value;
  throw new DomainError(
    "INVALID_EXPORT_FORMAT",
    400,
    undefined,
    "format must be pdf, xlsx or json"
  );
}

/** `?lang=ar|en`: the language of a rendered PDF/XLSX; absent means the company's own (E3). */
function readOutputLang(value: unknown): "ar" | "en" | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "ar" || value === "en") return value;
  throw new DomainError("INVALID_EXPORT_LANG", 400, undefined, "lang must be ar or en");
}

function registerReportOutputRoutes(app: Express) {
  // One statement as a branded PDF (default) or XLSX: profit-loss, balance-sheet,
  // trial-balance, cash-flow, general-ledger, ar-aging, ap-aging, changes-in-equity,
  // executive-summary, vat-summary.
  app.get(
    "/api/companies/:companyId/reports/statements/:kind",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, kind } = req.params;
      if (!isStatementKind(kind)) {
        throw new DomainError(
          "UNKNOWN_STATEMENT",
          404,
          { kind, allowed: STATEMENT_KINDS },
          "Unknown statement"
        );
      }
      const format = readOutputFormat(req.query.format);
      const lang = readOutputLang(req.query.lang);
      const period = await outputRange(req, companyId);
      if (format === "json") {
        const company = withRenderLang(await loadRenderCompany(companyId), lang);
        return res.json(await renderStatement(kind, company, period));
      }
      sendFile(res, await buildStatementFile({ companyId, kind, period, format, lang }));
    })
  );

  app.get(
    "/api/companies/:companyId/reports/changes-in-equity",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      res.json(await computeChangesInEquity(companyId, await outputRange(req, companyId)));
    })
  );

  app.get(
    "/api/companies/:companyId/reports/executive-summary",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      res.json(await computeExecutiveSummary(companyId, await outputRange(req, companyId)));
    })
  );

  // Accountant share pack: every statement as PDF + XLSX for the period, zipped.
  app.get(
    "/api/companies/:companyId/reports/share-pack",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const zip = await buildSharePackZip({
        companyId,
        period: await outputRange(req, companyId),
        lang: readOutputLang(req.query.lang),
      });
      sendFile(res, zip);
    })
  );

  // FTA Audit File. Generated for upload/inspection — not transmitted to FTA.
  app.get(
    "/api/companies/:companyId/reports/faf",
    authMiddleware,
    requirePermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const range = readRange(req.query as Record<string, unknown>, { requireFrom: true });
      const faf = await buildFaf({ companyId, from: range.from!, to: range.to });
      res.setHeader("X-FAF-Notice", "Generated for upload/inspection - not transmitted to FTA");
      if (req.query.format === "json") return res.json(faf);
      if (
        req.query.format !== undefined &&
        req.query.format !== "txt" &&
        req.query.format !== "csv"
      ) {
        throw new DomainError(
          "INVALID_EXPORT_FORMAT",
          400,
          undefined,
          "format must be txt or json"
        );
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="FAF-${(faf.company.trn || "no-trn").replace(/[^0-9A-Za-z]/g, "")}-${range.from}-${range.to}.csv"`
      );
      res.send(renderFafText(faf));
    })
  );
}

type PlTotalsLike = {
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingProfit: number;
  otherIncome: number;
  otherExpenses: number;
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
};
