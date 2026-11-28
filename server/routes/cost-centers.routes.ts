import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireFeature } from "../middleware/featureGate";
import { storage } from "../storage";
import { db, pool } from "../db";
import { journalLines, journalEntries, accounts, costCenters } from "../../shared/schema";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";
import { uaeDayEnd, uaeDayStart } from "../utils/date";
import { createLogger } from "../config/logger";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { resolve } from "../platform/service-registry";
import type { tagBillLines } from "../services/bill-payment.service";
import {
  ENTRY_LOCAL_DATE_SQL,
  NOT_CLOSING_SQL,
  parseReportDate,
  profitAndLoss,
} from "../reporting";
import { fromFils } from "../../shared/money";
import {
  createCostCenterBody,
  tagDocumentLinesBody,
  updateCostCenterBody,
  type CreateCostCenterBody,
  type TagDocumentLinesBody,
  type UpdateCostCenterBody,
} from "../../shared/validators/cost-centers";

const logger = createLogger("cost-centers-routes");

export const UNALLOCATED_ROW_ID = "unallocated";
const MONTH_COLUMNS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

async function assertAccess(req: Request, companyId: string): Promise<void> {
  const ok = await storage.hasCompanyAccess(req.user!.id, companyId);
  if (!ok) throw new DomainError("COMPANY_ACCESS_DENIED", 403, undefined, "Access denied");
}

async function loadCenter(req: Request) {
  const cc = await storage.getCostCenter(req.params.id);
  if (!cc) throw new DomainError("COST_CENTER_NOT_FOUND", 404, undefined, "Cost center not found");
  await assertAccess(req, cc.companyId);
  return cc;
}

/** Parent must be the company's and must not create a cycle. */
async function assertParent(
  companyId: string,
  selfId: string | null,
  parentId: string | null | undefined
) {
  if (!parentId) return;
  if (parentId === selfId)
    throw new DomainError(
      "COST_CENTER_CYCLE",
      422,
      undefined,
      "A cost centre cannot be its own parent"
    );
  const all = await storage.getCostCentersByCompanyId(companyId);
  const byId = new Map(all.map((c) => [c.id, c]));
  if (!byId.has(parentId)) throw new DomainError("COST_CENTER_NOT_FOUND", 422, { parentId });
  let cur: string | null | undefined = parentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === selfId || seen.has(cur)) {
      throw new DomainError(
        "COST_CENTER_CYCLE",
        422,
        undefined,
        "That parent would create a cycle"
      );
    }
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
}

interface PlRow {
  costCenterId: string;
  code: string;
  name: string;
  nameAr: string | null;
  type: string;
  parentId: string | null;
  depth: number;
  isActive: boolean;
  isUnallocated?: boolean;
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  lineCount: number;
  rollup?: { totalIncome: number; totalExpenses: number; netIncome: number };
  budget?: { income: number; expenses: number; netIncome: number; expenseVariance: number };
}

/**
 * Cost-centre P&L in integer fils from the reporting kernel's ledger rules (posted, closing
 * entries excluded, UAE dates). Lines without a cost centre form the "Unallocated" row so the
 * totals equal the company P&L (R10-10); parents carry a roll-up of their descendants (R10-18).
 */
