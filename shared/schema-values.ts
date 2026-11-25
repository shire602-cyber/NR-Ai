/**
 * Runtime (non-table) exports of shared/schema.ts that client pages import.
 * They live here, free of drizzle-orm/drizzle-zod, so the client bundle does
 * not load shared/schema.ts: drizzle-zod 0.8 keeps the whole zod 4 namespace
 * (every locale) alive, which grew the forms vendor chunk ~4x (R17-27).
 * shared/schema.ts re-exports them, so `@shared/schema` imports keep working.
 */
import { z } from "zod";

// Schema for the QuickBooks-style Company Preferences page (PATCH /api/companies/:id).
// All fields are optional so the page can be saved partially and so legacy clients
// that omit a field continue to work.
export const companyPreferencesSchema = z.object({
  name: z.string().min(2, "Company name must be at least 2 characters").optional(),
  legalName: z.string().max(200).optional().nullable(),
  trnVatNumber: z
    .string()
    .regex(/^\d{15}$/u, "TRN must be exactly 15 digits")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  baseCurrency: z
    .enum(["AED", "USD", "EUR", "GBP", "SAR", "QAR", "KWD", "BHD", "OMR", "INR"]) // common GCC + global currencies
    .optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  defaultVatRate: z.number().min(0).max(1).optional(), // stored as fraction (0.05 = 5%)
  addressStreet: z.string().max(200).optional().nullable(),
  addressCity: z.string().max(100).optional().nullable(),
  emirate: z
    .enum(["abu_dhabi", "dubai", "sharjah", "ajman", "umm_al_quwain", "ras_al_khaimah", "fujairah"])
    .optional()
    .nullable(),
  addressCountry: z.string().max(2).optional().nullable(), // ISO-3166 alpha-2
  contactPhone: z.string().max(40).optional().nullable(),
  contactEmail: z
    .string()
    .email("Invalid email address")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  industry: z.string().max(100).optional().nullable(),
  // W2-D: same rule as shared/validators/companies.ts (https or raster data:image, ~1 MB cap).
  logoUrl: z
    .string()
    .max(1_000_000, "Logo must be 1 MB or smaller")
    .refine(
      (v) =>
        v === "" ||
        /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v) ||
        /^https:\/\/[^\s/]+/i.test(v),
      "Logo must be an https:// URL or a PNG/JPEG/GIF/WebP image"
    )
    .optional()
    .nullable(),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
  locale: z.enum(["en", "ar"]).optional(),
});

// UAE-specific document types — kept as a const tuple so the Zod enum below
// stays in lockstep. Free-form types are stored under "other".
export const DOCUMENT_TYPES = [
  "trade_license",
  "emirates_id",
  "visa_copy",
  "passport_copy",
  "bank_statement",
  "tenancy_contract",
  "moa_aoa",
  "vat_certificate",
  "corporate_tax_certificate",
  "esr_notification",
  "esr_report",
  "audited_financials",
  "invoice",
  "receipt",
  "payslip",
  "other",
] as const;

export const COMPLIANCE_EVENT_TYPES = [
  "trade_license_renewal",
  "visa_expiry",
  "emirates_id_expiry",
  "vat_filing",
  "corporate_tax_filing",
  "esr_notification",
  "esr_report",
  "tenancy_renewal",
  "audit_deadline",
  "other",
] as const;
