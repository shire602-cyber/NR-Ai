import type { Express, Request, Response } from "express";
import { parse as parseCsv } from "csv-parse/sync";
import { pool } from "../db";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { createLogger } from "../config/logger";
import {
  assertDifferentActor,
  companyHasSingleMember,
  getCompanyRole,
} from "../middleware/companyRolePolicy";
import { roleHasAnyPermission } from "../../shared/permissions";
import { isControlAccount } from "../../shared/control-accounts";
import { emitDomainEvent } from "../platform/domain-events";
import { listJobs, registerJob } from "../platform/job-registry";
import { readFormat, sendTabular } from "../reporting/http";
import { uaeToday, addMonths, type Queryable } from "../reporting";
import {
  alertCandidates,
  computeBudgetVariance,
  type BudgetPlanRow,
} from "../services/budget-variance.service";
import {
  BUDGET_MONTHS,
  budgetCopyBody,
  budgetImportBody,
  budgetLineCreateBody,
  budgetLineUpdateBody,
  budgetPlanCreateBody,
  budgetPlanUpdateBody,
  negativeBudgetMonths,
  type BudgetLineCreate,
  type BudgetLineUpdate,
  type BudgetPlanCreate,
  type BudgetPlanUpdate,
} from "../../shared/validators/budgets";
import { zUuid } from "../../shared/validators/primitives";
import { z } from "zod";

const log = createLogger("budgets");
const db: Queryable = pool as unknown as Queryable;

type LineMonths = Record<(typeof BUDGET_MONTHS)[number], number>;
type BudgetLineRow = Record<string, unknown> & { id: string };

function toMonths(
  input: Partial<Record<(typeof BUDGET_MONTHS)[number], string | null | undefined>>,
  existing?: Record<string, unknown>
): LineMonths {
  const out = {} as LineMonths;
  for (const m of BUDGET_MONTHS) {
    const raw = input[m];
    const base = existing ? Number(existing[m] ?? 0) : 0;
    out[m] = raw === undefined ? base : raw === null ? 0 : Number(raw);
    out[m] = Math.round(out[m] * 100) / 100;
  }
  return out;
}

const annualOf = (months: LineMonths) =>
  BUDGET_MONTHS.reduce((s, m) => s + Math.round(months[m] * 100), 0) / 100;

/** Company id for a plan the caller can access; a foreign or missing plan is a 404. */
async function accessiblePlan(req: Request, id: string): Promise<BudgetPlanRow> {
  const userId = req.user!.id as string;
  if (!zUuid.safeParse(id).success)
    throw new DomainError("BUDGET_NOT_FOUND", 404, undefined, "Budget not found");
  const { rows } = await db.query(`SELECT * FROM budget_plans WHERE id = $1`, [id]);
  const plan = rows[0] as BudgetPlanRow | undefined;
  if (!plan || !(await storage.hasCompanyAccess(userId, plan.company_id))) {
    throw new DomainError("BUDGET_NOT_FOUND", 404, undefined, "Budget not found");
  }
  return plan;
}

function assertDraft(plan: BudgetPlanRow): void {
  if (plan.status !== "draft" && plan.status !== null) {
    throw new DomainError(
      "BUDGET_FROZEN",
      409,
      { status: plan.status, newVersion: `/api/budget-plans/${plan.id}/new-version` },
      "An approved or closed budget cannot be edited. Create a new version instead."
    );
  }
}

/**
 * The account a budget line budgets: in this company, an income or expense account (actuals are
 * read per P&L account) and not a control account (its balance belongs to a sub-ledger).
 */
async function assertAccountInCompany(
  companyId: string,
  accountId: string | null | undefined,
  executor: Queryable = db
) {
  if (!accountId) return;
  const { rows } = await executor.query(
    `SELECT code, type, is_vat_account FROM accounts WHERE id = $1 AND company_id = $2`,
    [accountId, companyId]
  );
  if (!rows[0]) {
    throw new DomainError(
      "ACCOUNT_NOT_FOUND",
      400,
      { accountId },
      "Account not found in this company"
    );
  }
  const a = rows[0] as { code: string | null; type: string; is_vat_account: boolean | null };
  if (
    (a.type !== "income" && a.type !== "expense") ||
    isControlAccount({ code: a.code, isVatAccount: a.is_vat_account })
  ) {
    throw new DomainError(
      "BUDGET_ACCOUNT_INVALID",
      400,
      { fields: { accountId: ["Choose an income or expense account"] } },
      "A budget line budgets an income or expense account"
    );
  }
}

