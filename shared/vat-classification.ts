/**
 * UAE VAT supply classification — the single truth table for how a sales line
 * is taxed, reported and posted (W3-A, R07-01). Pure and isomorphic: the
 * server (invoice posting, VAT 201, e-invoicing) and the client (line editor)
 * import it so they can never disagree.
 *
 *   supply type      rate  UBL  VAT 201 family    revenue account role
 *   standard_rated   5%    S    standard          standard_sales  (4010)
 *   zero_rated       0%    Z    zero_rated        zero_rated_sales (4060)
 *   exempt           0%    E    exempt            exempt_sales    (4070)
 *   out_of_scope     0%    O    out_of_scope      out_of_scope_revenue (4030, no VAT box)
 *   reverse_charge   0%*   AE   reverse_charge    standard_sales  (4010)
 *
 *   * the supplier charges no VAT; the recipient self-accounts for it.
 *
 * A 0% line with no explicit supply type is ambiguous (zero-rated, exempt and
 * out-of-scope all charge 0%) and is rejected by `resolveSupplyType`.
 */
import { SUPPLY_TYPES } from "./validators/primitives";

export type SupplyType = (typeof SUPPLY_TYPES)[number];
export type UblTaxCategory = "S" | "Z" | "E" | "O" | "AE";
export type Vat201Family = "standard" | "zero_rated" | "exempt" | "out_of_scope" | "reverse_charge";
export type RevenueAccountRole =
  | "standard_sales"
  | "zero_rated_sales"
  | "exempt_sales"
  | "out_of_scope_revenue";

export const UAE_STANDARD_VAT_RATE = 0.05;

/**
 * S1 (W4-C follow-up): the standard rate is per tax jurisdiction. UAE documents charge 5%; a
 * company whose address country is Saudi Arabia issues ZATCA invoices at 15%. Zero-rated, exempt
 * and out-of-scope stay 0% everywhere; reverse charge stays 0% on the supplier's document.
 */
export type VatJurisdiction = "AE" | "SA";
export const STANDARD_VAT_RATES: Record<VatJurisdiction, number> = { AE: 0.05, SA: 0.15 };

/** The VAT jurisdiction of a company from its address country (default UAE). */
export function vatJurisdictionForCountry(country: string | null | undefined): VatJurisdiction {
  const c = String(country ?? "")
    .trim()
    .toLowerCase();
  return c === "sa" || c === "ksa" || c === "sau" || c === "saudi arabia" ? "SA" : "AE";
}

/** Normalise a rate for `jurisdiction`: 0, or its standard rate as percent or decimal; else null. */
export function normaliseVatRate(
  raw: unknown,
  jurisdiction: VatJurisdiction = "AE"
): number | null {
  if (jurisdiction === "AE") return normaliseUaeVatRate(raw);
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const std = STANDARD_VAT_RATES[jurisdiction];
  if (n === std || n === Math.round(std * 100)) return std;
  if (n === 0) return 0;
  return null;
}

/** Any rate a supported jurisdiction accepts (shape check before the company is known). */
export function normaliseSupportedVatRate(raw: unknown): number | null {
  return normaliseUaeVatRate(raw) ?? normaliseVatRate(raw, "SA");
}

function rateLabel(jurisdiction: VatJurisdiction): string {
  return jurisdiction === "SA"
    ? "VAT rate must be 0% or 15% (KSA)"
    : "VAT rate must be 0% or 5% (UAE)";
}

/** Default chart-of-accounts codes for each revenue role. */
export const REVENUE_ACCOUNT_CODES: Record<RevenueAccountRole, string> = {
  standard_sales: "4010",
  zero_rated_sales: "4060",
  exempt_sales: "4070",
  out_of_scope_revenue: "4030",
};

export interface SupplyClassification {
  supplyType: SupplyType;
  ublCategory: UblTaxCategory;
  vat201Family: Vat201Family;
  /** PINT AE / UNCL5305 exemption reason for non-S categories. */
  exemptionReasonCode?: string;
  revenueAccountRole: RevenueAccountRole;
  /** VAT the supplier charges on the line, as a decimal (0.05 or 0). */
  chargedVatRate: number;
  /** True when the line belongs in a VAT 201 box at all. */
  reportable: boolean;
}

/** Normalise 5 / "5" / 0.05 / "0.05" to the decimal rate; anything else is null. */
export function normaliseUaeVatRate(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n === 5 || n === UAE_STANDARD_VAT_RATE) return UAE_STANDARD_VAT_RATE;
  if (n === 0) return 0;
  return null;
}

const TABLE: Record<SupplyType, Omit<SupplyClassification, "supplyType">> = {
  standard_rated: {
    ublCategory: "S",
    vat201Family: "standard",
    revenueAccountRole: "standard_sales",
    chargedVatRate: UAE_STANDARD_VAT_RATE,
    reportable: true,
  },
  zero_rated: {
    ublCategory: "Z",
    vat201Family: "zero_rated",
    exemptionReasonCode: "VATEX-AE-ZR",
    revenueAccountRole: "zero_rated_sales",
    chargedVatRate: 0,
    reportable: true,
  },
  exempt: {
    ublCategory: "E",
    vat201Family: "exempt",
    exemptionReasonCode: "VATEX-AE-EX",
    revenueAccountRole: "exempt_sales",
    chargedVatRate: 0,
    reportable: true,
  },
  out_of_scope: {
    ublCategory: "O",
    vat201Family: "out_of_scope",
    exemptionReasonCode: "VATEX-AE-OOS",
    revenueAccountRole: "out_of_scope_revenue",
    chargedVatRate: 0,
    reportable: false,
  },
  reverse_charge: {
    ublCategory: "AE",
    vat201Family: "reverse_charge",
    exemptionReasonCode: "VATEX-AE-RC",
    revenueAccountRole: "standard_sales",
    chargedVatRate: 0,
    reportable: true,
  },
};

