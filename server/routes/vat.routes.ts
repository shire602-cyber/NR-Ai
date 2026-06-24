import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { UAE_VAT_RATE } from "../constants";
import { pool } from "../db";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import {
  addVatWorkpaperRow,
  addVatWorkpaperRowsBulk,
  bulkUpdateVatWorkpaperRowStatus,
  createVatWorkpaper,
  deleteVatWorkpaperRow,
  generateVatReturnFromWorkpaper,
  getVatWorkpaperDetail,
  listVatWorkpapers,
  postVatWorkpaperRowToLedger,
  pullVatWorkpaperRowsFromBooks,
  recalculateVatWorkpaper,
  updateVatWorkpaperRow,
  VAT_WORKPAPER_CATEGORIES,
} from "../services/firm-vat-workspace.service";
import {
  buildVatWorkpaperWorkbook,
  vatWorkpaperExportFilename,
} from "../services/vat-workpaper-export.service";

const companyScopedWorkpaperParams = z.object({
  companyId: z.string().uuid(),
  workpaperId: z.string().uuid(),
});

const companyScopedWorkpaperRowParams = companyScopedWorkpaperParams.extend({
  rowId: z.string().uuid(),
});

const vatWorkpaperRowSchema = z.object({
  rowCategory: z.enum(VAT_WORKPAPER_CATEGORIES),
  vat201Box: z.string().trim().optional().nullable(),
  invoiceNumber: z.string().trim().max(120).optional().nullable(),
  documentDate: z.string().optional().nullable(),
  counterpartyName: z.string().trim().max(255).optional().nullable(),
  counterpartyTrn: z.string().trim().max(32).optional().nullable(),
  emirate: z.string().trim().max(80).optional().nullable(),
  taxableAmount: z.coerce.number().optional().nullable(),
  vatAmount: z.coerce.number().optional().nullable(),
  adjustmentAmount: z.coerce.number().optional().nullable(),
  grossAmount: z.coerce.number().optional().nullable(),
  status: z.enum(["draft", "approved", "excluded"]).optional(),
  sourceMethod: z.enum(["manual", "ocr", "import", "generated"]).optional(),
  sourceDocumentType: z.string().trim().max(80).optional().nullable(),
  sourceDocumentId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  auditReason: z.string().trim().max(2000).optional().nullable(),
});

const partialVatWorkpaperRowSchema = vatWorkpaperRowSchema.partial().extend({
  rowCategory: z.enum(VAT_WORKPAPER_CATEGORIES).optional(),
});

const createCompanyWorkpaperSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  dueDate: z.string().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

const bulkVatWorkpaperRowsSchema = z.object({
  rows: z.array(vatWorkpaperRowSchema).min(1).max(2000),
});

async function requireCompanyAccess(req: Request, res: Response, companyId: string) {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" });
    return null;
  }
  const hasAccess = await storage.hasCompanyAccess(userId, companyId);
  if (!hasAccess) {
    res.status(403).json({ message: "Access denied" });
    return null;
  }
  return userId as string;
}

async function requireCompanyWorkpaperAccess(
  req: Request,
  res: Response,
  companyId: string,
  workpaperId: string
) {
  const userId = await requireCompanyAccess(req, res, companyId);
  if (!userId) return null;
  const detail = await getVatWorkpaperDetail(workpaperId);
  if (detail.workpaper.companyId !== companyId) {
    res.status(404).json({ message: "VAT workpaper not found" });
    return null;
  }
  return { userId, detail };
}