/*
 * Every budget write runs in one transaction. Lock order, to rule out deadlocks: plan rows first
 * (in id order), then cost centres (in id order). Cost-centre delete takes only its own row.
 */
async function withTx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client as unknown as Queryable);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Lock a plan and return it as it is now; its status may have changed since the access check. */
async function lockPlan(tx: Queryable, plan: { id: string; company_id: string }) {
  const { rows } = await tx.query(
    `SELECT * FROM budget_plans WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [plan.id, plan.company_id]
  );
  if (!rows[0]) throw new DomainError("BUDGET_NOT_FOUND", 404, undefined, "Budget not found");
  return rows[0] as BudgetPlanRow;
}

/** Lock a plan and the other versions of its family; returns the requested plan. */
async function lockPlanFamily(tx: Queryable, plan: BudgetPlanRow) {
  const { rows } = await tx.query(
    `SELECT * FROM budget_plans
      WHERE company_id = $1 AND (id = $2 OR id = $3 OR parent_budget_id = $3)
      ORDER BY id FOR UPDATE`,
    [plan.company_id, plan.id, plan.parent_budget_id ?? plan.id]
  );
  const current = rows.find((r) => r.id === plan.id);
  if (!current) throw new DomainError("BUDGET_NOT_FOUND", 404, undefined, "Budget not found");
  return current as BudgetPlanRow;
}

/**
 * Lock the referenced cost centres (in id order) so none can be deleted before this write
 * commits. Returns the ids that are not cost centres of this company.
 */
async function lockExistingCostCenters(
  tx: Queryable,
  companyId: string,
  ids: Array<string | null | undefined>
): Promise<Set<string>> {
  const sorted = [...new Set(ids.filter((id): id is string => !!id).map((id) => id.toLowerCase()))];
  sorted.sort();
  const missing = new Set<string>();
  for (const id of sorted) {
    const { rows } = await tx.query(
      `SELECT 1 FROM cost_centers WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    if (!rows[0]) missing.add(id);
  }
  return missing;
}

/** As above, but a write that names a missing cost centre is refused. */
async function lockCostCenters(
  tx: Queryable,
  companyId: string,
  ids: Array<string | null | undefined>
) {
  const [id] = await lockExistingCostCenters(tx, companyId, ids);
  if (id) {
    throw new DomainError(
      "COST_CENTER_NOT_FOUND",
      400,
      { id },
      "Cost centre not found in this company"
    );
  }
}

/**
 * Insert a new plan with `insertPlan` and copy a locked plan's lines into it, after locking the
 * cost centres of the plan and of its lines. A historical reference to a cost centre that no
 * longer exists is cleared on the new draft (the source is left as it is) and reported.
 */
