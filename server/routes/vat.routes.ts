import { and,eq } from "drizzle-orm";
import type { Express,Request,Response } from "express";
import { vatReturns,type InsertVatReturn } from "../../shared/schema";
import { db } from "../db";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import {
calculateVatReturn,
computeDueDate,
frequencyFromCompany,
type VatAutopilotCalculation,
} from "../services/vat-autopilot.service";
import { storage } from "../storage";

function buildVatReturnPayload(
  companyId: string,
  createdBy: string,
  calc: VatAutopilotCalculation,
  status = 'draft',
): InsertVatReturn {
  const vat201 = calc.vat201;
  return {
    companyId,
    periodStart: calc.period.start,
    periodEnd: calc.period.end,
    dueDate: calc.period.dueDate,
    status,
    vatStagger: calc.period.frequency,
    ...vat201,
    box1aAbuDhabiAdj: 0,
    box1bDubaiAdj: 0,
    box1cSharjahAdj: 0,
    box1dAjmanAdj: 0,
    box1eUmmAlQuwainAdj: 0,
    box1fRasAlKhaimahAdj: 0,
    box1gFujairahAdj: 0,
    box2TouristRefundAmount: 0,
    box2TouristRefundVat: 0,
    box6ImportsAmount: 0,
    box6ImportsVat: 0,
    box7ImportsAdjAmount: 0,
    box7ImportsAdjVat: 0,
    box8TotalAdj: 0,
    box9ExpensesAdj: 0,
    box11TotalAdj: 0,
    box1SalesStandard: calc.boxes.standardRatedSales,
    box2SalesOtherEmirates: 0,
    box3SalesTaxExempt: calc.boxes.zeroRatedSales,
    box4SalesExempt: calc.boxes.exemptSales,
    box5TotalOutputTax: calc.boxes.totalOutputVat,
    box6ExpensesStandard: calc.boxes.totalExpenses,
    box7ExpensesTouristRefund: 0,
    box8TotalInputTax: calc.boxes.totalInputVat,
    box9NetTax: calc.boxes.netVatPayable,
    createdBy,
  };
}

const draftVatReturnPatchFields = new Set([
  'adjustmentAmount',
  'adjustmentReason',
  'notes',
  'declarantName',
  'declarantPosition',
  'declarationDate',
]);

const filingVatReturnPatchFields = new Set([
  'ftaReferenceNumber',
  'paymentStatus',
  'paymentAmount',
  'paymentDate',
  'notes',
]);

function buildAllowlistedVatPatch(body: Record<string, unknown>, terminal: boolean): Record<string, unknown> {
  const allowed = terminal ? filingVatReturnPatchFields : draftVatReturnPatchFields;
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.has(key)) {
      throw new Error(`VAT return field is not editable: ${key}`);
    }
    if ((key === 'paymentDate' || key === 'declarationDate') && value) {
      patch[key] = new Date(String(value));
    } else {
      patch[key] = value;
    }
  }
  return patch;
}

