/**
 * Company write contract shared by POST /api/companies, PUT/PATCH /api/companies/:id and
 * PATCH /api/companies/:id/preferences (W2-D: R14-07, R14-13, R14-20, R17-05, R17-09).
 *
 * One schema, four paths: the TRN rule, fiscal-year month, base currency and logo rules cannot
 * drift apart any more. Server-owned keys (id, deletedAt, isActive, classifierConfig,
 * onboardingCompleted, ...) are not declared, so `strictBody` rejects them.
 */
import { z } from "zod";
import { ISO_4217_CODES, zEmirate, zText } from "./primitives";

/**
 * Inline logos are capped at 1 MB of data URL (~750 KB of image). The JSON body limit for
 * company routes is 1 MB, so a larger value could never arrive anyway; this makes the rule
 * explicit and gives a clean 400. Uploaded logos (POST /api/companies/:id/logo) cap the
 * decoded image at LOGO_MAX_BYTES.
 */
export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_MAX_DATA_URL_CHARS = 1_000_000;

const ISO_CODES = new Set<string>(ISO_4217_CODES as readonly string[]);

/** "" and null both mean "clear this optional field". */
function optionalText(max: number) {
  return z
    .union([z.literal(""), zText(max), z.null()])
    .transform((v) => (v === "" ? null : v))
    .optional();
}

const baseCurrency = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => ISO_CODES.has(s), "Unknown ISO 4217 currency code");

/** TRN: exactly 15 digits; "" clears it. */
const trn = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .regex(/^\d{15}$/, "TRN must be exactly 15 digits"),
    z.null(),
  ])
  .transform((v) => (v === "" ? null : v))
  .optional();

/** https URL or raster data:image URL under the 1 MB cap. Never javascript:, http:, svg. */
const logoUrl = z
  .union([z.literal(""), z.string().trim(), z.null()])
  .transform((v, ctx) => {
    if (v === "" || v === null) return null;
    if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(v)) {
      if (v.length > LOGO_MAX_DATA_URL_CHARS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Logo must be 1 MB or smaller" });
        return z.NEVER;
      }
      return v;
    }
    try {
      const u = new URL(v);
      if (u.protocol === "https:" && u.hostname.length > 0 && v.length <= 2048) return v;
    } catch {
      // fall through
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Logo must be an https:// URL or a PNG/JPEG/GIF/WebP data:image under 1 MB",
    });
    return z.NEVER;
  })
  .optional();

const websiteUrl = z
  .union([z.literal(""), z.string().trim().max(2048), z.null()])
  .transform((v, ctx) => {
    if (v === "" || v === null) return null;
    try {
      const u = new URL(v);
      if (u.protocol === "https:" || u.protocol === "http:") return v;
    } catch {
      // fall through
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Website must be an http(s) URL" });
    return z.NEVER;
  })
  .optional();

const email = z
  .union([
    z.literal(""),
    z.string().trim().toLowerCase().email("Invalid email address").max(254),
    z.null(),
  ])
  .transform((v) => (v === "" ? null : v))
  .optional();

const taxRegistrationDate = z
  .union([z.literal(""), z.string(), z.date(), z.null()])
  .transform((v, ctx) => {
    if (v === "" || v === null) return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1990 || d.getUTCFullYear() > 2100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid tax registration date" });
      return z.NEVER;
    }
    return d;
  })
  .optional();

const emirate = z
  .union([z.literal(""), zEmirate, z.null()])
  .transform((v) => (v === "" ? null : v))
  .optional();

const fraction = z.number().min(0).max(1);

export const companyFields = {
  name: zText(200, { min: 2 }),
  legalName: optionalText(200),
  baseCurrency: baseCurrency.optional(),
  locale: z.enum(["en", "ar"]).optional(),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  defaultVatRate: fraction.optional(),
  // Only a platform admin may set anything other than "customer"; enforced in the route.
  companyType: z.string().trim().max(20).optional(),
  legalStructure: optionalText(100),
  industry: optionalText(100),
  registrationNumber: optionalText(100),
  businessAddress: optionalText(300),
  addressStreet: optionalText(200),
  addressCity: optionalText(100),
  addressCountry: optionalText(2),
  contactPhone: optionalText(40),
  contactEmail: email,
  websiteUrl,
  logoUrl,
  trnVatNumber: trn,
  taxRegistrationType: optionalText(100),
  vatFilingFrequency: optionalText(50),
  taxRegistrationDate,
  corporateTaxId: optionalText(50),
  emirate,
  mohreEstablishmentId: optionalText(50),
  wpsEmployerBankName: optionalText(100),
  wpsEmployerIban: optionalText(40),
  wpsEmployerRoutingCode: optionalText(40),
  exemptSupplyRatio: fraction.optional(),
  vatAutoCalculate: z.boolean().optional(),
  vatPeriodStartMonth: z.number().int().min(1).max(12).optional(),
  // Legacy no-op: old clients/tests send it; there is no such column and it is never stored.
  vatRegistered: z.boolean().optional(),
  invoiceShowLogo: z.boolean().optional(),
  invoiceShowAddress: z.boolean().optional(),
  invoiceShowPhone: z.boolean().optional(),
  invoiceShowEmail: z.boolean().optional(),
  invoiceShowWebsite: z.boolean().optional(),
  invoiceCustomTitle: optionalText(100),
  invoiceFooterNote: optionalText(500),
};

/** Create: name is required. */
export const createCompanyBody = z.object({ ...companyFields, name: companyFields.name });
export type CreateCompanyBody = z.output<typeof createCompanyBody>;

/** PUT / PATCH / PATCH preferences: every field optional. */
export const updateCompanyBody = z.object(companyFields).partial();
export type UpdateCompanyBody = z.output<typeof updateCompanyBody>;

/** Fiscal-year start month (1-12) for a company row; defaults to January. Reporting uses this. */
export function fiscalYearStartMonthOf(company: { fiscalYearStartMonth?: number | null }): number {
  const m = Number(company.fiscalYearStartMonth);
  return Number.isInteger(m) && m >= 1 && m <= 12 ? m : 1;
}

/** Start date (UTC, "YYYY-MM-DD") of the fiscal year containing `asOf`. */
export function fiscalYearStartFor(
  company: { fiscalYearStartMonth?: number | null },
  asOf: Date = new Date()
): string {
  const startMonth = fiscalYearStartMonthOf(company);
  let year = asOf.getUTCFullYear();
  if (asOf.getUTCMonth() + 1 < startMonth) year -= 1;
  return `${String(year).padStart(4, "0")}-${String(startMonth).padStart(2, "0")}-01`;
}
