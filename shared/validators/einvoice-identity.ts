/**
 * WQ5: e-invoicing identity contracts, shared by the server routes and the client forms.
 *
 * - TIN: the UAE Tax Identification Number is 10 digits starting with 1. It is the first 10
 *   digits of the Corporate Tax TRN (the VAT TRN shares the same first 10 digits). It is the
 *   PINT AE EndpointID under scheme 0235 unless the partner registered another participant id.
 * - Seller legal identifier (PINT AE schemeAgencyID): TL trade licence, EID Emirates ID,
 *   PAS passport, CD Cabinet decision.
 * - Contacts: customer and/or supplier role, typed tax registrations, structured address.
 *
 * Pure functions and zod schemas only (no drizzle), so client pages may import this module.
 */
import { z } from "zod";
import { toAsciiDigits } from "../arabic-text";
import { EMIRATES, SUPPLY_TYPES, zText, zUuid } from "./primitives";

export const SELLER_ID_TYPES = ["TL", "EID", "PAS", "CD"] as const;
export type SellerIdType = (typeof SELLER_ID_TYPES)[number];

export const TAX_REGISTRATION_TYPES = ["vat", "ct", "excise", "vat_exception"] as const;
export type TaxRegistrationType = (typeof TAX_REGISTRATION_TYPES)[number];

export const PARTY_TYPES = ["business", "individual"] as const;

/** Fields the "get your first invoice tax-ready" prompt may ask for, in display order. */
export const TAX_READY_FIELDS = [
  "legalName",
  "tin",
  "sellerId",
  "addressStreet",
  "addressCity",
  "emirate",
] as const;
export type TaxReadyField = (typeof TAX_READY_FIELDS)[number];

/** Approver links expire after 14 days. */
export const APPROVER_LINK_TTL_DAYS = 14;

/** 10 digits starting with 1. */
export function isValidTin(value: string | null | undefined): boolean {
  return typeof value === "string" && /^1\d{9}$/.test(value);
}

/** First 10 digits of a 15-digit TRN (CT or VAT), or null. Separators are ignored. */
export function tinFromTaxNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = toAsciiDigits(value).replace(/[\s-]/g, "");
  if (!/^\d{15}$/.test(digits)) return null;
  const tin = digits.slice(0, 10);
  return isValidTin(tin) ? tin : null;
}

export interface TinSource {
  einvoiceTin?: string | null;
  corporateTaxId?: string | null;
  trnVatNumber?: string | null;
}

/** The TIN to use: the stored one, else the first 10 digits of the CT TRN, else the VAT TRN. */
export function effectiveTin(company: TinSource): string | null {
  if (isValidTin(company.einvoiceTin ?? null)) return company.einvoiceTin as string;
  return tinFromTaxNumber(company.corporateTaxId) ?? tinFromTaxNumber(company.trnVatNumber);
}

/**
 * Why a TIN is refused (null when it is fine). The TIN must match the CT TRN and the VAT TRN
 * when those are full 15-digit numbers, because all three come from the same registration.
 */
export function tinProblem(
  tin: string,
  company: { corporateTaxId?: string | null; trnVatNumber?: string | null }
): "TIN_FORMAT" | "TIN_CT_TRN_MISMATCH" | "TIN_VAT_TRN_MISMATCH" | null {
  if (!isValidTin(tin)) return "TIN_FORMAT";
  const ct = tinFromTaxNumber(company.corporateTaxId);
  if (ct && ct !== tin) return "TIN_CT_TRN_MISMATCH";
  const vat = tinFromTaxNumber(company.trnVatNumber);
  if (vat && vat !== tin) return "TIN_VAT_TRN_MISMATCH";
  return null;
}

/**
 * Number format per ID type (null when fine). A passport also needs its issuing country
 * (ISO 3166-1 alpha-2): PINT AE ibr-010/012-ae refuse a passport without it.
 */
export function sellerIdProblem(
  type: SellerIdType,
  number: string,
  country?: string | null
): string | null {
  const v = number.trim();
  if (!v) return "SELLER_ID_REQUIRED";
  if (type === "EID" && !/^784-?\d{4}-?\d{7}-?\d$/.test(v)) return "SELLER_ID_EID_FORMAT";
  if (type === "PAS" && !/^[A-Za-z0-9]{6,12}$/.test(v)) return "SELLER_ID_PASSPORT_FORMAT";
  if (type === "PAS" && !/^[A-Z]{2}$/.test((country ?? "").trim().toUpperCase()))
    return "SELLER_ID_PASSPORT_COUNTRY";
  return null;
}

/** ISO 3166-1 alpha-2 (upper-cased on input). */
const zCountry2 = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, "Use the 2-letter country code")
      .transform((s) => s.toUpperCase()),
    z.null(),
  ])
  .transform((v) => (v === "" ? null : v))
  .optional();

export interface SellerIdentitySource extends TinSource {
  name?: string | null;
  legalName?: string | null;
  sellerIdType?: string | null;
  sellerIdNumber?: string | null;
  sellerIdCountry?: string | null;
  tradeLicenceNo?: string | null;
  registrationNumber?: string | null;
  addressStreet?: string | null;
  businessAddress?: string | null;
  addressCity?: string | null;
  emirate?: string | null;
  addressCountry?: string | null;
}