async function copyLines<TCreated extends { id: string }>(
  tx: Queryable,
  from: BudgetPlanRow,
  insertPlan: (costCenterId: string | null) => Promise<TCreated>,
  factor = 1
) {
  const { rows } = await tx.query(`SELECT * FROM budget_lines WHERE budget_id = $1`, [from.id]);
  const lineCenters = rows.map((l) => l.cost_center_id as string | null);
  const missing = await lockExistingCostCenters(tx, from.company_id, [
    from.cost_center_id,
    ...lineCenters,
  ]);
  // Not a type predicate: that would narrow a kept id to null in `keep`.
  const isMissing = (id: string | null | undefined) => !!id && missing.has(id.toLowerCase());
  const keep = (id: string | null | undefined) => (isMissing(id) ? null : (id ?? null));
  const created = await insertPlan(keep(from.cost_center_id));
  for (const l of rows) {
    const months = {} as LineMonths;
    for (const m of BUDGET_MONTHS) months[m] = Math.round(Number(l[m] ?? 0) * factor * 100) / 100;
    await tx.query(
      `INSERT INTO budget_lines (budget_id, account_id, category, description, cost_center_id, is_contra,
         jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec, annual_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        created.id,
        l.account_id,
        l.category,
        l.description,
        keep(l.cost_center_id as string | null),
        l.is_contra === true,
        ...BUDGET_MONTHS.map((m) => months[m]),
        annualOf(months),
      ]
    );
  }
  const cleared = {
    clearedPlanCostCenterIds: isMissing(from.cost_center_id) ? [from.cost_center_id] : [],
    clearedLineCostCenterIds: [...new Set(lineCenters.filter(isMissing))].sort(),
  };
  return { created, lines: rows.length, cleared };
}

/** Variance alert scan for one approved plan: records new breaches and emits a domain event. */
export async function scanBudgetVariance(plan: BudgetPlanRow, actorUserId?: string | null) {
  if (plan.status !== "approved") return { created: 0, candidates: 0 };
  const report = await computeBudgetVariance(plan);
  const threshold = Number(plan.alert_threshold_pct ?? 10);
  const candidates = alertCandidates(report, threshold, uaeToday());
  let created = 0;
  for (const c of candidates) {
    const { rows } = await db.query(
      `INSERT INTO budget_variance_alerts
         (company_id, budget_id, line_id, period, budget_amount, actual_amount, variance_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING RETURNING id`,
      [plan.company_id, plan.id, c.lineId, c.period, c.budget, c.actual, c.variancePct]
    );
    if (rows[0]) {
      created++;
      emitDomainEvent("budget.variance_alert", {
        companyId: plan.company_id,
        entityId: plan.id,
        actorUserId: actorUserId ?? null,
        budgetId: plan.id,
        lineId: c.lineId,
        period: c.period,
        variancePct: c.variancePct,
      });
    }
  }
  return { created, candidates: candidates.length };
}

function registerBudgetJobs(): void {
  const names = new Set(listJobs().map((j) => j.name));
  if (names.has("budgets.varianceScan")) return;
  registerJob({
    name: "budgets.varianceScan",
    cron: "37 2 * * *",
    description: "Record budget variance alerts for approved plans",
    run: async () => {
      const { rows } = await db.query(`SELECT * FROM budget_plans WHERE status = 'approved'`);
      for (const plan of rows as BudgetPlanRow[]) {
        try {
          await scanBudgetVariance(plan, null);
        } catch (err) {
          log.error({ budgetId: plan.id, err: (err as Error).message }, "variance scan failed");
        }
      }
    },
  });
}

export function registerBudgetRoutes(app: Express) {
  registerBudgetJobs();

  // =====================================
  // Budget CRUD
  // =====================================

  app.get(
    "/api/companies/:companyId/budget-plans",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        throw new DomainError("ACCESS_DENIED", 403, undefined, "Access denied");
      }
      const year = req.query.fiscalYear ? Number(req.query.fiscalYear) : null;
      if (year !== null && !Number.isInteger(year)) {
        throw new DomainError("INVALID_FISCAL_YEAR", 400, undefined, "fiscalYear must be a year");
      }
      const result = await db.query(
        `SELECT bp.*,
           COALESCE((SELECT SUM(annual_total) FROM budget_lines WHERE budget_id = bp.id), 0) AS total_budget
         FROM budget_plans bp
         WHERE bp.company_id = $1 AND ($2::int IS NULL OR bp.fiscal_year = $2)
         ORDER BY bp.fiscal_year DESC, bp.version DESC, bp.created_at DESC`,
        [companyId, year]
      );
      res.json(result.rows);
    })
  );

  app.get(
    "/api/budget-plans/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await accessiblePlan(req, req.params.id));
    })
  );

  app.post(
    "/api/companies/:companyId/budget-plans",
    authMiddleware,
    requireCustomer,
    strictBody(budgetPlanCreateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = req.user!.id;
      if (!(await storage.hasCompanyAccess(userId, companyId))) {
        throw new DomainError("ACCESS_DENIED", 403, undefined, "Access denied");
      }
      const b = parsedBody<BudgetPlanCreate>(req);
      const result = await withTx(async (tx) => {
        await lockCostCenters(tx, companyId, [b.costCenterId]);
        return tx.query(
          `INSERT INTO budget_plans
             (company_id, name, fiscal_year, start_date, end_date, notes, created_by,
              cost_center_id, class_tag, alert_threshold_pct)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, 10))
           RETURNING *`,
          [
            companyId,
            b.name,
            b.fiscalYear,
            b.startDate,
            b.endDate,
            b.notes ?? null,
            userId,
            b.costCenterId ?? null,
            b.classTag ?? null,
            b.alertThresholdPct ?? null,
          ]
        );
      });
      log.info({ budgetId: result.rows[0].id, companyId }, "Budget plan created");
      res.status(201).json(result.rows[0]);
    })
  );

  app.patch(
    "/api/budget-plans/:id",
    authMiddleware,
    requireCustomer,
    strictBody(budgetPlanUpdateBody, { allowServerOwned: ["status"] }),
    asyncHandler(async (req: Request, res: Response) => {
      const accessible = await accessiblePlan(req, req.params.id);
      const b = parsedBody<BudgetPlanUpdate>(req);
      const result = await withTx(async (tx) => {
        const plan = await lockPlan(tx, accessible);
        const onlyClosing =
          plan.status === "approved" &&
          b.status === "closed" &&
          Object.keys(b).every((k) => k === "status");
        if (!onlyClosing) assertDraft(plan);
        await lockCostCenters(tx, plan.company_id, [b.costCenterId]);
        // Re-check the merged date window (a partial update can break end >= start).
        const start = b.startDate ?? String(plan.start_date).slice(0, 10);
        const end = b.endDate ?? String(plan.end_date).slice(0, 10);
        const merged = budgetPlanCreateBody.safeParse({
          name: b.name ?? plan.name,
          fiscalYear: b.fiscalYear ?? plan.fiscal_year,
          startDate: start,
          endDate: end,
        });
        if (!merged.success && (b.startDate || b.endDate)) {
          throw new DomainError(
            "VALIDATION_ERROR",
            400,
            { fields: { endDate: merged.error.issues.map((i) => i.message) } },
            "End date must be on or after the start date and within 12 months"
          );
        }
        return tx.query(
          `UPDATE budget_plans SET
             name = COALESCE($1, name), fiscal_year = COALESCE($2, fiscal_year),
             start_date = COALESCE($3, start_date), end_date = COALESCE($4, end_date),
             notes = COALESCE($5, notes), status = COALESCE($6, status),
             cost_center_id = COALESCE($7, cost_center_id), class_tag = COALESCE($8, class_tag),
             alert_threshold_pct = COALESCE($9, alert_threshold_pct), updated_at = now()
           WHERE id = $10 RETURNING *`,
          [
            b.name ?? null,
            b.fiscalYear ?? null,
            b.startDate ?? null,
            b.endDate ?? null,
            b.notes ?? null,
            b.status ?? null,
            b.costCenterId ?? null,
            b.classTag ?? null,
            b.alertThresholdPct ?? null,
            plan.id,
          ]
        );
      });
      res.json(result.rows[0]);
    })
  );

  app.delete(
    "/api/budget-plans/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await accessiblePlan(req, req.params.id);
      await withTx(async (tx) => {
        assertDraft(await lockPlan(tx, plan));
        await tx.query(`DELETE FROM budget_plans WHERE id = $1`, [plan.id]);
      });
      res.json({ message: "Budget plan deleted successfully" });
    })
  );

  // =====================================
  // Budget Lines (draft plans only)
  // =====================================

  app.get(
    "/api/budget-plans/:id/lines",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await accessiblePlan(req, req.params.id);
      const result = await db.query(
        `SELECT * FROM budget_lines WHERE budget_id = $1 ORDER BY category, created_at`,
        [plan.id]
      );
      res.json(result.rows);
    })
  );

  app.post(
    "/api/budget-plans/:id/lines",
    authMiddleware,
    requireCustomer,
    strictBody(budgetLineCreateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await accessiblePlan(req, req.params.id);
      const b = parsedBody<BudgetLineCreate>(req);
      const result = await withTx(async (tx) => {
        assertDraft(await lockPlan(tx, plan));
        await assertAccountInCompany(plan.company_id, b.accountId, tx);
        await lockCostCenters(tx, plan.company_id, [b.costCenterId]);
        const months = toMonths(b);
        return tx.query(
          `INSERT INTO budget_lines (budget_id, account_id, category, description, cost_center_id, is_contra,
             jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec, annual_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
           RETURNING *`,
          [
            plan.id,
            b.accountId ?? null,
            b.category,
            b.description ?? null,
            b.costCenterId ?? null,
            b.isContra === true,
            ...BUDGET_MONTHS.map((m) => months[m]),
            annualOf(months),
          ]
        );
      });
      res.status(201).json(result.rows[0]);
    })
  );

  async function accessibleLine(req: Request, id: string) {
    const userId = req.user!.id as string;
    if (!zUuid.safeParse(id).success) throw new DomainError("BUDGET_LINE_NOT_FOUND", 404);
    const { rows } = await db.query(
      `SELECT bl.*, bp.company_id, bp.status AS plan_status, bp.id AS plan_id
         FROM budget_lines bl JOIN budget_plans bp ON bl.budget_id = bp.id WHERE bl.id = $1`,
      [id]
    );
    const line = rows[0] as
      | (Pick<BudgetPlanRow, "id" | "company_id"> & {
          plan_id: string;
          plan_status: BudgetPlanRow["status"];
        })
      | undefined;
    if (!line || !(await storage.hasCompanyAccess(userId, line.company_id))) {
      throw new DomainError("BUDGET_LINE_NOT_FOUND", 404, undefined, "Budget line not found");
    }
    assertLinePlanDraft(line.plan_status, line.plan_id);
    return line;
  }

  function assertLinePlanDraft(status: unknown, planId: string): void {
    if (status !== "draft" && status !== null) {
      throw new DomainError(
        "BUDGET_FROZEN",
        409,
        { newVersion: `/api/budget-plans/${planId}/new-version` },
        "An approved or closed budget cannot be edited. Create a new version instead."
      );
    }
  }

  /** Lock the line's plan, re-check it is a draft and re-read the line. */
  async function lockLine(
    tx: Queryable,
    line: { id: string; plan_id: string; company_id: string }
  ): Promise<BudgetLineRow> {
    const plan = await lockPlan(tx, { id: line.plan_id, company_id: line.company_id });
    assertLinePlanDraft(plan.status, plan.id);
    const { rows } = await tx.query(`SELECT * FROM budget_lines WHERE id = $1 AND budget_id = $2`, [
      line.id,
      plan.id,
    ]);
    if (!rows[0]) {
      throw new DomainError("BUDGET_LINE_NOT_FOUND", 404, undefined, "Budget line not found");
    }
    return rows[0] as BudgetLineRow;
  }

  app.patch(
    "/api/budget-lines/:id",
    authMiddleware,
    requireCustomer,
    strictBody(budgetLineUpdateBody),
    asyncHandler(async (req: Request, res: Response) => {
      const accessible = await accessibleLine(req, req.params.id);
      const b = parsedBody<BudgetLineUpdate>(req);
      const result = await withTx(async (tx) => {
        const line = await lockLine(tx, accessible);
        await assertAccountInCompany(accessible.company_id, b.accountId, tx);
        await lockCostCenters(tx, accessible.company_id, [b.costCenterId]);
        const isContra = b.isContra ?? line.is_contra === true;
        const months = toMonths(b, line);
        // The merged line must still respect the sign rule (a partial update can flip a contra line).
        const negative = negativeBudgetMonths({
          ...Object.fromEntries(BUDGET_MONTHS.map((m) => [m, String(months[m])])),
          isContra,
        });
        if (negative.length) {
          throw new DomainError(
            "VALIDATION_ERROR",
            400,
            {
              fields: Object.fromEntries(
                negative.map((m) => [m, ["Negative amount on a non-contra line"]])
              ),
            },
            "Budget amounts cannot be negative unless the line is marked as a contra line"
          );
        }
        return tx.query(
          `UPDATE budget_lines SET
             account_id = COALESCE($1, account_id), category = COALESCE($2, category),
             description = COALESCE($3, description), cost_center_id = COALESCE($4, cost_center_id),
             is_contra = $5,
             jan = $6, feb = $7, mar = $8, apr = $9, may = $10, jun = $11,
             jul = $12, aug = $13, sep = $14, oct = $15, nov = $16, dec = $17, annual_total = $18
           WHERE id = $19 RETURNING *`,
          [
            b.accountId ?? null,
            b.category ?? null,
            b.description ?? null,
            b.costCenterId ?? null,
            isContra,
            ...BUDGET_MONTHS.map((m) => months[m]),
            annualOf(months),
            line.id,
          ]
        );
      });
      res.json(result.rows[0]);
    })
  );

  app.delete(
    "/api/budget-lines/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const accessible = await accessibleLine(req, req.params.id);
      await withTx(async (tx) => {
        const line = await lockLine(tx, accessible);
        await tx.query(`DELETE FROM budget_lines WHERE id = $1`, [line.id]);
      });
      res.json({ message: "Budget line deleted successfully" });
    })
  );

  // =====================================
  // Variance, alerts
  // =====================================

  app.get(
    "/api/budget-plans/:id/variance",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await accessiblePlan(req, req.params.id);
      const through =
        typeof req.query.throughMonth === "string" && /^\d{4}-\d{2}$/.test(req.query.throughMonth)
          ? req.query.throughMonth
          : undefined;
      res.json(await computeBudgetVariance(plan, { throughMonth: through }));
    })
  );

  app.post(
    "/api/budget-plans/:id/variance/scan",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await accessiblePlan(req, req.params.id);
      res.json(await scanBudgetVariance(plan, req.user!.id));
    })
  );

  app.get(
    "/api/budget-plans/:id/alerts",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await accessiblePlan(req, req.params.id);
      const { rows } = await db.query(
        `SELECT a.id, a.line_id AS "lineId", l.category, a.period,
                a.budget_amount::float8 AS budget, a.actual_amount::float8 AS actual,
                a.variance_pct::float8 AS "variancePct", a.created_at AS "createdAt"
           FROM budget_variance_alerts a LEFT JOIN budget_lines l ON l.id = a.line_id
          WHERE a.budget_id = $1 ORDER BY a.period DESC, a.created_at DESC`,
        [plan.id]
      );
      res.json(rows);
    })
  );

  // =====================================
  // Approval (maker-checker) and versions
  // =====================================

  app.post(
    "/api/budget-plans/:id/approve",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await accessiblePlan(req, req.params.id);
      const userId = req.user!.id as string;
      const role = await getCompanyRole(userId, plan.company_id);
      if (!role || !roleHasAnyPermission(role, ["documents.approve"])) {
        throw new DomainError(
          "PERMISSION_DENIED",
          403,
          { permission: "documents.approve", role },
          "Your role in this company does not allow approving budgets"
        );
      }
      const allowSingleOwner = await companyHasSingleMember(plan.company_id);
      // Status and lines are read under the lock every line writer (CSV replace included) takes.
      const result = await withTx(async (tx) => {
        const current = await lockPlanFamily(tx, plan);
        if (current.status === "approved") {
          throw new DomainError(
            "BUDGET_ALREADY_APPROVED",
            400,
            undefined,
            "Budget is already approved"
          );
        }
        if (current.status !== "draft" && current.status !== null) {
          throw new DomainError(
            "BUDGET_NOT_DRAFT",
            409,
            { status: current.status },
            "Only a draft budget can be approved"
          );
        }
        assertDifferentActor(current.created_by, userId, { allowSingleOwner });
        const lines = await tx.query(
          `SELECT COUNT(*)::int AS n FROM budget_lines WHERE budget_id = $1`,
          [current.id]
        );
        if (!lines.rows[0].n) {
          throw new DomainError(
            "BUDGET_EMPTY",
            409,
            undefined,
            "Add at least one line before approving"
          );
        }
        const rootId = current.parent_budget_id ?? current.id;
        // A newly approved version supersedes earlier approved versions of the same family.
        await tx.query(
          `UPDATE budget_plans SET status = 'closed', updated_at = now()
            WHERE company_id = $1 AND status = 'approved' AND id <> $2
              AND (id = $3 OR parent_budget_id = $3)`,
          [current.company_id, current.id, rootId]
        );
        return tx.query(
          `UPDATE budget_plans SET status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
            WHERE id = $1 RETURNING *`,
          [current.id, userId]
        );
      });
      log.info({ budgetId: plan.id }, "Budget approved");
      res.json(result.rows[0]);
    })
  );

  app.post(
    "/api/budget-plans/:id/new-version",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await accessiblePlan(req, req.params.id);
      const userId = req.user!.id as string;
      const rootId = plan.parent_budget_id ?? plan.id;
      const { created, cleared } = await withTx(async (tx) => {
        const source = await lockPlanFamily(tx, plan);
        return copyLines(tx, source, async (costCenterId) => {
          const next = await tx.query(
            `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM budget_plans WHERE id = $1 OR parent_budget_id = $1`,
            [rootId]
          );
          const inserted = await tx.query(
            `INSERT INTO budget_plans
               (company_id, name, fiscal_year, start_date, end_date, notes, created_by, version,
                parent_budget_id, cost_center_id, class_tag, alert_threshold_pct)
             SELECT company_id, name, fiscal_year, start_date, end_date, notes, $2, $3, $4,
                    $5::uuid, class_tag, alert_threshold_pct
               FROM budget_plans WHERE id = $1 RETURNING *`,
            [source.id, userId, Number(next.rows[0].v), rootId, costCenterId]
          );
          return inserted.rows[0] as BudgetPlanRow;
        });
      });
      res.status(201).json({ ...created, ...cleared });
    })
  );

  app.get(
    "/api/budget-plans/:id/versions",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await accessiblePlan(req, req.params.id);
      const rootId = plan.parent_budget_id ?? plan.id;
      const { rows } = await db.query(
        `SELECT id, name, version, status, approved_by, approved_at, created_at, created_by
           FROM budget_plans WHERE company_id = $1 AND (id = $2 OR parent_budget_id = $2)
          ORDER BY version`,
        [plan.company_id, rootId]
      );
      res.json(rows);
    })
  );

  // Copy from a previous year: dates shift by whole years, amounts optionally uplifted.
  app.post(
    "/api/budget-plans/:id/copy",
    authMiddleware,
    requireCustomer,
    strictBody(budgetCopyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await accessiblePlan(req, req.params.id);
      const userId = req.user!.id as string;
      const b = parsedBody<z.output<typeof budgetCopyBody>>(req);
      const iso = (v: Date | string) => new Date(v).toISOString().slice(0, 10);
      const { created, lines, cleared } = await withTx(async (tx) => {
        const source = await lockPlan(tx, plan);
        const shiftMonths = (b.fiscalYear - source.fiscal_year) * 12;
        return copyLines(
          tx,
          source,
          async (costCenterId) => {
            const inserted = await tx.query(
              `INSERT INTO budget_plans
                 (company_id, name, fiscal_year, start_date, end_date, notes, created_by,
                  cost_center_id, class_tag, alert_threshold_pct)
               SELECT company_id, $2, $3, $4::date, $5::date, notes, $6, $7::uuid, class_tag, alert_threshold_pct
                 FROM budget_plans WHERE id = $1 RETURNING *`,
              [
                source.id,
                b.name ?? `${source.name} (FY${b.fiscalYear})`,
                b.fiscalYear,
                addMonths(iso(source.start_date), shiftMonths),
                addMonths(iso(source.end_date), shiftMonths),
                userId,
                costCenterId,
              ]
            );
            return inserted.rows[0] as BudgetPlanRow;
          },
          1 + (b.adjustPct ?? 0) / 100
        );
      });
      res.status(201).json({ ...created, copiedLines: lines, ...cleared });
    })
  );

  // =====================================
  // Import / export
  // =====================================

  app.get(
    "/api/budget-plans/:id/export",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await accessiblePlan(req, req.params.id);
      const format = readFormat(req.query.format ?? "csv");
      const { rows } = await db.query(
        `SELECT bl.*, a.code AS account_code, cc.code AS cost_center_code
           FROM budget_lines bl
           LEFT JOIN accounts a ON a.id = bl.account_id
           LEFT JOIN cost_centers cc ON cc.id = bl.cost_center_id
          WHERE bl.budget_id = $1 ORDER BY bl.category, bl.created_at`,
        [plan.id]
      );
      const sheetRows = rows.map((l) => ({
        category: l.category,
        account_code: l.account_code ?? "",
        cost_center_code: l.cost_center_code ?? "",
        is_contra: l.is_contra === true ? "yes" : "",
        ...Object.fromEntries(BUDGET_MONTHS.map((m) => [m, Number(l[m] ?? 0)])),
        annual_total: Number(l.annual_total ?? 0),
      }));
      if (format === "json") return res.json({ plan, lines: sheetRows });
      await sendTabular(res, format, `budget-${plan.name}-v${plan.version ?? 1}`, [
        {
          sheetName: "Budget",
          columns: [
            { header: "category", key: "category", width: 30 },
            { header: "account_code", key: "account_code", width: 14 },
            { header: "cost_center_code", key: "cost_center_code", width: 16 },
            { header: "is_contra", key: "is_contra", width: 10 },
            ...BUDGET_MONTHS.map((m) => ({ header: m, key: m })),
            { header: "annual_total", key: "annual_total" },
          ],
          rows: sheetRows,
        },
      ]);
    })
  );

  app.post(
    "/api/budget-plans/:id/import",
    authMiddleware,
    requireCustomer,
    strictBody(budgetImportBody),
    asyncHandler(async (req: Request, res: Response) => {
      const plan = await accessiblePlan(req, req.params.id);
      assertDraft(plan);
      const b = parsedBody<z.output<typeof budgetImportBody>>(req);
      let records: Record<string, string>[];
      try {
        records = parseCsv(b.csv.replace(/^\uFEFF/, ""), {
          columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()),
          skip_empty_lines: true,
          trim: true,
        });
      } catch (err) {
        throw new DomainError(
          "INVALID_CSV",
          400,
          { reason: (err as Error).message },
          "Could not read the CSV"
        );
      }
      const accounts = await db.query(`SELECT id, code FROM accounts WHERE company_id = $1`, [
        plan.company_id,
      ]);
      const accountByCode = new Map(accounts.rows.map((a) => [String(a.code), a.id as string]));
      const centers = await db.query(`SELECT id, code FROM cost_centers WHERE company_id = $1`, [
        plan.company_id,
      ]);
      const centerByCode = new Map(centers.rows.map((c) => [String(c.code), c.id as string]));

      const prepared: Array<{
        category: string;
        accountId: string | null;
        costCenterId: string | null;
        isContra: boolean;
        months: LineMonths;
      }> = [];
      const errors: Array<{ row: number; message: string }> = [];
      records.forEach((r, i) => {
        const row = i + 2;
        if (!r.category) return void errors.push({ row, message: "category is required" });
        const isContra = ["yes", "true", "1"].includes((r.is_contra ?? "").toLowerCase());
        const months = {} as LineMonths;
        for (const m of BUDGET_MONTHS) {
          const raw = (r[m] ?? "").replace(/,/g, "");
          const n = raw === "" ? 0 : Number(raw);
          if (!Number.isFinite(n))
            return void errors.push({ row, message: `${m} is not a number` });
          if (n < 0 && !isContra)
            return void errors.push({ row, message: `${m} is negative on a non-contra line` });
          months[m] = Math.round(n * 100) / 100;
        }
        const code = r.account_code ?? "";
        const accountId = code ? (accountByCode.get(code) ?? null) : null;
        if (code && !accountId)
          return void errors.push({ row, message: `unknown account_code ${code}` });
        const cc = r.cost_center_code ?? "";
        const costCenterId = cc ? (centerByCode.get(cc) ?? null) : null;
        if (cc && !costCenterId)
          return void errors.push({ row, message: `unknown cost_center_code ${cc}` });
        prepared.push({ category: r.category, accountId, costCenterId, isContra, months });
      });
      if (errors.length) {
        throw new DomainError(
          "IMPORT_INVALID",
          400,
          { errors: errors.slice(0, 50) },
          "The file has invalid rows; nothing was imported"
        );
      }
      // One transaction: a failed insert (for example an amount overflow) rolls back the delete.
      await withTx(async (tx) => {
        // Lock the plan row so concurrent imports run one at a time, then re-check it is a draft.
        assertDraft(await lockPlan(tx, plan));
        await lockCostCenters(
          tx,
          plan.company_id,
          prepared.map((p) => p.costCenterId)
        );
        if (b.replace) {
          await tx.query(`DELETE FROM budget_lines WHERE budget_id = $1`, [plan.id]);
        }
        for (const p of prepared) {
          await tx.query(
            `INSERT INTO budget_lines (budget_id, account_id, category, cost_center_id, is_contra,
               jan, feb, mar, apr, may, jun, jul, aug, sep, oct, nov, dec, annual_total)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [
              plan.id,
              p.accountId,
              p.category,
              p.costCenterId,
              p.isContra,
              ...BUDGET_MONTHS.map((m) => p.months[m]),
              annualOf(p.months),
            ]
          );
        }
      });
      res.json({ imported: prepared.length, replaced: b.replace === true });
    })
  );
}
