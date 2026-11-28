// WQ2 (8.2, 4.7): turn an extracted supplier invoice into a bill DRAFT for the bill editor.
//
// Pure (no I/O): the server route feeds it the model output, the company's suppliers and the
// company's own TRN; the client renders the result in the capture panel. Nothing here posts or
// saves: the user reviews the filled form and saves it through the normal bill routes.
//
// Confidence is per field. The model reports one confidence for the whole document, which is
// never trusted on its own (shared/receipt-confidence.ts): a field the document did not give is
// "low", a supplier matched by TRN is "high", by name only "review", and a failed amount check
// caps the amount fields.

import { HIGH_BAND_MIN, REVIEW_BAND_MIN, type ConfidenceBand } from "./receipt-confidence";
import { allocate, fromFils, sumFils, toFils } from "./money";

export type { ConfidenceBand };

/** The fields the capture panel reports a confidence for. */
export const BILL_CAPTURE_FIELDS = [
  "supplier",
  "billNumber",
  "billDate",
  "currency",
  "lines",
  "vatTreatment",
  "total",
] as const;
export type BillCaptureField = (typeof BILL_CAPTURE_FIELDS)[number];

/** Loose extraction (the receipt extraction schema; every field coerced here). */
export interface BillExtractionInput {
  merchant?: string | null;
  date?: string | null;
  invoiceNumber?: string | null;
  subtotal?: number | null;
  vatPercentage?: number | null;
  vatAmount?: number | null;
  total?: number | null;
  currency?: string | null;
  lineItems?: Array<{
    description?: string | null;
    quantity?: number | null;
    unitPrice?: number | null;
    total?: number | null;
  }> | null;
  supplierTrn?: string | null;
  reverseChargeSuggested?: boolean | null;
  confidence?: number | null;
}

export interface CaptureSupplier {
  id: string;
  name: string;
  nameAr?: string | null;
  trn?: string | null;
  paymentTermsDays?: number | null;
  defaultExpenseAccountId?: string | null;
}

export interface BillCaptureLine {
  description: string;
  quantity: number;
  /** Net unit price (bill currency, 2 dp string). */
  unit_price: string;
  vat_supply_type: "standard_rated" | "zero_rated" | "reverse_charge";
}

export interface BillCaptureDraft {
  vendor_id: string | null;
  vendor_name: string;
  vendor_trn: string | null;
  bill_number: string | null;
  bill_date: string | null;
  due_date: string | null;
  currency: string;
  reverse_charge: boolean;
  line_items: BillCaptureLine[];
}

export interface BillCaptureResult {
  draft: BillCaptureDraft;
  confidence: Record<BillCaptureField, ConfidenceBand>;
  /** How the supplier was found: by TRN, by name, or not at all ("Create supplier"). */
  supplierMatch: "trn" | "name" | "none";
  /** Net, VAT and gross as read from the document (2 dp strings, bill currency). */
  totals: { subtotal: string; vat: string; total: string };
  /** Model confidence 0..1 (null when it gave none). */
  score: number | null;
  /** Machine codes for what the user should check (e.g. AMOUNTS_DO_NOT_ADD_UP). */
  checks: string[];
}

/** The document's seller TRN is the company's own: it is a sales invoice, never a bill. */
export class SelfTrnDocumentError extends Error {
  readonly code = "SELF_TRN_DOCUMENT";
  constructor() {
    super("This document was issued by your own company (the seller TRN is your TRN).");
  }
}

const ISO_CURRENCY = /^[A-Z]{3}$/;

/** Digits only, Arabic-Indic digits folded (a TRN is 15 digits starting 100). */
export function normalizeTrn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const folded = String(raw)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "");
  return /^100\d{12}$/.test(folded) ? folded : null;
}

