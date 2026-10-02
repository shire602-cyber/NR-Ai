import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import {
  createPriceList,
  deletePriceList,
  getPriceList,
  listPriceLists,
  resolvePriceList,
  updatePriceList,
} from "../services/price-list.service";

const itemSchema = z.object({
  productId: z.string().uuid(),
  unitPrice: z.coerce.number().finite().positive().max(9_999_999_999_999),
});
const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  currency: z.string().trim().length(3).optional(),
  isActive: z.boolean().optional(),
  items: z.array(itemSchema).max(5000).optional(),
});
const updateSchema = createSchema.partial();

export function registerPriceListRoutes(app: Express) {
  const guards = [authMiddleware, requireCustomer, requireCompanyAccess("params")];
  const base = "/api/companies/:companyId/price-lists";

  app.get(base, ...guards, asyncHandler(async (req: Request, res: Response) => res.json(await listPriceLists(req.params.companyId))));

  // Registered before /:id so "resolve" is not read as an id.
  app.get(
    `${base}/resolve`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const contactId = typeof req.query.contactId === "string" ? req.query.contactId : "";
      if (!/^[0-9a-f-]{36}$/i.test(contactId)) return res.status(400).json({ message: "contactId is required", code: "CONTACT_REQUIRED" });
      const currency = typeof req.query.currency === "string" && req.query.currency ? req.query.currency : "AED";
      res.json(await resolvePriceList(req.params.companyId, contactId, currency));
    })
  );

  app.post(
    base,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      res.status(201).json(await createPriceList(req.params.companyId, createSchema.parse(req.body ?? {})));
    })
  );

  app.get(
    `${base}/:id`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const list = await getPriceList(req.params.companyId, req.params.id);
      if (!list) return res.status(404).json({ message: "Price list not found" });
      res.json(list);
    })
  );

  app.put(
    `${base}/:id`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const list = await updatePriceList(req.params.companyId, req.params.id, updateSchema.parse(req.body ?? {}));
      if (!list) return res.status(404).json({ message: "Price list not found" });
      res.json(list);
    })
  );

  app.delete(
    `${base}/:id`,
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await deletePriceList(req.params.companyId, req.params.id))) return res.status(404).json({ message: "Price list not found" });
      res.json({ message: "Price list deleted" });
    })
  );
}