async function costCenterProfitability(
  companyId: string,
  from: string | null,
  to: string | null,
  budgetId: string | null
) {
  const [centers, lineRes] = await Promise.all([
    storage.getCostCentersByCompanyId(companyId),
    pool.query(
      `SELECT jl.cost_center_id, a.type,
              COALESCE(SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100)), 0)::bigint AS net_credit,
              COUNT(*)::int AS n
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
        WHERE je.company_id = $1 AND je.status = 'posted'
          AND a.type IN ('income', 'expense')
          AND ($2::date IS NULL OR ${ENTRY_LOCAL_DATE_SQL} >= $2::date)
          AND ($3::date IS NULL OR ${ENTRY_LOCAL_DATE_SQL} <= $3::date)
          AND ${NOT_CLOSING_SQL}
        GROUP BY jl.cost_center_id, a.type`,
      [companyId, from, to]
    ),
  ]);
  const agg = new Map<string, { income: number; expense: number; n: number }>();
  for (const r of lineRes.rows as Array<{
    cost_center_id: string | null;
    type: string;
    net_credit: string;
    n: number;
  }>) {
    const key = r.cost_center_id ?? UNALLOCATED_ROW_ID;
    const e = agg.get(key) ?? { income: 0, expense: 0, n: 0 };
    const v = Number(r.net_credit);
    if (r.type === "income") e.income += v;
    else e.expense -= v;
    e.n += Number(r.n);
    agg.set(key, e);
  }
  const byId = new Map(centers.map((c) => [c.id, c]));
  const depthOf = (id: string): number => {
    let d = 0;
    let p = byId.get(id)?.parentId ?? null;
    const seen = new Set<string>();
    while (p && byId.has(p) && !seen.has(p)) {
      seen.add(p);
      d++;
      p = byId.get(p)?.parentId ?? null;
    }
    return d;
  };
  // Budgets by cost centre (budget plans / lines tagged with the centre, months in range).
  const budget = new Map<string, { income: number; expense: number }>();
  if (budgetId) {
    const b = await pool.query(
      `SELECT bl.*, COALESCE(bl.cost_center_id, bp.cost_center_id) AS cc, a.type AS account_type,
              EXTRACT(YEAR FROM bp.start_date)::int AS y
         FROM budget_lines bl
         JOIN budget_plans bp ON bp.id = bl.budget_id
         LEFT JOIN accounts a ON a.id = bl.account_id
        WHERE bp.id = $1 AND bp.company_id = $2`,
      [budgetId, companyId]
    );
    if (!b.rows.length) {
      const exists = await pool.query(
        `SELECT 1 FROM budget_plans WHERE id = $1 AND company_id = $2`,
        [budgetId, companyId]
      );
      if (!exists.rows.length) throw new DomainError("BUDGET_NOT_FOUND", 404);
    }
    for (const r of b.rows as Array<Record<string, string | number | null>>) {
      const key = (r.cc as string | null) ?? UNALLOCATED_ROW_ID;
      const y = Number(r.y);
      let sumFils = 0;
      MONTH_COLUMNS.forEach((col, i) => {
        const iso = `${y}-${String(i + 1).padStart(2, "0")}-15`;
        if ((from && iso < from.slice(0, 7) + "-01") || (to && iso.slice(0, 7) > to.slice(0, 7)))
          return;
        sumFils += Math.round(Number(r[col] ?? 0) * 100);
      });
      const e = budget.get(key) ?? { income: 0, expense: 0 };
      if (r.account_type === "income") e.income += sumFils;
      else e.expense += sumFils;
      budget.set(key, e);
    }
  }
  const money = (fils: number) => Number(fromFils(fils));
  const rowFor = (
    id: string,
    base: Omit<PlRow, "totalIncome" | "totalExpenses" | "netIncome" | "lineCount">
  ): PlRow => {
    const a = agg.get(id) ?? { income: 0, expense: 0, n: 0 };
    const row: PlRow = {
      ...base,
      totalIncome: money(a.income),
      totalExpenses: money(a.expense),
      netIncome: money(a.income - a.expense),
      lineCount: a.n,
    };
    const bud = budget.get(id);
    if (budgetId) {
      const bi = bud?.income ?? 0;
      const be = bud?.expense ?? 0;
      row.budget = {
        income: money(bi),
        expenses: money(be),
        netIncome: money(bi - be),
        expenseVariance: money(a.expense - be),
      };
    }
    return row;
  };
  const rows: PlRow[] = centers.map((c) =>
    rowFor(c.id, {
      costCenterId: c.id,
      code: c.code,
      name: c.name,
      nameAr: c.nameAr ?? null,
      type: c.type ?? "cost_centre",
      parentId: c.parentId ?? null,
      depth: depthOf(c.id),
      isActive: c.isActive,
    })
  );
  // Roll up descendants into each parent.
  const children = new Map<string, string[]>();
  for (const c of centers) {
    if (c.parentId && byId.has(c.parentId)) {
      children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id]);
    }
  }
  const rolled = new Map<string, { income: number; expense: number }>();
  const roll = (id: string, seen = new Set<string>()): { income: number; expense: number } => {
    if (rolled.has(id)) return rolled.get(id)!;
    if (seen.has(id)) return { income: 0, expense: 0 };
    seen.add(id);
    const own = agg.get(id) ?? { income: 0, expense: 0, n: 0 };
    const t = { income: own.income, expense: own.expense };
    for (const k of children.get(id) ?? []) {
      const r = roll(k, seen);
      t.income += r.income;
      t.expense += r.expense;
    }
    rolled.set(id, t);
    return t;
  };
  for (const r of rows) {
    const t = roll(r.costCenterId);
    r.rollup = {
      totalIncome: money(t.income),
      totalExpenses: money(t.expense),
      netIncome: money(t.income - t.expense),
    };
  }
  const allocated = rows.reduce(
    (s, r) => {
      const a = agg.get(r.costCenterId) ?? { income: 0, expense: 0, n: 0 };
      return { income: s.income + a.income, expense: s.expense + a.expense, n: s.n + a.n };
    },
    { income: 0, expense: 0, n: 0 }
  );
  const unallocated = rowFor(UNALLOCATED_ROW_ID, {
    costCenterId: UNALLOCATED_ROW_ID,
    code: "—",
    name: "Unallocated",
    nameAr: "غير موزع",
    type: "unallocated",
    parentId: null,
    depth: 0,
    isActive: true,
    isUnallocated: true,
  });
  const ua = agg.get(UNALLOCATED_ROW_ID) ?? { income: 0, expense: 0, n: 0 };
  const totalIncomeFils = allocated.income + ua.income;
  const totalExpenseFils = allocated.expense + ua.expense;
  // Reconcile to the company P&L from the reporting kernel.
  const pl = await profitAndLoss({ companyId, from, to: to ?? "9999-12-31" });
  const companyNet = Math.round(pl.netProfit * 100);
  return {
    periodStart: from,
    periodEnd: to,
    costCenters: [...rows, unallocated],
    totals: {
      costCenterCount: rows.length,
      activeCostCenterCount: rows.filter((r) => r.isActive).length,
      allocatedLineCount: allocated.n,
      unallocatedLineCount: ua.n,
      allocatedIncome: money(allocated.income),
      allocatedExpenses: money(allocated.expense),
      allocatedNetIncome: money(allocated.income - allocated.expense),
      unallocatedIncome: money(ua.income),
      unallocatedExpenses: money(ua.expense),
      totalIncome: money(totalIncomeFils),
      totalExpenses: money(totalExpenseFils),
      netIncome: money(totalIncomeFils - totalExpenseFils),
    },
    reconciliation: {
      companyNetProfit: pl.netProfit,
      difference: money(totalIncomeFils - totalExpenseFils - companyNet),
      reconciled: totalIncomeFils - totalExpenseFils === companyNet,
    },
  };
}

