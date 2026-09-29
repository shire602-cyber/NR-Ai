// Financial-year close (Phase 4.4b): overview, close, reopen.

import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import type { FilingActor } from "../services/tax-filing.service";
import { closeFinancialYear, getYearEndOverview, reopenFinancialYear } from "../services/year-end.service";

function actorOf(req: Request): FilingActor {
  const u = (req as any).user;
  return { id: u.id, isAdmin: u.isAdmin === true, firmRole: u.firmRole ?? null };
}

export function registerYearEndRoutes(app: Express) {
  const base = "/api/companies/:companyId/year-end";
  const access = async (req: Request, res: Response): Promise<boolean> => {
    if (!(await storage.hasCompanyAccess((req as any).user.id, req.params.companyId))) {
      res.status(403).json({ message: "Access denied" });
      return false;
    }
    return true;
  };

  app.get(
    base,
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      res.json(await getYearEndOverview(req.params.companyId));
    })
  );

  app.post(
    `${base}/close`,
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      res.status(201).json(
        await closeFinancialYear({ user: actorOf(req), companyId: req.params.companyId, yearStart: req.body?.yearStart, req })
      );
    })
  );

  app.post(
    `${base}/reopen`,
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      res.json(
        await reopenFinancialYear({
          user: actorOf(req),
          companyId: req.params.companyId,
          yearStart: req.body?.yearStart,
          reason: req.body?.reason,
          req,
        })
      );
    })
  );
}
