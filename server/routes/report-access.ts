// Financial reports are not for the employee role ("submit expenses only"): the trial balance, ledgers and every other
// report under /api/companies/:id/reports answer 403 ROLE_REQUIRED to a plain employee. Accountant, CFO, owner and
// firm staff are unaffected.

import type { Express, NextFunction, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { resolveActor } from "../services/approval-gate.service";
import { ROLE_RANK } from "../services/approval-rules";
import { storage } from "../storage";

export function registerReportAccessGate(app: Express) {
  app.use(
    "/api/companies/:id/reports",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
      const companyId = req.params.id;
      // No access at all is answered by the route itself; only a member with the employee role is stopped here.
      if (!(await storage.hasCompanyAccess(req.user!.id, companyId))) return next();
      const actor = await resolveActor(req.user!, companyId);
      if (actor.rank < ROLE_RANK.accountant) {
        return res.status(403).json({ message: "Reports are for accountants, CFOs and owners.", code: "ROLE_REQUIRED" });
      }
      next();
    })
  );
}