export class SupplyClassificationError extends Error {
  constructor(
    public readonly code: "SUPPLY_TYPE_REQUIRED" | "SUPPLY_TYPE_RATE_MISMATCH" | "INVALID_VAT_RATE",
    message: string
  ) {
    super(message);
    this.name = "SupplyClassificationError";
  }
}

/**
 * Resolve the stored supply type for a line.
 *   - explicit type wins, but must agree with the rate (5% only for standard);
 *   - omitted type: 5% -> standard_rated; 0% -> error (ambiguous);
 *   - invoice-level reverse charge forces reverse_charge.
 */
export function resolveSupplyType(input: {
  supplyType?: SupplyType | null;
  vatRate: unknown;
  reverseCharge?: boolean | null;
  jurisdiction?: VatJurisdiction;
}): SupplyType {
  const jurisdiction = input.jurisdiction ?? "AE";
  const standard = STANDARD_VAT_RATES[jurisdiction];
  const rate = normaliseVatRate(input.vatRate, jurisdiction);
  if (rate === null) {
    throw new SupplyClassificationError("INVALID_VAT_RATE", rateLabel(jurisdiction));
  }
  if (input.reverseCharge) {
    if (input.supplyType && input.supplyType !== "reverse_charge") {
      throw new SupplyClassificationError(
        "SUPPLY_TYPE_RATE_MISMATCH",
        "A reverse-charge invoice can only carry reverse_charge lines"
      );
    }
    return "reverse_charge";
  }
  const type = input.supplyType ?? null;
  if (!type) {
    if (rate === standard) return "standard_rated";
    throw new SupplyClassificationError(
      "SUPPLY_TYPE_REQUIRED",
      "A 0% line must say whether it is zero_rated, exempt or out_of_scope"
    );
  }
  const expected = type === "standard_rated" ? standard : TABLE[type].chargedVatRate;
  if (expected !== rate) {
    throw new SupplyClassificationError(
      "SUPPLY_TYPE_RATE_MISMATCH",
      type === "standard_rated"
        ? `A standard-rated line must carry ${Math.round(standard * 100)}% VAT`
        : `A ${type} line must carry 0% VAT`
    );
  }
  return type;
}

/** Classify a line. Pure; never throws for a stored, resolved supply type. */
export function classifySupply(input: {
  supplyType?: SupplyType | string | null;
  vatRate?: unknown;
  reverseCharge?: boolean | null;
  /** Standard rate jurisdiction; omitted: inferred from a stored 15% rate (KSA), else UAE. */
  jurisdiction?: VatJurisdiction;
}): SupplyClassification {
  let type: SupplyType;
  if (input.reverseCharge) type = "reverse_charge";
  else if (input.supplyType && (SUPPLY_TYPES as readonly string[]).includes(input.supplyType)) {
    type = input.supplyType as SupplyType;
    // Legacy rows: 0% lines were stored as standard_rated (R07-01). Treat
    // them as zero-rated, which is what the ledger did before W3-A, and let
    // scripts/qa/find-sales-ledger-drift.mjs list them for owner review.
    if (type === "standard_rated" && normaliseSupportedVatRate(input.vatRate) === 0) {
      type = "zero_rated";
    }
  } else {
    type = normaliseSupportedVatRate(input.vatRate) === 0 ? "zero_rated" : "standard_rated";
  }
  const out: SupplyClassification = { supplyType: type, ...TABLE[type] };
  if (type === "standard_rated") {
    const jurisdiction =
      input.jurisdiction ??
      (normaliseVatRate(input.vatRate, "SA") === STANDARD_VAT_RATES.SA ? "SA" : "AE");
    out.chargedVatRate = STANDARD_VAT_RATES[jurisdiction];
  }
  return out;
}

/** Bilingual labels for UI selectors and PDFs. */
export const SUPPLY_TYPE_LABELS: Record<SupplyType, { en: string; ar: string }> = {
  standard_rated: { en: "Standard rated (5%)", ar: "خاضع للنسبة الأساسية (5%)" },
  zero_rated: { en: "Zero rated (0%)", ar: "خاضع لنسبة الصفر (0%)" },
  exempt: { en: "Exempt", ar: "معفى" },
  out_of_scope: { en: "Out of scope", ar: "خارج النطاق" },
  reverse_charge: { en: "Reverse charge", ar: "احتساب عكسي" },
};

/**
 * S1 (W4-C follow-up): goods subject to the UAE domestic reverse charge, as the PINT AE
 * cbc:NatureCode list (ibr-006-ae, BTAE-09). Kept identical to
 * server/services/einvoice/pint-ae-codes.ts RCM_GOODS_TYPE_CODES (checked by a unit test) so a
 * product's `rcm_goods_type` is always a code the e-invoice validator accepts.
 */
export const RCM_GOODS_TYPES = [
  "DL8.48.3.1",
  "DL8.48.3.2",
  "DL8.48.3.3",
  "DL8.48.8.1",
  "DL8.48.8.2",
] as const;
export type RcmGoodsType = (typeof RCM_GOODS_TYPES)[number];

/** GTIN-8/12/13/14 with a valid GS1 mod-10 check digit (PINT AE scheme 0160). */
export function isValidGtin(value: string | null | undefined): boolean {
  if (typeof value !== "string" || !/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
  const digits = value.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((d, i) => {
    sum += d * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}
