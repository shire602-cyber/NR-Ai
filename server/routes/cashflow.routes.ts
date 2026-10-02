import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { AppError } from "../errors";
import {
  defaultScenario,
  deleteScenario,
  generateCashFlowForecast,
  getCashFlowHistory,
  getScenario,
  listScenarios,
  saveScenario,
  scenarioFromRow,
} from "../services/cashflow-forecast.service";
import { DEFAULT_SCENARIO, type ForecastScenario } from "../services/cashflow-forecast-math";

const uuid = z.string().uuid();
const companyParams = z.object({ companyId: uuid }).passthrough();
const scenarioParams = z.object({ companyId: uuid, id: uuid }).passthrough();

const adjustmentSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().finite().refine((n) => n !== 0 && Math.abs(n) <= 1_000_000_000, "amount must be non-zero and at most 1,000,000,000"),
  label: z.string().trim().min(1).max(120),
});

const scenarioFields = {
  receiptDelayDays: z.coerce.number().int().min(-60).max(180),
  paymentDelayDays: z.coerce.number().int().min(-60).max(180),
  collectionRatePct: z.coerce.number().min(0).max(100),
  includeRecurring: z.boolean(),
  includePayroll: z.boolean(),
  payrollPayDay: z.coerce.number().int().min(1).max(28),
  adjustments: z.array(adjustmentSchema).max(50),
};

const scenarioCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  isDefault: z.boolean().optional(),
  receiptDelayDays: scenarioFields.receiptDelayDays.default(0),
  paymentDelayDays: scenarioFields.paymentDelayDays.default(0),
  collectionRatePct: scenarioFields.collectionRatePct.default(100),
  includeRecurring: scenarioFields.includeRecurring.default(true),
  includePayroll: scenarioFields.includePayroll.default(true),
  payrollPayDay: scenarioFields.payrollPayDay.default(28),
  adjustments: scenarioFields.adjustments.default([]),
});
const scenarioUpdateSchema = scenarioCreateSchema.partial().extend({
  receiptDelayDays: scenarioFields.receiptDelayDays.optional(),
  paymentDelayDays: scenarioFields.paymentDelayDays.optional(),
  collectionRatePct: scenarioFields.collectionRatePct.optional(),
  includeRecurring: scenarioFields.includeRecurring.optional(),
  includePayroll: scenarioFields.includePayroll.optional(),
  payrollPayDay: scenarioFields.payrollPayDay.optional(),
  adjustments: scenarioFields.adjustments.optional(),
});

const bool = (v: unknown): boolean | undefined => (v === "true" || v === "1" ? true : v === "false" || v === "0" ? false : undefined);

/** Inline scenario fields from the query string (the screen's sliders), validated; anything absent stays default. */
function inlineScenario(query: Request["query"]): Partial<ForecastScenario> | null {
  const keys = ["receiptDelayDays", "paymentDelayDays", "collectionRatePct", "includeRecurring", "includePayroll", "payrollPayDay", "adjustments"];
  if (!keys.some((k) => query[k] !== undefined)) return null;
  let adjustments: unknown = undefined;
  if (typeof query.adjustments === "string") {
    try {
      adjustments = JSON.parse(query.adjustments);
    } catch {
      throw new AppError({ message: "adjustments must be JSON", statusCode: 400, code: "VALIDATION_ERROR" });
    }
  }
  const parsed = z
    .object({
      receiptDelayDays: scenarioFields.receiptDelayDays.optional(),
      paymentDelayDays: scenarioFields.paymentDelayDays.optional(),
      collectionRatePct: scenarioFields.collectionRatePct.optional(),
      includeRecurring: scenarioFields.includeRecurring.optional(),
      includePayroll: scenarioFields.includePayroll.optional(),
      payrollPayDay: scenarioFields.payrollPayDay.optional(),
      adjustments: scenarioFields.adjustments.optional(),
    })
    .safeParse({
      receiptDelayDays: query.receiptDelayDays,
      paymentDelayDays: query.paymentDelayDays,
      collectionRatePct: query.collectionRatePct,
      includeRecurring: bool(query.includeRecurring),
      includePayroll: bool(query.includePayroll),
      payrollPayDay: query.payrollPayDay,
      adjustments,
    });
  if (!parsed.success) throw new AppError({ message: "Invalid scenario", statusCode: 400, code: "VALIDATION_ERROR", details: parsed.error.flatten().fieldErrors });
  // keys the caller did not send must not overwrite the defaults with undefined
  return Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Partial<ForecastScenario>;
}

export function registerCashFlowRoutes(app: Express) {
  const guard = [authMiddleware, requireCustomer, validate({ params: companyParams }), requireCompanyAccess("params")];

  // Forecast from AR, bills, recurring templates and payroll. ?days=7..365, ?scenarioId=, or inline scenario fields.
  app.get(
    "/api/companies/:companyId/cashflow/forecast",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 90, 7), 365);
      let scenario: Partial<ForecastScenario> = { ...DEFAULT_SCENARIO };
      let meta: { id: string; name: string } | null = null;

      if (typeof req.query.scenarioId === "string" && req.query.scenarioId) {
        if (!uuid.safeParse(req.query.scenarioId).success) throw new AppError({ message: "scenarioId must be a UUID", statusCode: 400, code: "VALIDATION_ERROR" });
        const row = await getScenario(companyId, req.query.scenarioId);
        if (!row) throw new AppError({ message: "Scenario not found", statusCode: 404, code: "SCENARIO_NOT_FOUND" });
        scenario = scenarioFromRow(row);
        meta = { id: row.id, name: row.name };
      } else {
        const inline = inlineScenario(req.query);
        if (inline) scenario = { ...scenario, ...inline };
        else {
          const dflt = await defaultScenario(companyId);
          if (dflt) {
            scenario = scenarioFromRow(dflt);
            meta = { id: dflt.id, name: dflt.name };
          }
        }
      }
      res.json(await generateCashFlowForecast(companyId, days, scenario, meta));
    })
  );

  app.get(
    "/api/companies/:companyId/cashflow/history",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const months = Math.min(Math.max(parseInt(req.query.months as string) || 6, 1), 24);
      res.json(await getCashFlowHistory(req.params.companyId, months));
    })
  );

  app.get(
    "/api/companies/:companyId/cashflow/scenarios",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await listScenarios(req.params.companyId));
    })
  );

  app.post(
    "/api/companies/:companyId/cashflow/scenarios",
    ...guard,
    validate({ body: scenarioCreateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const row = await saveScenario({ companyId: req.params.companyId, userId: req.user!.id, values: req.body });
      res.status(201).json(row);
    })
  );

  app.patch(
    "/api/companies/:companyId/cashflow/scenarios/:id",
    authMiddleware,
    requireCustomer,
    validate({ params: scenarioParams, body: scenarioUpdateSchema }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      const row = await saveScenario({ companyId: req.params.companyId, userId: req.user!.id, id: req.params.id, values: req.body });
      if (!row) throw new AppError({ message: "Scenario not found", statusCode: 404, code: "SCENARIO_NOT_FOUND" });
      res.json(row);
    })
  );

  app.delete(
    "/api/companies/:companyId/cashflow/scenarios/:id",
    authMiddleware,
    requireCustomer,
    validate({ params: scenarioParams }),
    requireCompanyAccess("params"),
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await deleteScenario(req.params.companyId, req.params.id))) throw new AppError({ message: "Scenario not found", statusCode: 404, code: "SCENARIO_NOT_FOUND" });
      res.json({ message: "Scenario deleted" });
    })
  );
}