export function registerVATRoutes(app: Express) {
  // =====================================
  // VAT WORKPAPERS
  // =====================================

  app.get(
    "/api/companies/:companyId/vat-workpapers",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;

      const workpapers = await listVatWorkpapers([companyId], companyId, { clientOnly: false });
      res.json({ workpapers });
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = await requireCompanyAccess(req, res, companyId);
      if (!userId) return;

      const parsed = createCompanyWorkpaperSchema.parse(req.body);
      const workpaper = await createVatWorkpaper({
        companyId,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        dueDate: parsed.dueDate ?? null,
        notes: parsed.notes ?? null,
        createdBy: userId,
      });
      res.status(201).json(workpaper);
    })
  );

  app.get(
    "/api/companies/:companyId/vat-workpapers/:workpaperId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;
      res.json(result.detail);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const row = vatWorkpaperRowSchema.parse(req.body);
      const created = await addVatWorkpaperRow(parsedParams.data.workpaperId, result.userId, row);
      res.status(201).json(created);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/bulk",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const parsed = bulkVatWorkpaperRowsSchema.parse(req.body);
      const created = await addVatWorkpaperRowsBulk(
        parsedParams.data.workpaperId,
        result.userId,
        parsed.rows
      );
      res.status(201).json({ created: created.length });
    })
  );

  app.patch(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/:rowId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperRowParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const row = partialVatWorkpaperRowSchema.parse(req.body);
      const updated = await updateVatWorkpaperRow(
        parsedParams.data.workpaperId,
        parsedParams.data.rowId,
        result.userId,
        row
      );
      res.json(updated);
    })
  );

  app.delete(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/:rowId",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperRowParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const deleted = await deleteVatWorkpaperRow(
        parsedParams.data.workpaperId,
        parsedParams.data.rowId
      );
      res.json(deleted);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/:rowId/post",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperRowParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper row id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const posted = await postVatWorkpaperRowToLedger(
        parsedParams.data.workpaperId,
        parsedParams.data.rowId,
        result.userId
      );
      res.json(posted);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/rows/bulk-status",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsedParams = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsedParams.success)
        return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsedParams.data.companyId,
        parsedParams.data.workpaperId
      );
      if (!result) return;

      const body = z
        .object({
          to: z.enum(["approved", "excluded"]),
          rowIds: z.array(z.string().uuid()).max(2000).optional(),
        })
        .parse(req.body);
      const updated = await bulkUpdateVatWorkpaperRowStatus(
        parsedParams.data.workpaperId,
        result.userId,
        body
      );
      res.json(updated);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/pull-from-books",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;

      const pulled = await pullVatWorkpaperRowsFromBooks(parsed.data.workpaperId, result.userId);
      res.json(pulled);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/recalculate",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;

      const recalculated = await recalculateVatWorkpaper(parsed.data.workpaperId);
      res.json(recalculated);
    })
  );

  app.get(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/export",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;

      const buffer = await buildVatWorkpaperWorkbook(result.detail);
      const filename = vatWorkpaperExportFilename(result.detail);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    })
  );

  app.post(
    "/api/companies/:companyId/vat-workpapers/:workpaperId/generate-return",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = companyScopedWorkpaperParams.safeParse(req.params);
      if (!parsed.success) return res.status(400).json({ message: "Invalid VAT workpaper id" });

      const result = await requireCompanyWorkpaperAccess(
        req,
        res,
        parsed.data.companyId,
        parsed.data.workpaperId
      );
      if (!result) return;

      const company = await storage.getCompany(parsed.data.companyId);
      if (!company?.trnVatNumber) {
        return res.status(400).json({
          message:
            "Company must have a TRN/VAT number to generate VAT returns. Please update your company profile.",
          code: "NO_TRN",
        });
      }

      const generated = await generateVatReturnFromWorkpaper(
        parsed.data.workpaperId,
        result.userId
      );
      res.json({
        ...generated,
        message: "VAT return generated from approved workpaper rows. No FTA submission was made.",
      });
    })
  );

  // =====================================
  // VAT RETURNS
  // =====================================

  // Get VAT returns by company
  app.get(
    "/api/companies/:companyId/vat-returns",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const vatReturns = await storage.getVatReturnsByCompanyId(companyId);
      res.json(vatReturns);
    })
  );

  // Generate VAT return (FTA VAT 201 format with emirate breakdown)
  app.post(
    "/api/companies/:companyId/vat-returns/generate",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { companyId } = req.params;
      const { periodStart, periodEnd } = req.body;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Generating a VAT return for a period that is already closed would
      // produce numbers that disagree with the locked-period books. Block it.
      if (periodEnd) {
        await assertPeriodNotLocked(companyId, periodEnd);
      }

      // Get company information for emirate and VAT registration
      const company = await storage.getCompany(companyId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      // Validate VAT registration
      if (!company.trnVatNumber) {
        return res.status(400).json({
          message:
            "Company must have a TRN/VAT number to generate VAT returns. Please update your company profile.",
          code: "NO_TRN",
        });
      }

      const companyEmirate = company.emirate || "dubai";

      // Calculate VAT from invoices and receipts
      const invoices = await storage.getInvoicesByCompanyId(companyId);
      const receipts = await storage.getReceiptsByCompanyId(companyId);

      const startDate = new Date(periodStart);
      // periodEnd is a calendar date — include the entire final day so
      // invoices timestamped during it aren't dropped from the return.
      const endDate = new Date(periodEnd);
      if (typeof periodEnd === "string" && !periodEnd.includes("T")) {
        endDate.setUTCHours(23, 59, 59, 999);
      }

      // Filter invoices for the period — drafts must be excluded too because
      // they have not been issued and therefore create no VAT obligation.
      const periodInvoices = invoices.filter((inv) => {
        const invDate = new Date(inv.date);
        return (
          invDate >= startDate &&
          invDate <= endDate &&
          inv.status !== "void" &&
          inv.status !== "draft" &&
          inv.status !== "cancelled"
        );
      });

      // Fetch all invoice lines for categorization by VAT supply type — single
      // batched fetch instead of one per invoice.
      let standardRatedAmount = 0;
      let standardRatedVat = 0;
      let zeroRatedAmount = 0;
      let exemptAmount = 0;

      const periodLines = await storage.getInvoiceLinesByInvoiceIds(
        periodInvoices.map((i) => i.id)
      );
      // FTA reporting is AED — convert foreign-currency invoice lines at the
      // invoice's stored transaction-date rate.
      const rateByInvoiceId = new Map(
        periodInvoices.map((i) => [
          i.id,
          Number((i as any).exchangeRate) > 0 ? Number((i as any).exchangeRate) : 1,
        ])
      );
      for (const line of periodLines) {
        const fxRate = rateByInvoiceId.get(line.invoiceId) ?? 1;
        const lineAmount = line.quantity * line.unitPrice * fxRate;
        const lineVat = lineAmount * (line.vatRate ?? UAE_VAT_RATE);
        const supplyType = (line as any).vatSupplyType || "standard_rated";

        // Explicit supply type wins; the 0%-rate fallback only catches lines
        // that weren't tagged. An exempt line also carries a 0% rate, so the
        // exempt check must come first (Box 5, not Box 4).
        if (supplyType === "exempt") {
          // Exempt supplies (financial services, residential rent, etc.)
          exemptAmount += lineAmount;
        } else if (supplyType === "zero_rated" || line.vatRate === 0) {
          // Zero-rated supplies (exports, international services)
          zeroRatedAmount += lineAmount;
        } else {
          // Standard rated (5% VAT)
          standardRatedAmount += lineAmount;
          standardRatedVat += lineVat;
        }
      }

      // Credit notes are canonical invoice rows (`invoice_type = 'credit_note'`)
      // with negative invoice lines after A-B11, so the invoice loop above
      // captures them exactly once and applies the invoice exchange rate.

      // Calculate input tax from receipts — only posted receipts can be
      // claimed for input VAT recovery on a VAT return.
      const periodReceipts = receipts.filter((rec) => {
        if (!rec.posted) return false;
        const recDate = new Date(rec.date || rec.createdAt);
        return recDate >= startDate && recDate <= endDate;
      });

      // Split receipts: reverse-charge are reported in Boxes 3 (output) and 10
      // (input side, subject to partial-exemption recovery), ordinary receipts
      // feed Box 9.
      const ordinaryReceipts = periodReceipts.filter((r) => !r.reverseCharge);
      const reverseChargeReceipts = periodReceipts.filter((r) => r.reverseCharge);

      let totalExpenses = ordinaryReceipts.reduce((sum, rec) => sum + (rec.amount || 0), 0);
      let inputTaxGross = ordinaryReceipts.reduce((sum, rec) => sum + (rec.vatAmount || 0), 0);

      let reverseChargeAmount = reverseChargeReceipts.reduce(
        (sum, rec) => sum + (rec.amount || 0),
        0
      );
      let reverseChargeVatGross = reverseChargeReceipts.reduce(
        (sum, rec) => sum + (rec.vatAmount || 0),
        0
      );

      // Vendor bills — pulled direct from vendor_bills since the bill module
      // isn't in Drizzle yet. Reverse-charge bills feed Boxes 3/10; ordinary
      // approved bills carry recoverable input VAT into Box 9 alongside
      // posted receipts. Pending bills are excluded: input VAT is only
      // claimable once the bill is approved (matching when it posts to GL).
      try {
        const billRes = await pool.query(
          `SELECT
             COALESCE(SUM(subtotal * COALESCE(exchange_rate,1)) FILTER (WHERE reverse_charge = true), 0) AS rc_amount,
             COALESCE(SUM(vat_amount * COALESCE(exchange_rate,1)) FILTER (WHERE reverse_charge = true), 0) AS rc_vat,
             COALESCE(SUM(subtotal * COALESCE(exchange_rate,1)) FILTER (WHERE reverse_charge = false), 0) AS std_amount,
             COALESCE(SUM(vat_amount * COALESCE(exchange_rate,1)) FILTER (WHERE reverse_charge = false), 0) AS std_vat
         FROM vendor_bills
         WHERE company_id = $1
           AND bill_date >= $2::date
           AND bill_date <= $3::date
           AND status NOT IN ('void','cancelled','draft','pending')`,
          // Compare calendar dates, not timestamps — casting the JS Date to
          // timestamptz shifts period boundaries in non-UTC server timezones.
          [companyId, startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10)]
        );
        reverseChargeAmount += Number(billRes.rows[0]?.rc_amount || 0);
        reverseChargeVatGross += Number(billRes.rows[0]?.rc_vat || 0);
        totalExpenses += Number(billRes.rows[0]?.std_amount || 0);
        inputTaxGross += Number(billRes.rows[0]?.std_vat || 0);
      } catch (err) {
        // Bill-pay schema may not be installed in dev — fail open, log via parent.
      }

      // Partial-exemption apportionment (FTA Article 55). When a company makes
      // both taxable and exempt supplies, only the taxable portion of input VAT
      // is recoverable. Output VAT (including reverse-charge output in Box 3) is
      // unaffected — only the input/recovery side is reduced.
      const exemptRatio = Math.min(1, Math.max(0, Number(company.exemptSupplyRatio || 0)));
      const recoverableRatio = 1 - exemptRatio;
      const inputTax = Math.round(inputTaxGross * recoverableRatio * 100) / 100;
      const irrecoverableInputTax = Math.round((inputTaxGross - inputTax) * 100) / 100;
      const reverseChargeVat = reverseChargeVatGross; // output side
      const reverseChargeVatRecoverable =
        Math.round(reverseChargeVatGross * recoverableRatio * 100) / 100;

      // Due date is 28 days after period end (FTA requirement)
      const dueDate = new Date(endDate);
      dueDate.setDate(dueDate.getDate() + 28);

      // Determine VAT stagger from company settings or default to quarterly
      const vatStagger = company.vatFilingFrequency === "Monthly" ? "monthly" : "quarterly";

      // Initialize emirate breakdown - all to company's registered emirate
      const emirateBreakdown = {
        box1aAbuDhabiAmount: 0,
        box1aAbuDhabiVat: 0,
        box1aAbuDhabiAdj: 0,
        box1bDubaiAmount: 0,
        box1bDubaiVat: 0,
        box1bDubaiAdj: 0,
        box1cSharjahAmount: 0,
        box1cSharjahVat: 0,
        box1cSharjahAdj: 0,
        box1dAjmanAmount: 0,
        box1dAjmanVat: 0,
        box1dAjmanAdj: 0,
        box1eUmmAlQuwainAmount: 0,
        box1eUmmAlQuwainVat: 0,
        box1eUmmAlQuwainAdj: 0,
        box1fRasAlKhaimahAmount: 0,
        box1fRasAlKhaimahVat: 0,
        box1fRasAlKhaimahAdj: 0,
        box1gFujairahAmount: 0,
        box1gFujairahVat: 0,
        box1gFujairahAdj: 0,
      };

      // Assign standard rated sales to company's emirate
      switch (companyEmirate) {
        case "abu_dhabi":
          emirateBreakdown.box1aAbuDhabiAmount = standardRatedAmount;
          emirateBreakdown.box1aAbuDhabiVat = standardRatedVat;
          break;
        case "sharjah":
          emirateBreakdown.box1cSharjahAmount = standardRatedAmount;
          emirateBreakdown.box1cSharjahVat = standardRatedVat;
          break;
        case "ajman":
          emirateBreakdown.box1dAjmanAmount = standardRatedAmount;
          emirateBreakdown.box1dAjmanVat = standardRatedVat;
          break;
        case "umm_al_quwain":
          emirateBreakdown.box1eUmmAlQuwainAmount = standardRatedAmount;
          emirateBreakdown.box1eUmmAlQuwainVat = standardRatedVat;
          break;
        case "ras_al_khaimah":
          emirateBreakdown.box1fRasAlKhaimahAmount = standardRatedAmount;
          emirateBreakdown.box1fRasAlKhaimahVat = standardRatedVat;
          break;
        case "fujairah":
          emirateBreakdown.box1gFujairahAmount = standardRatedAmount;
          emirateBreakdown.box1gFujairahVat = standardRatedVat;
          break;
        case "dubai":
        default:
          emirateBreakdown.box1bDubaiAmount = standardRatedAmount;
          emirateBreakdown.box1bDubaiVat = standardRatedVat;
          break;
      }

      // Calculate totals. Reverse charge feeds Box 3 (output, full) and Box 10
      // (input, partial-exemption-reduced). Standard input tax (Box 9) is also
      // partial-exemption reduced via `inputTax`.
      const totalOutputAmount =
        standardRatedAmount + zeroRatedAmount + exemptAmount + reverseChargeAmount;
      const totalOutputVat = standardRatedVat + reverseChargeVat;
      const totalInputAmount = totalExpenses + reverseChargeAmount;
      const totalInputVat = inputTax + reverseChargeVatRecoverable;

      // One return per period: regenerating refreshes the existing draft
      // instead of stacking duplicates (and some production databases carry a
      // unique (company, period) index that hard-rejects a second insert).
      // A submitted/filed return is immutable — refuse to regenerate over it.
      const existingReturns = await storage.getVatReturnsByCompanyId(companyId);
      const samePeriod = existingReturns.find(
        (r) =>
          new Date(r.periodStart).getTime() === startDate.getTime() &&
          new Date(r.periodEnd).getTime() === endDate.getTime()
      );
      if (samePeriod && samePeriod.status !== "draft") {
        return res.status(409).json({
          message: `A ${samePeriod.status} VAT return already exists for this period. Submitted returns cannot be regenerated.`,
          code: "VAT_RETURN_EXISTS",
        });
      }

      const persistVatReturn = (data: any) =>
        samePeriod ? storage.updateVatReturn(samePeriod.id, data) : storage.createVatReturn(data);

      const vatReturn = await persistVatReturn({
        companyId,
        periodStart: startDate,
        periodEnd: endDate,
        dueDate,
        status: "draft",
        vatStagger,
        // Emirate breakdown from company registration
        ...emirateBreakdown,
        // Box 2: Tourist Refund Scheme (manual entry needed)
        box2TouristRefundAmount: 0,
        box2TouristRefundVat: 0,
        // Box 3: Reverse charge supplies (imports requiring reverse charge) —
        // OUTPUT side: buyer must self-assess output VAT on these supplies.
        box3ReverseChargeAmount: reverseChargeAmount,
        box3ReverseChargeVat: reverseChargeVat,
        // Box 4: Zero-rated supplies (exports, international services)
        box4ZeroRatedAmount: zeroRatedAmount,
        // Box 5: Exempt supplies (financial services, residential rent)
        box5ExemptAmount: exemptAmount,
        // Box 6: Imports subject to VAT
        box6ImportsAmount: 0,
        box6ImportsVat: 0,
        // Box 7: Adjustments for imports
        box7ImportsAdjAmount: 0,
        box7ImportsAdjVat: 0,
        // Box 8: Total output amounts and VAT
        box8TotalAmount: totalOutputAmount,
        box8TotalVat: totalOutputVat,
        box8TotalAdj: 0,
        // Box 9: Standard rated expenses (input VAT recovery)
        box9ExpensesAmount: totalExpenses,
        box9ExpensesVat: inputTax,
        box9ExpensesAdj: 0,
        // Box 10: Reverse charge on imports (input side) — buyer claims back the
        // self-assessed VAT, reduced by partial-exemption ratio when applicable.
        box10ReverseChargeAmount: reverseChargeAmount,
        box10ReverseChargeVat: reverseChargeVatRecoverable,
        // Box 11: Total input amounts and VAT
        box11TotalAmount: totalInputAmount,
        box11TotalVat: totalInputVat,
        box11TotalAdj: 0,
        // Box 12-14: VAT calculations
        box12TotalDueTax: totalOutputVat,
        box13RecoverableTax: totalInputVat,
        box14PayableTax: totalOutputVat - totalInputVat,
        // Legacy fields for backward compatibility
        box1SalesStandard: standardRatedAmount,
        box2SalesOtherEmirates: 0,
        box3SalesTaxExempt: zeroRatedAmount,
        box4SalesExempt: exemptAmount,
        box5TotalOutputTax: totalOutputVat,
        box6ExpensesStandard: totalExpenses,
        box7ExpensesTouristRefund: 0,
        box8TotalInputTax: totalInputVat,
        box9NetTax: totalOutputVat - totalInputVat,
        createdBy: userId,
      });

      // Return with additional metadata for the UI
      res.status(201).json({
        ...vatReturn,
        _metadata: {
          invoicesProcessed: periodInvoices.length,
          receiptsProcessed: periodReceipts.length,
          companyEmirate,
          trnNumber: company.trnVatNumber,
          standardRatedSales: standardRatedAmount,
          zeroRatedSales: zeroRatedAmount,
          exemptSales: exemptAmount,
          reverseChargeAmount,
          reverseChargeVat,
          reverseChargeVatRecoverable,
          totalInputVat,
          netVatPayable: totalOutputVat - totalInputVat,
          partialExemption: {
            exemptSupplyRatio: exemptRatio,
            recoverableRatio,
            grossInputVat: inputTaxGross,
            recoverableInputVat: inputTax,
            irrecoverableInputVat: irrecoverableInputTax,
          },
        },
      });
    })
  );

  // Submit VAT return
  app.post(
    "/api/vat-returns/:id/submit",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { id } = req.params;
      const { adjustmentAmount, adjustmentReason, notes } = req.body;

      const existing = await storage.getVatReturn(id);
      if (!existing) {
        return res.status(404).json({ message: "VAT return not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Submitting the return finalises the VAT settlement against periodEnd —
      // refuse if the underlying period is already closed.
      await assertPeriodNotLocked(existing.companyId, existing.periodEnd as any);

      const vatReturn = await storage.updateVatReturn(id, {
        status: "submitted",
        adjustmentAmount: adjustmentAmount || 0,
        adjustmentReason: adjustmentReason || null,
        notes: notes || null,
        submittedBy: userId,
        submittedAt: new Date(),
      });

      res.json(vatReturn);
    })
  );

  // Update VAT return (for editing draft returns)
  app.patch(
    "/api/vat-returns/:id",
    authMiddleware,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user?.id;
      const { id } = req.params;
      const updateData = req.body;

      const existing = await storage.getVatReturn(id);
      if (!existing) {
        return res.status(404).json({ message: "VAT return not found" });
      }

      const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Never allow the client to rewrite the tenant scope of a VAT return.
      delete (updateData as any).companyId;
      delete (updateData as any).id;

      const vatReturn = await storage.updateVatReturn(id, {
        ...updateData,
        updatedAt: new Date(),
      });

      res.json(vatReturn);
    })
  );
}
