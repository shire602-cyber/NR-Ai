// Shared access checks for the HR routes (leave, employee loans, final settlements).
// Reads need company access; writes need an accountant or above (403 ROLE_REQUIRED): no employee self-service.

import type { Request, Response } from "express";
import { storage } from "../storage";
import { resolveActor } from "../services/approval-gate.service";
import { ROLE_RANK } from "../services/approval-rules";

export async function hrCompanyAccess(req: Request, res: Response, companyId: string, opts: { write: boolean }): Promise<boolean> {
  if (!(await storage.hasCompanyAccess(req.user!.id, companyId))) {
    res.status(403).json({ message: "Access denied" });
    return false;
  }
  if (opts.write) {
    const actor = await resolveActor(req.user!, companyId);
    if (actor.rank < ROLE_RANK.accountant) {
      res.status(403).json({ message: "Only an accountant, CFO or owner can change HR records.", code: "ROLE_REQUIRED" });
      return false;
    }
  }
  return true;
}
