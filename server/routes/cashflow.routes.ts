import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { requirePermission } from "../middleware/companyRolePolicy";
import { asyncHandler } from "../middleware/errorHandler";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import { pool } from "../db";
import { assertReportAccess } from "../reporting/http";
import {
  generateCashFlowForecast,
  getCashFlowHistory,
  type ForecastAdjustment,
  type ForecastScenario,
} from "../services/cashflow-forecast.service";
import { zDate, zMoneyPositive, zText, zUuid } from "../../shared/validators/primitives";

const SCENARIOS = ["base", "conservative", "optimistic"] as const;

const adjustmentSchema = z
  .object({
    date: zDate,
    amount: zMoneyPositive,
    direction: z.enum(["inflow", "outflow"]),
    description: zText(200, { min: 1 }),
  })
  .strict();

const whatIfBody = z
  .object({
    days: z.number().int().min(7).max(365).optional(),
    scenario: z.enum(SCENARIOS).optional(),
    delayReceiptsDays: z.number().int().min(0).max(180).optional(),
    accountIds: z.array(zUuid).max(50).optional(),
    adjustments: z.array(adjustmentSchema).max(50).optional(),
  })
  .strict();

const scheduledItemBody = z
  .object({
    kind: z.enum(["loan_repayment", "one_off_inflow", "one_off_outflow"]),
    description: zText(200, { min: 1 }),
    amount: zMoneyPositive,
    dueDate: zDate,
    repeatMonths: z.number().int().min(0).max(12).optional(),
    occurrences: z.number().int().min(1).max(120).optional(),
    bankAccountId: zUuid.optional().nullable(),
  })
  .strict()
  .refine((v) => !(v.repeatMonths && v.repeatMonths > 0) || (v.occurrences ?? 1) >= 1, {
    message: "occurrences must be at least 1",
  });

function toAdjustments(list: z.infer<typeof adjustmentSchema>[] | undefined): ForecastAdjustment[] {
  return (list ?? []).map((a) => ({
    date: a.date,
    amount: Number(a.amount),
    direction: a.direction,
    description: a.description,
  }));
}

function readDays(raw: unknown): number {
  return Math.min(Math.max(parseInt(String(raw ?? ""), 10) || 90, 7), 365);
}

export function registerCashFlowRoutes(app: Express) {
  /**
   * GET /api/companies/:companyId/cashflow/forecast
   * Document-driven forecast. Query: days (7-365, default 90), scenario
   * (base | conservative | optimistic), delayReceiptsDays, accountIds (comma list).
   */
  app.get(
    "/api/companies/:companyId/cashflow/forecast",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const scenario = req.query.scenario as string | undefined;
      if (scenario !== undefined && !(SCENARIOS as readonly string[]).includes(scenario)) {
        throw new DomainError("INVALID_SCENARIO", 400, { scenario }, "Unknown forecast scenario");
      }
      const delayRaw = req.query.delayReceiptsDays;
      const delay = delayRaw === undefined ? undefined : parseInt(String(delayRaw), 10);
      if (delay !== undefined && (!Number.isInteger(delay) || delay < 0 || delay > 180)) {
        throw new DomainError("INVALID_DELAY", 400, undefined, "delayReceiptsDays must be 0-180");
      }
      const accountIds =
        typeof req.query.accountIds === "string" && req.query.accountIds
          ? req.query.accountIds.split(",").map((s) => s.trim())
          : [];
      for (const id of accountIds) {
        if (!zUuid.safeParse(id).success) {
          throw new DomainError("INVALID_ACCOUNT_ID", 400, { id }, "accountIds must be UUIDs");
        }
      }
      res.json(
        await generateCashFlowForecast(companyId, {
          days: readDays(req.query.days),
          scenario: scenario as ForecastScenario | undefined,
          delayReceiptsDays: delay,
          accountIds,
        })
      );
    })
  );

  /** POST what-if: same engine with delayed receipts, one-off adjustments and account selection. */
  app.post(
    "/api/companies/:companyId/cashflow/forecast/what-if",
    authMiddleware,
    requireCustomer,
    strictBody(whatIfBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const body = parsedBody<z.infer<typeof whatIfBody>>(req);
      res.json(
        await generateCashFlowForecast(companyId, {
          days: body.days ?? 90,
          scenario: body.scenario,
          delayReceiptsDays: body.delayReceiptsDays,
          accountIds: body.accountIds,
          adjustments: toAdjustments(body.adjustments),
        })
      );
    })
  );

  app.get(
    "/api/companies/:companyId/cashflow/history",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const months = Math.min(Math.max(parseInt(req.query.months as string) || 6, 1), 24);
      res.json(await getCashFlowHistory(companyId, months));
    })
  );

  // ── Scheduled items: loan repayments and one-offs ────────────────────────
  app.get(
    "/api/companies/:companyId/cashflow/items",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const { rows } = await pool.query(
        `SELECT id, kind, description, amount::float8 AS amount, due_date::text AS "dueDate",
                repeat_months AS "repeatMonths", occurrences, bank_account_id AS "bankAccountId",
                is_active AS "isActive"
           FROM cash_forecast_items WHERE company_id = $1 AND is_active = true
          ORDER BY due_date, created_at`,
        [companyId]
      );
      res.json(rows);
    })
  );

  app.post(
    "/api/companies/:companyId/cashflow/items",
    authMiddleware,
    requireCustomer,
    requirePermission("documents.write"),
    strictBody(scheduledItemBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      await assertReportAccess(req, companyId);
      const body = parsedBody<z.infer<typeof scheduledItemBody>>(req);
      const { rows } = await pool.query(
        `INSERT INTO cash_forecast_items
           (company_id, kind, description, amount, due_date, repeat_months, occurrences, bank_account_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, kind, description, amount::float8 AS amount, due_date::text AS "dueDate",
                   repeat_months AS "repeatMonths", occurrences`,
        [
          companyId,
          body.kind,
          body.description,
          body.amount,
          body.dueDate,
          body.repeatMonths ?? 0,
          body.occurrences ?? 1,
          body.bankAccountId ?? null,
          req.user!.id,
        ]
      );
      res.status(201).json(rows[0]);
    })
  );

  app.delete(
    "/api/companies/:companyId/cashflow/items/:itemId",
    authMiddleware,
    requireCustomer,
    requirePermission("documents.write"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, itemId } = req.params;
      await assertReportAccess(req, companyId);
      if (!zUuid.safeParse(itemId).success) throw new DomainError("NOT_FOUND", 404);
      const { rowCount } = await pool.query(
        `UPDATE cash_forecast_items SET is_active = false
          WHERE id = $1 AND company_id = $2 AND is_active = true`,
        [itemId, companyId]
      );
      if (!rowCount) throw new DomainError("NOT_FOUND", 404);
      res.json({ id: itemId, deleted: true });
    })
  );
}
