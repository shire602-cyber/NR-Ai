import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { assertDay, assetRegister, depreciationSchedule, registerCsv, scheduleCsv } from "../services/fixed-asset-reports.service";
import { todayInDubai } from "../services/cashflow-forecast.service";

const companyParams = z.object({ companyId: z.string().uuid() }).passthrough();

export function registerFixedAssetReportRoutes(app: Express) {
  const guard = [authMiddleware, requireCustomer, validate({ params: companyParams }), requireCompanyAccess("params")];

  app.get(
    "/api/companies/:companyId/fixed-assets/register",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const asOf = assertDay(req.query.asOf, "asOf") ?? todayInDubai();
      const register = await assetRegister(req.params.companyId, asOf);
      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="asset-register-${asOf}.csv"`);
        return res.send(registerCsv(register));
      }
      res.json(register);
    })
  );

  app.get(
    "/api/companies/:companyId/fixed-assets/depreciation-schedule",
    ...guard,
    asyncHandler(async (req: Request, res: Response) => {
      const from = assertDay(req.query.from, "from");
      const to = assertDay(req.query.to, "to");
      const projectToEnd = req.query.projectToEnd === "true" || req.query.projectToEnd === "1";
      const rows = await depreciationSchedule(req.params.companyId, { from, to, projectToEnd });
      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="depreciation-schedule.csv"`);
        return res.send(scheduleCsv(rows));
      }
      res.json(rows);
    })
  );
}