export function registerVATRoutes(app: Express) {
  // =====================================
  // VAT RETURNS
  // =====================================

  // Get VAT returns by company
  app.get("/api/companies/:companyId/vat-returns", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const vatReturns = await storage.getVatReturnsByCompanyId(companyId);
    res.json(vatReturns);
  }));

  // Generate VAT return (FTA VAT 201 format with emirate breakdown)
  app.post("/api/companies/:companyId/vat-returns/generate", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { companyId } = req.params;
    const { periodStart, periodEnd } = req.body;

    const hasAccess = await storage.hasCompanyAccess(userId, companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Generating a VAT return for a period that is already closed would
    // produce numbers that disagree with the locked-period books. Block it.
    if (periodEnd) {
      await assertPeriodNotLocked(companyId, periodEnd);
    }

    // Get company information for emirate and VAT registration
    const company = await storage.getCompany(companyId);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    // Validate VAT registration
    if (!company.trnVatNumber) {
      return res.status(400).json({
        message: 'Company must have a TRN/VAT number to generate VAT returns. Please update your company profile.',
        code: 'NO_TRN'
      });
    }

    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ message: 'Invalid VAT period dates' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ message: 'periodStart must be before periodEnd' });
    }

    const period = {
      start: startDate,
      end: endDate,
      dueDate: computeDueDate(endDate),
      frequency: frequencyFromCompany(company.vatFilingFrequency),
    };
    const calc = await calculateVatReturn(companyId, period);

    const [existing] = await db
      .select()
      .from(vatReturns)
      .where(and(
        eq(vatReturns.companyId, companyId),
        eq(vatReturns.periodStart, startDate),
        eq(vatReturns.periodEnd, endDate),
      ))
      .limit(1);

    if (existing && ['submitted', 'filed'].includes(existing.status)) {
      return res.status(200).json({
        ...existing,
        _metadata: {
          immutable: true,
          invoicesProcessed: calc.invoicesProcessed,
          receiptsProcessed: calc.receiptsProcessed,
          companyEmirate: company.emirate || 'dubai',
          trnNumber: company.trnVatNumber,
          ...calc.boxes,
          partialExemption: calc.partialExemption,
          reconciliation: calc.reconciliation,
        },
      });
    }

    const payload = buildVatReturnPayload(companyId, userId, calc, existing?.status || 'draft');
    const updatePayload = {
      ...payload,
      createdBy: existing?.createdBy || payload.createdBy,
      updatedAt: new Date(),
    };

    const [vatReturn] = await db
      .insert(vatReturns)
      .values(payload)
      .onConflictDoUpdate({
        target: [vatReturns.companyId, vatReturns.periodStart, vatReturns.periodEnd],
        set: updatePayload,
      })
      .returning();

    res.status(existing ? 200 : 201).json({
      ...vatReturn,
      _metadata: {
        invoicesProcessed: calc.invoicesProcessed,
        receiptsProcessed: calc.receiptsProcessed,
        companyEmirate: company.emirate || 'dubai',
        trnNumber: company.trnVatNumber,
        ...calc.boxes,
        partialExemption: calc.partialExemption,
        reconciliation: calc.reconciliation,
      },
    });
  }));

  // Submit VAT return
  app.post("/api/vat-returns/:id/submit", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { id } = req.params;
    const { adjustmentAmount, adjustmentReason, notes } = req.body;

    const existing = await storage.getVatReturn(id);
    if (!existing) {
      return res.status(404).json({ message: 'VAT return not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Submitting the return finalises the VAT settlement against periodEnd —
    // refuse if the underlying period is already closed.
    await assertPeriodNotLocked(existing.companyId, existing.periodEnd as any);


    const vatReturn = await storage.updateVatReturn(id, {
      status: 'submitted',
      adjustmentAmount: adjustmentAmount || 0,
      adjustmentReason: adjustmentReason || null,
      notes: notes || null,
      submittedBy: userId,
      submittedAt: new Date(),
    });

    res.json(vatReturn);
  }));

  // Update VAT return (for editing draft returns)
  app.patch("/api/vat-returns/:id", authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const { id } = req.params;
    const updateData = req.body as Record<string, unknown>;

    const existing = await storage.getVatReturn(id);
    if (!existing) {
      return res.status(404).json({ message: 'VAT return not found' });
    }

    const hasAccess = await storage.hasCompanyAccess(userId, existing.companyId);
    if (!hasAccess) {
      return res.status(403).json({ message: 'Access denied' });
    }

    let patch: Record<string, unknown>;
    try {
      patch = buildAllowlistedVatPatch(
        updateData,
        ['submitted', 'filed'].includes(existing.status),
      );
    } catch (err: any) {
      return res.status(422).json({ message: err.message, code: 'VAT_RETURN_FIELD_LOCKED' });
    }

    const vatReturn = await storage.updateVatReturn(id, patch as Partial<InsertVatReturn>);

    res.json(vatReturn);
  }));
}
