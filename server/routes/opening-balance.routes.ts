// Opening balances (Phase 4.4a): overview, CSV/grid preview, post, reverse.

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import type { FilingActor } from "../services/tax-filing.service";
import {
  getOpeningBalanceOverview,
  postOpeningBalance,
  previewOpeningBalance,
  reverseOpeningBalance,
} from "../services/opening-balance.service";

const docSchema = z.object({
  party: z.string().optional(),
  number: z.string().optional(),
  date: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  amount: z.union([z.number(), z.string()]).optional(),
  currency: z.string().optional(),
  exchangeRate: z.union([z.number(), z.string()]).optional(),
});

const bodySchema = z.object({
  asOfDate: z.string().optional(),
  rows: z
    .array(z.object({ accountCode: z.string(), debit: z.coerce.number().default(0), credit: z.coerce.number().default(0) }))
    .max(2000)
    .optional(),
  csv: z.string().max(2_000_000).optional().nullable(),
  invoices: z.array(docSchema).max(2000).optional(),
  bills: z.array(docSchema).max(2000).optional(),
  openingStock: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.coerce.number().int().min(0), unitCost: z.coerce.number().min(0) }))
    .max(2000)
    .optional(),
});

function actorOf(req: Request): FilingActor {
  const u = (req as any).user;
  return { id: u.id, isAdmin: u.isAdmin === true, firmRole: u.firmRole ?? null };
}

export function registerOpeningBalanceRoutes(app: Express) {
  const base = "/api/companies/:companyId/opening-balances";
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
      res.json(await getOpeningBalanceOverview(req.params.companyId));
    })
  );

  app.post(
    `${base}/preview`,
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      const body = bodySchema.safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: "Invalid opening balance payload", code: "VALIDATION_ERROR" });
      res.json(await previewOpeningBalance(req.params.companyId, body.data));
    })
  );

  app.post(
    base,
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      const body = bodySchema.safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: "Invalid opening balance payload", code: "VALIDATION_ERROR" });
      const result = await postOpeningBalance({ user: actorOf(req), companyId: req.params.companyId, input: body.data, req });
      res.status(201).json(result);
    })
  );

  app.post(
    `${base}/reverse`,
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
      res.json(await reverseOpeningBalance({ user: actorOf(req), companyId: req.params.companyId, reason, req }));
    })
  );
}
