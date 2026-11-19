/**
 * Request-body contracts for small write routes that used to destructure `req.body` directly
 * (found by the property-pick patterns of scripts/check-raw-body.mjs). Every schema is `.strict()`
 * so `strictBody` rejects unknown keys with a 400.
 */
import { z } from "zod";
import { zText } from "./primitives";

const id = z.string().trim().min(1).max(100);
const rows = (max: number) => z.array(z.record(z.string(), z.unknown())).max(max);

/** POST /api/companies/:companyId/ai-gl/queue/:id/correct */
export const aiGlCorrectBody = z.object({ accountId: id }).strict();
/** POST /api/companies/:companyId/billing/checkout */
export const billingCheckoutBody = z
  .object({ planId: id, billingCycle: z.enum(["monthly", "yearly"]) })
  .strict();
/** POST /api/companies/:companyId/customer-contacts/import */
export const contactsImportBody = z.object({ contacts: rows(10_000).min(1) }).strict();
/** DELETE /api/companies/:companyId/customer-contacts/clear-all */
export const contactsClearBody = z.object({ confirm: z.string().max(40).optional() }).strict();
const sheetData = z.object({
  name: z.string().max(200),
  headers: z.array(z.string().max(500)).max(500),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(100_000),
});
/** Google Sheets export / import bodies (companyId is checked by requireCompanyAccess("body")). */
export const sheetsExportBody = z
  .object({ companyId: id, spreadsheetId: z.string().trim().max(200).optional() })
  .strict();
export const sheetsImportBody = z
  .object({ companyId: id, sheetUrl: zText(2048, { min: 1 }) })
  .strict();
export const sheetsCustomExportBody = z
  .object({
    companyId: id,
    title: zText(300, { min: 1 }),
    sheets: z.array(sheetData).min(1).max(100),
  })
  .strict();
/** POST /api/ocr/process */
export const ocrProcessBody = z
  .object({
    messageId: z.string().max(200).optional().nullable(),
    content: z.string().max(200_000).optional().nullable(),
    imageData: z.string().optional().nullable(),
    companyId: id.optional().nullable(),
  })
  .strict();
/** PATCH /api/onboarding */
export const onboardingPatchBody = z
  .object({
    hasCompletedWelcome: z.boolean().optional(),
    hasCreatedCompany: z.boolean().optional(),
    hasSetupChartOfAccounts: z.boolean().optional(),
    hasCreatedFirstInvoice: z.boolean().optional(),
    hasUploadedFirstReceipt: z.boolean().optional(),
    hasViewedReports: z.boolean().optional(),
    hasExploredAI: z.boolean().optional(),
    hasConfiguredReminders: z.boolean().optional(),
    showTips: z.boolean().optional(),
    showTour: z.boolean().optional(),
    dismissedTips: z.string().max(10_000).optional().nullable(),
    tourDismissed: z.boolean().optional(),
  })
  .strict();
/** POST /api/companies/:companyId/receipts/check-similar */
export const receiptCheckSimilarBody = z
  .object({
    merchant: z.string().max(300).optional().nullable(),
    amount: z
      .union([z.number(), z.string().max(40)])
      .optional()
      .nullable(),
    date: z.string().max(40).optional().nullable(),
  })
  .strict();
/** POST /api/integrations/whatsapp/log-message */
export const whatsappLogMessageBody = z
  .object({ to: zText(40, { min: 1 }), message: zText(10_000, { min: 1 }) })
  .strict();
/** PUT /api/integrations/whatsapp/rules */
export const whatsappRulesBody = z.object({ rules: rows(500) }).strict();
/** Chase-request generation (firm email intake). */
export const chaseRequestsBody = z
  .object({
    periodStart: z.string().max(40).optional(),
    periodEnd: z.string().max(40).optional(),
    dueDate: z.string().max(40).optional().nullable(),
  })
  .strict();