export function registerCostCenterRoutes(app: Express) {
  // =====================================
  // Cost Center CRUD Routes
  // =====================================

  app.get(
    "/api/companies/:companyId/cost-centers",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      await assertAccess(req, req.params.companyId);
      res.json(await storage.getCostCentersByCompanyId(req.params.companyId));
    })
  );

  app.get(
    "/api/cost-centers/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await loadCenter(req));
    })
  );

  app.post(
    "/api/companies/:companyId/cost-centers",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    strictBody(createCostCenterBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<CreateCostCenterBody>(req);
      await assertParent(companyId, null, body.parentId);
      // (company_id, code) is unique: a duplicate is 409 DUPLICATE_VALUE.
      const costCenter = await storage.createCostCenter({
        code: body.code,
        name: body.name,
        nameAr: body.nameAr ?? null,
        type: body.type ?? "cost_centre",
        description: body.description ?? null,
        parentId: body.parentId ?? null,
        isActive: body.isActive ?? true,
        companyId,
      });
      logger.info({ costCenterId: costCenter.id, companyId }, "Cost center created");
      res.status(201).json(costCenter);
    })
  );

  app.put(
    "/api/cost-centers/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    strictBody(updateCostCenterBody),
    asyncHandler(async (req: Request, res: Response) => {
      const cc = await loadCenter(req);
      const body = parsedBody<UpdateCostCenterBody>(req);
      if (body.parentId !== undefined) await assertParent(cc.companyId, cc.id, body.parentId);
      const updated = await storage.updateCostCenter(cc.id, body);
      res.json(updated);
    })
  );

  // Delete only when nothing references it (journal lines, tagged documents, assets, children).
  app.delete(
    "/api/cost-centers/:id",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      const cc = await loadCenter(req);
      const client = await pool.connect();
      let refused: Record<string, unknown> | null = null;
      try {
        await client.query("BEGIN");
        // Budget writers lock this row before referencing it, so the checks below stay true.
        const locked = await client.query(
          `SELECT 1 FROM cost_centers WHERE id = $1 AND company_id = $2 FOR UPDATE`,
          [cc.id, cc.companyId]
        );
        if (!locked.rows[0]) {
          throw new DomainError("COST_CENTER_NOT_FOUND", 404, undefined, "Cost center not found");
        }
        const journal = await client.query(
          `SELECT COUNT(*)::int AS n FROM journal_lines WHERE cost_center_id = $1`,
          [cc.id]
        );
        if (Number(journal.rows[0].n) > 0) {
          refused = {
            message: "Cannot delete cost center: journal lines still reference it",
            code: "COST_CENTER_IN_USE",
            journalLineCount: Number(journal.rows[0].n),
          };
        } else {
          const other = await client.query(
            `SELECT (SELECT COUNT(*) FROM cost_centers WHERE parent_id = $1)
                  + (SELECT COUNT(*) FROM bill_line_items WHERE cost_center_id = $1)
                  + (SELECT COUNT(*) FROM fixed_assets WHERE cost_center_id = $1)
                  + (SELECT COUNT(*) FROM budget_plans WHERE cost_center_id = $1)
                  + (SELECT COUNT(*) FROM budget_lines WHERE cost_center_id = $1) AS n`,
            [cc.id]
          );
          if (Number(other.rows[0]?.n ?? 0) > 0) {
            refused = {
              message:
                "Cannot delete cost center: child cost centres, documents or assets still reference it",
              code: "COST_CENTER_IN_USE",
            };
          } else {
            await client.query(`DELETE FROM cost_centers WHERE id = $1 AND company_id = $2`, [
              cc.id,
              cc.companyId,
            ]);
          }
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
      if (refused) return res.status(400).json(refused);
      res.json({ message: "Cost center deleted" });
    })
  );

  // Tag stored bill lines with a cost centre before the bill posts (R10-11). The bill module owns
  // the bill routes; its posting reads bill_line_items.cost_center_id into the journal lines.
  app.post(
    "/api/companies/:companyId/cost-centers/tag-lines",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    strictBody(tagDocumentLinesBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const body = parsedBody<TagDocumentLinesBody>(req);
      if (body.costCenterId) {
        const cc = await storage.getCostCenter(body.costCenterId);
        if (!cc || cc.companyId !== companyId) throw new DomainError("COST_CENTER_NOT_FOUND", 422);
        if (!cc.isActive) throw new DomainError("COST_CENTER_INACTIVE", 422);
      }
      const updated = await resolve<typeof tagBillLines>("bills.tagLines")(
        companyId,
        body.documentId,
        body.lineIds,
        body.costCenterId
      );
      res.json({ updated });
    })
  );

  // =====================================
  // Cost Center Report Routes
  // =====================================

  app.get(
    "/api/companies/:companyId/cost-centers/profitability",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const q = req.query as { startDate?: string; endDate?: string; budgetId?: string };
      const from = parseReportDate(q.startDate, "startDate");
      const to = parseReportDate(q.endDate, "endDate");
      if (from && to && from > to) {
        return res
          .status(400)
          .json({ message: "startDate must be before endDate", code: "INVALID_REPORT_DATE" });
      }
      await assertAccess(req, companyId);
      const budgetId =
        typeof q.budgetId === "string" && /^[0-9a-f-]{36}$/i.test(q.budgetId) ? q.budgetId : null;
      res.json(await costCenterProfitability(companyId, from, to, budgetId));
    })
  );

  app.get(
    "/api/companies/:companyId/cost-centers/:id/report",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id: costCenterId } = req.params;
      await assertAccess(req, companyId);
      const costCenter = await storage.getCostCenter(costCenterId);
      if (!costCenter)
        return res
          .status(404)
          .json({ message: "Cost center not found", code: "COST_CENTER_NOT_FOUND" });
      if (costCenter.companyId !== companyId) {
        return res.status(403).json({
          message: "Cost center does not belong to this company",
          code: "COST_CENTER_NOT_FOUND",
        });
      }
      // Optional period (UAE calendar days), like the profitability summary.
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
      const fromDate = startDate ? uaeDayStart(startDate) : undefined;
      const toDate = endDate ? uaeDayEnd(endDate) : undefined;
      if (
        (fromDate && Number.isNaN(fromDate.getTime())) ||
        (toDate && Number.isNaN(toDate.getTime()))
      ) {
        throw new DomainError(
          "INVALID_REPORT_DATE",
          400,
          undefined,
          "Invalid startDate or endDate"
        );
      }
      // Include descendants when asked (hierarchy roll-up).
      const ids = [costCenterId];
      if (req.query.includeChildren === "true") {
        const all = await storage.getCostCentersByCompanyId(companyId);
        for (let i = 0; i < ids.length; i++) {
          for (const c of all) if (c.parentId === ids[i] && !ids.includes(c.id)) ids.push(c.id);
        }
      }
      const rows = await db
        .select({
          accountId: accounts.id,
          accountCode: accounts.code,
          accountName: accounts.nameEn,
          accountNameAr: accounts.nameAr,
          accountType: accounts.type,
          totalDebit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
          totalCredit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
        .where(
          and(
            inArray(journalLines.costCenterId, ids),
            eq(journalEntries.companyId, companyId),
            eq(journalEntries.status, "posted"),
            fromDate ? gte(journalEntries.date, fromDate) : undefined,
            toDate ? lte(journalEntries.date, toDate) : undefined
          )
        )
        .groupBy(accounts.id, accounts.code, accounts.nameEn, accounts.nameAr, accounts.type);
      const income: typeof rows = [];
      const expenses: typeof rows = [];
      let incomeFils = 0;
      let expenseFils = 0;
      for (const row of rows) {
        const d = Math.round(Number(row.totalDebit) * 100);
        const c = Math.round(Number(row.totalCredit) * 100);
        if (row.accountType === "income") {
          income.push(row);
          incomeFils += c - d;
        } else if (row.accountType === "expense") {
          expenses.push(row);
          expenseFils += d - c;
        }
      }
      res.json({
        costCenter,
        includedCostCenterIds: ids,
        income,
        expenses,
        totalIncome: Number(fromFils(incomeFils)),
        totalExpenses: Number(fromFils(expenseFils)),
        netIncome: Number(fromFils(incomeFils - expenseFils)),
        allLines: rows,
      });
    })
  );

  app.get(
    "/api/companies/:companyId/cost-centers/summary",
    authMiddleware,
    requireCustomer,
    requireFeature("costCenters"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertAccess(req, companyId);
      const rows = await db
        .select({
          costCenterId: costCenters.id,
          costCenterCode: costCenters.code,
          costCenterName: costCenters.name,
          costCenterNameAr: costCenters.nameAr,
          costCenterType: costCenters.type,
          isActive: costCenters.isActive,
          totalDebit: sql<string>`coalesce(sum(case when ${journalEntries.id} is not null then ${journalLines.debit} end), 0)`,
          totalCredit: sql<string>`coalesce(sum(case when ${journalEntries.id} is not null then ${journalLines.credit} end), 0)`,
        })
        .from(costCenters)
        .leftJoin(journalLines, eq(journalLines.costCenterId, costCenters.id))
        .leftJoin(
          journalEntries,
          and(eq(journalLines.entryId, journalEntries.id), eq(journalEntries.status, "posted"))
        )
        .where(eq(costCenters.companyId, companyId))
        .groupBy(
          costCenters.id,
          costCenters.code,
          costCenters.name,
          costCenters.nameAr,
          costCenters.type,
          costCenters.isActive
        )
        .orderBy(costCenters.code);
      type SummaryRow = {
        costCenterId: string;
        costCenterCode: string;
        costCenterName: string;
        costCenterNameAr: string | null;
        costCenterType: string;
        isActive: boolean;
        totalDebit: string;
        totalCredit: string;
      };
      const summary = (rows as SummaryRow[]).map((row) => {
        const d = Math.round(Number(row.totalDebit) * 100);
        const c = Math.round(Number(row.totalCredit) * 100);
        return {
          costCenterId: row.costCenterId,
          code: row.costCenterCode,
          name: row.costCenterName,
          nameAr: row.costCenterNameAr,
          type: row.costCenterType,
          isActive: row.isActive,
          totalDebit: Number(fromFils(d)),
          totalCredit: Number(fromFils(c)),
          netAmount: Number(fromFils(d - c)),
          d,
          c,
        };
      });
      const gd = summary.reduce((s, r) => s + r.d, 0);
      const gc = summary.reduce((s, r) => s + r.c, 0);
      res.json({
        costCenters: summary.map(({ d: _d, c: _c, ...r }) => r),
        grandTotalDebit: Number(fromFils(gd)),
        grandTotalCredit: Number(fromFils(gc)),
        grandNetAmount: Number(fromFils(gd - gc)),
      });
    })
  );
}