/** The seller legal identifier PINT AE writes (explicit type/number, else the trade licence). */
export function sellerLegalId(company: SellerIdentitySource): {
  type: SellerIdType;
  number: string;
} | null {
  const type = (SELLER_ID_TYPES as readonly string[]).includes(company.sellerIdType ?? "")
    ? (company.sellerIdType as SellerIdType)
    : null;
  if (type && company.sellerIdNumber?.trim()) {
    return { type, number: company.sellerIdNumber.trim() };
  }
  const tl = company.tradeLicenceNo?.trim() || company.registrationNumber?.trim();
  return tl ? { type: "TL", number: tl } : null;
}

/** Seller fields still missing for e-invoicing (what the tax-ready prompt asks for). */
export function missingSellerFields(company: SellerIdentitySource): TaxReadyField[] {
  const missing: TaxReadyField[] = [];
  if (!(company.legalName?.trim() || company.name?.trim())) missing.push("legalName");
  if (!effectiveTin(company)) missing.push("tin");
  const legal = sellerLegalId(company);
  if (!legal || (legal.type === "PAS" && !company.sellerIdCountry)) missing.push("sellerId");
  if (!(company.addressStreet?.trim() || company.businessAddress?.trim()))
    missing.push("addressStreet");
  if (!company.addressCity?.trim()) missing.push("addressCity");
  const country = (company.addressCountry ?? "AE").toUpperCase();
  if ((country === "AE" || country === "UAE") && !company.emirate) missing.push("emirate");
  return missing;
}

const optText = (max: number) =>
  z
    .union([z.literal(""), zText(max), z.null()])
    .transform((v) => (v === "" ? null : v))
    .optional();

/** PUT /api/companies/:id/einvoicing/identity (the Settings card and the tax-ready prompt). */
export const companyTaxIdentityBody = z
  .object({
    legalName: optText(200),
    legalNameAr: optText(200),
    einvoiceTin: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .transform(toAsciiDigits)
          .pipe(z.string().regex(/^\d{10}$/, "TIN must be 10 digits")),
        z.null(),
      ])
      .transform((v) => (v === "" ? null : v))
      .optional(),
    sellerIdType: z.enum(SELLER_ID_TYPES).nullable().optional(),
    sellerIdNumber: optText(64),
    sellerIdCountry: zCountry2,
    tradeLicenceAuthority: optText(200),
    addressStreet: optText(200),
    addressDistrict: optText(100),
    addressCity: optText(100),
    addressPoBox: optText(20),
    addressAr: optText(300),
    emirate: z.enum(EMIRATES).nullable().optional(),
  })
  .strict();
export type CompanyTaxIdentityBody = z.output<typeof companyTaxIdentityBody>;

export const taxRegistrationSchema = z
  .object({
    type: z.enum(TAX_REGISTRATION_TYPES),
    number: zText(40, { min: 1 }),
  })
  .strict()
  .transform((v) => (v.type === "vat_exception" ? v : { ...v, number: toAsciiDigits(v.number) }))
  .superRefine((v, ctx) => {
    if ((v.type === "vat" || v.type === "ct" || v.type === "excise") && !/^\d{15}$/.test(v.number))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["number"],
        message: "A UAE tax registration number is exactly 15 digits",
      });
  });
export type TaxRegistration = z.output<typeof taxRegistrationSchema>;

/** Contact fields added by WQ5 (merged into the contact create/update bodies). */
export const contactIdentityFields = {
  isCustomer: z.boolean().optional(),
  isSupplier: z.boolean().optional(),
  partyType: z.enum(PARTY_TYPES).optional(),
  freeZone: z.boolean().optional(),
  addressStreet: optText(200),
  addressBuilding: optText(100),
  addressDistrict: optText(100),
  postalCode: optText(20),
  taxRegistrations: z.array(taxRegistrationSchema).max(8).optional(),
  defaultRevenueAccountId: zUuid.nullable().optional(),
  defaultExpenseAccountId: zUuid.nullable().optional(),
  defaultVatTreatment: z.enum(SUPPLY_TYPES).nullable().optional(),
  defaultCostCenterId: zUuid.nullable().optional(),
  /** Buyer legal identifier (written to einvoice_buyer_endpoints). */
  legalIdType: z.enum(SELLER_ID_TYPES).nullable().optional(),
  legalId: optText(64),
  /** Passport issuing country (BTAE-19), stored as the buyer endpoint's legal authority. */
  legalIdCountry: zCountry2,
};

export const approverLinkCreateBody = z
  .object({
    approverName: optText(120),
    approverEmail: z
      .union([z.literal(""), z.string().trim().toLowerCase().email().max(254), z.null()])
      .transform((v) => (v === "" ? null : v))
      .optional(),
  })
  .strict();

export const partnerChoiceBody = z
  .object({ partner: z.string().trim().toLowerCase().max(40).nullable() })
  .strict();

export const emptyBody = z.object({}).strict();