/** Same TRN once both are normalised (4.7 self-TRN guard). */
export function isOwnTrn(
  sellerTrn: string | null | undefined,
  companyTrn: string | null | undefined
) {
  const a = normalizeTrn(sellerTrn);
  const b = normalizeTrn(companyTrn);
  return a !== null && a === b;
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const fils = (v: unknown) => toFils(num(v).toFixed(2));
const near = (a: number, b: number) => Math.abs(a - b) <= 2; // two fils of rounding

function band(score: number): ConfidenceBand {
  return score >= HIGH_BAND_MIN ? "high" : score >= REVIEW_BAND_MIN ? "review" : "low";
}

const normalName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(llc|l\.l\.c|fze|fzco|fz-llc|dmcc|est|trading|co|company|ltd|limited)\b\.?/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Find the supplier: TRN first (exact), then the name (case and legal suffix folded). */
export function matchSupplier(
  suppliers: readonly CaptureSupplier[],
  name: string | null | undefined,
  trn: string | null | undefined
): { supplier: CaptureSupplier | null; match: "trn" | "name" | "none" } {
  const t = normalizeTrn(trn);
  if (t) {
    const byTrn = suppliers.find((s) => normalizeTrn(s.trn) === t);
    if (byTrn) return { supplier: byTrn, match: "trn" };
  }
  const n = name ? normalName(name) : "";
  if (n) {
    const byName = suppliers.find(
      (s) => normalName(s.name) === n || (!!s.nameAr && normalName(s.nameAr) === n)
    );
    if (byName) return { supplier: byName, match: "name" };
  }
  return { supplier: null, match: "none" };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Map one extraction to a bill draft. Throws SelfTrnDocumentError when the seller TRN is the
 * company's own TRN (the caller answers 422 SELF_TRN_DOCUMENT).
 */
export function mapExtractionToBillDraft(
  input: BillExtractionInput | null | undefined,
  ctx: {
    suppliers: readonly CaptureSupplier[];
    companyTrn?: string | null;
    baseCurrency?: string;
    /** Issue codes from the extraction's sanity checks (amount mismatch, date window, ...). */
    issues?: readonly string[];
  }
): BillCaptureResult {
  const x = input ?? {};
  const sellerTrn = normalizeTrn(x.supplierTrn);
  if (isOwnTrn(sellerTrn, ctx.companyTrn)) throw new SelfTrnDocumentError();

  const checks = new Set<string>(ctx.issues ?? []);
  const score =
    typeof x.confidence === "number" && Number.isFinite(x.confidence)
      ? Math.min(1, Math.max(0, x.confidence))
      : null;
  const base = score ?? 0;
  const amountsFlagged = (ctx.issues ?? []).some((c) => /AMOUNT|TOTAL|VAT/i.test(c));

  // ── Amounts: a self-consistent net + VAT = gross triple ──────────────────
  let netF = fils(x.subtotal);
  let vatF = fils(x.vatAmount);
  let grossF = fils(x.total);
  const pct =
    x.vatPercentage === null || x.vatPercentage === undefined ? null : num(x.vatPercentage);
  if (grossF > 0 && netF > 0) {
    if (vatF === 0 && grossF > netF) vatF = grossF - netF;
  } else if (grossF > 0) {
    const rate = pct ?? 5;
    netF = Math.round((grossF * 100) / (100 + rate));
    vatF = grossF - netF;
  } else if (netF > 0) {
    if (vatF === 0 && (pct ?? 5) > 0) vatF = Math.round((netF * (pct ?? 5)) / 100);
    grossF = netF + vatF;
  }
  const addsUp = near(netF + vatF, grossF);
  if (!addsUp) checks.add("AMOUNTS_DO_NOT_ADD_UP");

  // ── VAT treatment ──────────────────────────────────────────────────────
  const reverseCharge = x.reverseChargeSuggested === true;
  const zeroRated = !reverseCharge && netF > 0 && vatF === 0 && (pct === 0 || pct === null);
  const supplyType: BillCaptureLine["vat_supply_type"] = reverseCharge
    ? "reverse_charge"
    : zeroRated
      ? "zero_rated"
      : "standard_rated";
  // A standard-rated bill whose VAT is not 5% of the net needs a look.
  const vatMatchesRate =
    supplyType !== "standard_rated" || near(Math.round(netF * 0.05), vatF) || netF === 0;
  if (!vatMatchesRate) checks.add("VAT_NOT_FIVE_PERCENT");

  // ── Lines: kept when they add up to the net (or to the gross), else one line ────
  const rawLines = (x.lineItems ?? [])
    .map((l) => ({
      description: String(l?.description ?? "")
        .trim()
        .slice(0, 500),
      quantity: num(l?.quantity) || 1,
      totalF: fils(l?.total) || Math.round(num(l?.unitPrice) * (num(l?.quantity) || 1) * 100),
    }))
    .filter((l) => l.description && l.totalF > 0);
  const lineSum = sumFils(rawLines.map((l) => l.totalF));
  let lineNets: number[] | null = null;
  if (rawLines.length > 0 && netF > 0) {
    if (near(lineSum, netF)) {
      // Net lines: absorb the rounding into the last line so they equal the net exactly.
      lineNets = rawLines.map((l) => l.totalF);
      lineNets[lineNets.length - 1] += netF - lineSum;
    } else if (near(lineSum, grossF) && grossF > 0) {
      // Gross lines: spread the net over them in proportion (exact fils).
      lineNets = allocate(
        netF,
        rawLines.map((l) => l.totalF)
      );
    }
  }
  if (rawLines.length > 0 && !lineNets) checks.add("LINES_DO_NOT_ADD_UP");
  const merchant = String(x.merchant ?? "")
    .trim()
    .slice(0, 255);
  const lines: BillCaptureLine[] = lineNets
    ? rawLines.map((l, i) => {
        const net = lineNets![i];
        // Keep the quantity only when it reproduces the net exactly at a 2 dp unit price.
        const q = Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : 1;
        const exact = net % q === 0;
        return {
          description: l.description,
          quantity: exact ? q : 1,
          unit_price: fromFils(exact ? net / q : net),
          vat_supply_type: supplyType,
        };
      })
    : [
        {
          description: rawLines[0]?.description || merchant || "Supplier invoice",
          quantity: 1,
          unit_price: fromFils(netF),
          vat_supply_type: supplyType,
        },
      ];

  // ── Header fields ──────────────────────────────────────────────────────
  const { supplier, match } = matchSupplier(ctx.suppliers, merchant, sellerTrn);
  const date = typeof x.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : null;
  if (!date) checks.add("DATE_MISSING");
  const ccy = String(x.currency ?? "")
    .trim()
    .toUpperCase();
  const currency = ISO_CURRENCY.test(ccy) ? ccy : (ctx.baseCurrency ?? "AED");
  const billNumber = x.invoiceNumber ? String(x.invoiceNumber).trim().slice(0, 64) || null : null;
  const terms = supplier?.paymentTermsDays;
  const dueDate = date && typeof terms === "number" && terms > 0 ? addDays(date, terms) : null;

  const amountScore = amountsFlagged || !addsUp ? Math.min(base, 0.5) : base;
  const confidence: Record<BillCaptureField, ConfidenceBand> = {
    supplier:
      match === "trn"
        ? "high"
        : match === "name"
          ? band(Math.min(base, HIGH_BAND_MIN - 0.01))
          : merchant
            ? band(Math.min(base, REVIEW_BAND_MIN))
            : "low",
    billNumber: billNumber ? band(base) : "low",
    billDate: date && ![...checks].some((c) => c.startsWith("DATE_")) ? band(base) : "low",
    currency: ISO_CURRENCY.test(ccy) ? band(base) : band(Math.min(base, REVIEW_BAND_MIN)),
    lines: lineNets || rawLines.length === 0 ? band(amountScore) : "low",
    vatTreatment: vatMatchesRate ? band(amountScore) : "low",
    total: grossF > 0 ? band(amountScore) : "low",
  };

  return {
    draft: {
      vendor_id: supplier?.id ?? null,
      vendor_name: supplier?.name ?? merchant,
      vendor_trn: sellerTrn ?? supplier?.trn ?? null,
      bill_number: billNumber,
      bill_date: date,
      due_date: dueDate,
      currency,
      reverse_charge: reverseCharge,
      line_items: lines,
    },
    confidence,
    supplierMatch: match,
    totals: { subtotal: fromFils(netF), vat: fromFils(vatF), total: fromFils(grossF) },
    score,
    checks: [...checks],
  };
}
