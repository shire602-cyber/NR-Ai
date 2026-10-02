import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { validate } from "../middleware/validate";
import { storage } from "../storage";
import { billQuantitySchema, billUnitPriceSchema } from "../services/bill-line-math";
import { recordAudit } from "../services/audit.service";
import {
  applyVendorCredit,
  approveVendorCredit,
  createVendorCredit,
  getVendorCredit,
  listVendorCredits,
  updateVendorCredit,
  voidVendorCredit,
} from "../services/vendor-credit.service";

const isoDate = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Must be a valid ISO date" });

const lineSchema = z.object({
  description: z.string().min(1, "Line description is required").max(500),
  quantity: billQuantitySchema.optional(),
  unit_price: billUnitPriceSchema,
  // UAE VAT: only 0% and 5% exist. Accept percent (5) or decimal (0.05) form.
  vat_rate: z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .refine(
      (v) => {
        if (v === null || v === undefined || v === "") return true;
        const n = Number(v);
        return n === 0 || n === 5 || n === 0.05;
      },
      { message: "VAT rate must be 0% or 5% (UAE)" }
    ),
  account_id: z.string().uuid().optional().nullable(),
});

const rateSchema = z
  .union([z.number(), z.string()])
  .optional()
  .nullable()
  .refine((v) => v === null || v === undefined || v === "" || Number(v) > 0, {
    message: "exchange_rate must be positive",
  });

const createSchema = z.object({
  vendor_id: z.string().uuid().optional().nullable(),
  vendor_name: z.string().min(1).max(255).optional(),
  vendor_trn: z.string().max(20).optional().nullable(),
  bill_id: z.string().uuid().optional().nullable(),
  vendor_reference: z.string().max(64).optional().nullable(),
  date: isoDate,
  currency: z.string().length(3).optional(),
  exchange_rate: rateSchema,
  reverse_charge: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
  line_items: z.array(lineSchema).min(1, "At least one line item is required"),
});

const updateSchema = createSchema.partial();

const applySchema = z.object({
  bill_id: z.string().uuid(),
  amount: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === "string" ? Number(v) : v))
    .pipe(z.number().positive("Amount must be positive")),
});

const voidSchema = z.object({ reason: z.string().max(500).optional().nullable() });

export function registerVendorCreditRoutes(app: Express) {
  const base = "/api/companies/:companyId/vendor-credits";

  // Same access gate as bill-pay: authenticated customer with access to the company.
  const access = async (req: Request, res: Response): Promise<boolean> => {
    const ok = await storage.hasCompanyAccess(req.user!.id, req.params.companyId);
    if (!ok) res.status(403).json({ message: "Access denied" });
    return ok;
  };

  app.get(
    base,
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      const { status, vendor, billId } = req.query;
      res.json(
        await listVendorCredits(req.params.companyId, {
          status: typeof status === "string" ? status : undefined,
          vendor: typeof vendor === "string" ? vendor : undefined,
          billId: typeof billId === "string" ? billId : undefined,
        })
      );
    })
  );

  app.get(
    `${base}/:id`,
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      const credit = await getVendorCredit(req.params.companyId, req.params.id);
      if (!credit) return res.status(404).json({ message: "Vendor credit note not found" });
      res.json(credit);
    })
  );

  app.post(
    base,
    authMiddleware,
    requireCustomer,
    validate({ body: createSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      const credit = await createVendorCredit(req.params.companyId, req.user!.id, req.body);
      await recordAudit({
        userId: req.user!.id,
        companyId: req.params.companyId,
        action: "vendor_credit.create",
        entityType: "vendor_credit_note",
        entityId: credit!.id,
        after: { number: credit!.number, total: credit!.total, currency: credit!.currency },
        req,
      });
      res.status(201).json(credit);
    })
  );

  app.patch(
    `${base}/:id`,
    authMiddleware,
    requireCustomer,
    validate({ body: updateSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      res.json(await updateVendorCredit(req.params.companyId, req.params.id, req.body));
    })
  );

  app.post(
    `${base}/:id/approve`,
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      const credit = await approveVendorCredit(req.params.companyId, req.params.id, req.user!.id);
      await recordAudit({
        userId: req.user!.id,
        companyId: req.params.companyId,
        action: "vendor_credit.approve",
        entityType: "vendor_credit_note",
        entityId: req.params.id,
        before: { status: "draft" },
        after: { status: "approved", number: credit!.number, total: credit!.total, currency: credit!.currency },
        req,
      });
      res.json(credit);
    })
  );

  app.post(
    `${base}/:id/apply`,
    authMiddleware,
    requireCustomer,
    validate({ body: applySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      const result = await applyVendorCredit(req.params.companyId, req.params.id, req.body, req.user!.id);
      await recordAudit({
        userId: req.user!.id,
        companyId: req.params.companyId,
        action: "vendor_credit.apply",
        entityType: "vendor_credit_note",
        entityId: req.params.id,
        after: { billId: req.body.bill_id, amount: Number(req.body.amount), billStatus: result.bill_status },
        req,
      });
      res.json(result);
    })
  );

  app.post(
    `${base}/:id/void`,
    authMiddleware,
    requireCustomer,
    validate({ body: voidSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      if (!(await access(req, res))) return;
      const credit = await voidVendorCredit(req.params.companyId, req.params.id, req.user!.id, req.body?.reason);
      await recordAudit({
        userId: req.user!.id,
        companyId: req.params.companyId,
        action: "vendor_credit.void",
        entityType: "vendor_credit_note",
        entityId: req.params.id,
        after: { status: "void", number: credit!.number },
        req,
      });
      res.json(credit);
    })
  );
}
