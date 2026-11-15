import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { db, pool } from "../db";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { invoices, invoiceLines, receipts } from "../../shared/schema";
import type { Invoice, InvoiceLine, Receipt } from "../../shared/schema";
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
        return res
          .status(400)
          .json({ message: "persona must be owner, freelancer, or accountant" });
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

  // Current customer/vendor balance summaries. These are current open balances,
  // not historical as-of balances: vendor bills store only current amount_paid.
  app.get(
    "/api/companies/:id/reports/balance-summaries",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const [customerResult, vendorResult] = await Promise.all([
        pool.query(
          `WITH payments AS (
            SELECT invoice_id, COALESCE(SUM(amount), 0) AS paid_amount
            FROM invoice_payments
            WHERE company_id = $1
            GROUP BY invoice_id
          )
          SELECT
            i.customer_name,
            i.currency,
            COUNT(*)::int AS invoice_count,
            COALESCE(SUM(i.total), 0)::float AS total_invoiced,
            COALESCE(SUM(COALESCE(p.paid_amount, 0)), 0)::float AS paid_amount,
            COALESCE(SUM(GREATEST(i.total - COALESCE(p.paid_amount, 0), 0)), 0)::float AS open_balance,
            COALESCE(SUM(GREATEST(i.total - COALESCE(p.paid_amount, 0), 0) * COALESCE(NULLIF(i.exchange_rate, 0), 1)), 0)::float AS open_balance_aed,
            COALESCE(SUM(GREATEST(i.total - COALESCE(p.paid_amount, 0), 0)) FILTER (WHERE i.due_date < NOW()), 0)::float AS overdue_balance,
            COALESCE(SUM(GREATEST(i.total - COALESCE(p.paid_amount, 0), 0) * COALESCE(NULLIF(i.exchange_rate, 0), 1)) FILTER (WHERE i.due_date < NOW()), 0)::float AS overdue_balance_aed,
            MAX(CASE
              WHEN i.due_date < NOW()
                AND GREATEST(i.total - COALESCE(p.paid_amount, 0), 0) > 0
              THEN DATE_PART('day', NOW() - i.due_date)
              ELSE 0
            END)::int AS max_days_overdue
          FROM invoices i
          LEFT JOIN payments p ON p.invoice_id = i.id
          WHERE i.company_id = $1
            AND i.status NOT IN ('paid', 'draft', 'void', 'cancelled')
            AND GREATEST(i.total - COALESCE(p.paid_amount, 0), 0) > 0
          GROUP BY i.customer_name, i.currency
          ORDER BY open_balance DESC`,
          [companyId]
        ),
        pool.query(
          `SELECT
            vendor_name,
            currency,
            COUNT(*)::int AS bill_count,
            COALESCE(SUM(total_amount), 0)::float AS total_billed,
            COALESCE(SUM(amount_paid), 0)::float AS paid_amount,
            COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)), 0)::float AS open_balance,
            COALESCE(SUM(GREATEST(total_amount - amount_paid, 0) * COALESCE(NULLIF(exchange_rate, 0), 1)), 0)::float AS open_balance_aed,
            COALESCE(SUM(GREATEST(total_amount - amount_paid, 0)) FILTER (WHERE due_date < NOW()), 0)::float AS overdue_balance,
            COALESCE(SUM(GREATEST(total_amount - amount_paid, 0) * COALESCE(NULLIF(exchange_rate, 0), 1)) FILTER (WHERE due_date < NOW()), 0)::float AS overdue_balance_aed,
            MAX(CASE
              WHEN due_date < NOW() AND GREATEST(total_amount - amount_paid, 0) > 0
              THEN DATE_PART('day', NOW() - due_date)
              ELSE 0
            END)::int AS max_days_overdue
          FROM vendor_bills
          WHERE company_id = $1
            AND status NOT IN ('paid')
            AND GREATEST(total_amount - amount_paid, 0) > 0
          GROUP BY vendor_name, currency
          ORDER BY open_balance DESC`,
          [companyId]
        ),
      ]);

      res.json({
        generatedAt: new Date().toISOString(),
        customers: customerResult.rows.map((row: any) => ({
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
        vendors: vendorResult.rows.map((row: any) => ({
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
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      const { startDate, endDate, from, to } = req.query as {
        startDate?: string;
        endDate?: string;
        from?: string;
        to?: string;
      };

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

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

  // VAT Return report (UAE)
  app.get(
    "/api/companies/:id/reports/vat-return",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const companyId = req.params.id;
      // R12-05: accept from/to or startDate/endDate.
      const q = req.query as Record<string, string | undefined>;
      const from = q.from ?? q.startDate ?? q.periodStart;
      const to = q.to ?? q.endDate ?? q.periodEnd;

      if (!from || !to) {
        return res
          .status(400)
          .json({ message: "from and to date params are required (YYYY-MM-DD)" });
      }
      readRange({ from, to });

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) return res.status(403).json({ message: "Access denied" });

      const fromDate = uaeDayStart(from);
      const toDate = uaeDayEnd(to);

      // Get all invoices in range — exclude drafts (not issued), voids, and
      // cancelled invoices so the VAT return only reports real supplies.
      const periodInvoices: Invoice[] = (
        await db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.companyId, companyId),
              gte(invoices.date, fromDate),
              lte(invoices.date, toDate)
            )
          )
      ).filter(
        (inv: Invoice) =>
          inv.status !== "draft" && inv.status !== "void" && inv.status !== "cancelled"
      );

      const invoiceIds = periodInvoices.map((i: Invoice) => i.id);

      const allLines: InvoiceLine[] =
        invoiceIds.length > 0
          ? await db.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, invoiceIds))
          : [];

      let standardRatedSupplies = 0;
      let zeroRatedSupplies = 0;
      let exemptSupplies = 0;

      // Build invoice lookup for exchange rates
      const invoiceRateMap = new Map<string, number>();
      for (const inv of periodInvoices) {
        invoiceRateMap.set(inv.id, inv.exchangeRate ?? 1);
      }

      for (const line of allLines) {
        // Convert line amounts to AED using the parent invoice's exchange rate
        const rate = invoiceRateMap.get(line.invoiceId) ?? 1;
        const lineTotal = line.quantity * line.unitPrice * rate;
        const supplyType = line.vatSupplyType ?? "standard_rated";
        if (supplyType === "zero_rated") {
          zeroRatedSupplies += lineTotal;
        } else if (supplyType === "exempt") {
          exemptSupplies += lineTotal;
        } else {
          // standard_rated and out_of_scope treated as standard for Box 1
          standardRatedSupplies += lineTotal;
        }
      }

      const outputVat = standardRatedSupplies * UAE_VAT_RATE;

      // Get expenses (receipts) in range with VAT.
      // Only posted receipts can be claimed for input VAT recovery.
      const periodReceipts: Receipt[] = (
        await db
          .select()
          .from(receipts)
          .where(
            and(
              eq(receipts.companyId, companyId),
              gte(receipts.date, fromDate),
              lte(receipts.date, toDate)
            )
          )
      ).filter((r: Receipt) => r.posted === true);

      const standardRatedExpenses = periodReceipts.reduce((s: number, r: Receipt) => {
        const rate = r.exchangeRate ?? 1;
        // receipts.amount is the net subtotal (excludes VAT); see convention
        // documented in receipts.routes.ts. Use it directly as the VAT base.
        return s + (r.amount ?? 0) * rate;
      }, 0);

      const inputVat = periodReceipts.reduce((s: number, r: Receipt) => {
        const rate = r.exchangeRate ?? 1;
        return s + (r.vatAmount ?? 0) * rate;
      }, 0);

      const billVatRes = await pool.query(
        `SELECT
           COALESCE(SUM(subtotal * COALESCE(exchange_rate, 1)), 0) AS subtotal,
           COALESCE(SUM(vat_amount * COALESCE(exchange_rate, 1)), 0) AS vat
         FROM vendor_bills
         WHERE company_id = $1
           AND bill_date >= $2::date
           AND bill_date <= $3::date
           AND status NOT IN ('void', 'cancelled', 'draft', 'pending')
           AND COALESCE(reverse_charge, false) = false`,
        [companyId, from, to]
      );
      const approvedBillExpenses = Number(billVatRes.rows[0]?.subtotal || 0);
      const approvedBillInputVat = Number(billVatRes.rows[0]?.vat || 0);

      const totalSupplies = standardRatedSupplies + zeroRatedSupplies + exemptSupplies;
      const totalStandardRatedExpenses = standardRatedExpenses + approvedBillExpenses;
      const totalInputVat = inputVat + approvedBillInputVat;
      const netVatDue = outputVat - totalInputVat;

      res.json({
        period: { from, to },
        box1_standardRatedSupplies: standardRatedSupplies,
        box2_zeroRatedSupplies: zeroRatedSupplies,
        box3_exemptSupplies: exemptSupplies,
        box4_totalSupplies: totalSupplies,
        box5_outputVat: outputVat,
        box6_standardRatedExpenses: totalStandardRatedExpenses,
        box7_inputVatRecoverable: totalInputVat,
        box8_netVatDue: netVatDue,
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
    const rows: Record<string, unknown>[] = [];
    for (const a of gl.accounts) {
      rows.push({
        account: `${a.accountCode} ${a.accountName}`.trim(),
        description: "Opening balance",
        balance: a.openingBalance,
      });
      for (const l of a.lines) {
        rows.push({
          date: l.date,
          account: `${a.accountCode} ${a.accountName}`.trim(),
          entryNumber: l.entryNumber,
          description: l.description || l.memo || "",
          debit: l.debit,
          credit: l.credit,
          balance: l.balance,
        });
      }
      rows.push({
        account: `${a.accountCode} ${a.accountName}`.trim(),
        description: "Closing balance",
        debit: a.debitTotal,
        credit: a.creditTotal,
        balance: a.closingBalance,
      });
    }
    await sendTabular(res, format, `general-ledger-${range.from ?? "inception"}-${range.to}`, [
      {
        sheetName: "General Ledger",
        columns: [
          { header: "Date", key: "date", width: 12 },
          { header: "Account", key: "account", width: 32 },
          { header: "Entry", key: "entryNumber", width: 18 },
          { header: "Description", key: "description", width: 36 },
          { header: "Debit", key: "debit" },
          { header: "Credit", key: "credit" },
          { header: "Balance", key: "balance" },
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
