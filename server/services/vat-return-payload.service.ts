/**
 * Pure builders for VAT return payloads (kept out of the route so they can be
 * unit-tested). The pre-2026 8-box numbering (box1SalesStandard ...
 * box8TotalInputTax, box9NetTax) is gone from API payloads: it disagreed with
 * the canonical FTA VAT 201 boxes (e.g. box3SalesTaxExempt carried zero-rated
 * sales). The DB columns still exist with NOT NULL DEFAULT 0, so they are
 * simply no longer written or returned.
 */

import { z } from "zod";
import { insertVatReturnSchema } from "../../shared/schema";
import { classifyVatPeriod } from "./vat-period-status.service";

export const LEGACY_VAT_RETURN_FIELDS = [
  "box1SalesStandard",
  "box2SalesOtherEmirates",
  "box3SalesTaxExempt",
  "box4SalesExempt",
  "box5TotalOutputTax",
  "box6ExpensesStandard",
  "box7ExpensesTouristRefund",
  "box8TotalInputTax",
  "box9NetTax",
] as const;

/** Returns a copy of a vat_returns row/payload without the legacy aliases. */
export function stripLegacyVatReturnFields<T extends Record<string, unknown>>(row: T): T {
  const copy: Record<string, unknown> = { ...row };
  for (const key of LEGACY_VAT_RETURN_FIELDS) delete copy[key];
  return copy as T;
}

export interface GeneratedVatReturnInput {
  companyId: string;
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  vatStagger: string;
  emirateBreakdown: Record<string, number>;
  zeroRatedAmount: number;
  exemptAmount: number;
  reverseChargeAmount: number;
  reverseChargeVat: number;
  reverseChargeVatRecoverable: number;
  totalExpenses: number;
  inputTax: number;
  totalOutputAmount: number;
  totalOutputVat: number;
  totalInputAmount: number;
  totalInputVat: number;
}

/** Canonical VAT 201 values for a generated (draft) return. */
export function buildGeneratedVatReturnValues(input: GeneratedVatReturnInput) {
  return {
    companyId: input.companyId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    dueDate: input.dueDate,
    status: "draft",
    vatStagger: input.vatStagger,
    // Emirate breakdown from company registration
    ...input.emirateBreakdown,
    // Box 2: Tourist Refund Scheme (manual entry needed)
    box2TouristRefundAmount: 0,
    box2TouristRefundVat: 0,
    // Box 3: Reverse charge supplies (imports requiring reverse charge) —
    // OUTPUT side: buyer must self-assess output VAT on these supplies.
    box3ReverseChargeAmount: input.reverseChargeAmount,
    box3ReverseChargeVat: input.reverseChargeVat,
    // Box 4: Zero-rated supplies (exports, international services)
    box4ZeroRatedAmount: input.zeroRatedAmount,
    // Box 5: Exempt supplies (financial services, residential rent)
    box5ExemptAmount: input.exemptAmount,
    // Box 6: Imports subject to VAT
    box6ImportsAmount: 0,
    box6ImportsVat: 0,
    // Box 7: Adjustments for imports
    box7ImportsAdjAmount: 0,
    box7ImportsAdjVat: 0,
    // Box 8: Total output amounts and VAT
    box8TotalAmount: input.totalOutputAmount,
    box8TotalVat: input.totalOutputVat,
    box8TotalAdj: 0,
    // Box 9: Standard rated expenses (input VAT recovery)
    box9ExpensesAmount: input.totalExpenses,
    box9ExpensesVat: input.inputTax,
    box9ExpensesAdj: 0,
    // Box 10: Reverse charge on imports (input side) — buyer claims back the
    // self-assessed VAT, reduced by partial-exemption ratio when applicable.
    box10ReverseChargeAmount: input.reverseChargeAmount,
    box10ReverseChargeVat: input.reverseChargeVatRecoverable,
    // Box 11: Total input amounts and VAT
    box11TotalAmount: input.totalInputAmount,
    box11TotalVat: input.totalInputVat,
    box11TotalAdj: 0,
    // Box 12-14: VAT calculations
    box12TotalDueTax: input.totalOutputVat,
    box13RecoverableTax: input.totalInputVat,
    box14PayableTax: input.totalOutputVat - input.totalInputVat,
    createdBy: input.userId,
  };
}

// ─── PATCH /api/vat-returns/:id body ─────────────────────────────────────────

export const VAT_RETURN_STATUSES = ["draft", "pending_review", "submitted", "filed", "amended"] as const;

const MONEY_STRING = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** A finite number, or a plain numeric string converted to one. */
const moneyField = z.preprocess(
  (v) => (typeof v === "string" && MONEY_STRING.test(v.trim()) ? Number(v.trim()) : v),
  z.number().finite()
);
const dateField = z.coerce.date();
const nullableDateField = z.union([z.null(), z.coerce.date()]);

const MONEY_KEYS = Object.keys(insertVatReturnSchema.shape).filter(
  (k) => /^box\d/.test(k) || k === "adjustmentAmount" || k === "paymentAmount"
);
const moneyOverrides = Object.fromEntries(MONEY_KEYS.map((k) => [k, moneyField.optional()]));

/**
 * Editable subset of a vat_returns row. Dates are coerced (a string dueDate
 * used to reach Drizzle and 500), status is an enum, amounts must be numbers,
 * and unknown or non-client-writable keys (companyId, id, createdBy,
 * submittedBy) are dropped. periodStart / periodEnd are deliberately NOT
 * editable: a return belongs to the period it was generated for
 * (see evaluateVatReturnPatch).
 */
export const vatReturnPatchSchema = insertVatReturnSchema
  .partial()
  .omit({
    companyId: true,
    createdBy: true,
    submittedBy: true,
    periodStart: true,
    periodEnd: true,
    // Amendment links are created by the amendment endpoint only.
    amendsReturnId: true,
    isAmendment: true,
    // The manual-edit log is written by this endpoint, never by the client.
    manualEdits: true,
  })
  .extend({
    ...moneyOverrides,
    status: z.enum(VAT_RETURN_STATUSES).optional(),
    dueDate: dateField.optional(),
    taxYearEnd: nullableDateField.optional(),
    submittedAt: nullableDateField.optional(),
    paymentDate: nullableDateField.optional(),
    declarationDate: nullableDateField.optional(),
  })
  .strip();

// ─── PATCH rules ─────────────────────────────────────────────────────────────

/** A return in one of these states has been finalised / filed: its figures are immutable. */
export const LOCKED_VAT_RETURN_STATUSES = ["submitted", "filed", "accepted"] as const;

export type VatReturnPatchDecision =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

const BOX_KEY = /^box\d/;
const FILED_ONLY_ENDPOINT_FIELDS = new Set([
  "paymentAmount",
  "paymentStatus",
  "paymentDate",
  "ftaReferenceNumber",
  "submittedAt",
]);
const ymdOf = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.trim()) && !/[+-]\d{2}:?\d{2}$/.test(value.trim())) {
    // a bare date or a datetime without an offset: its own calendar date
    const d = new Date(value.trim().slice(0, 10) + "T00:00:00Z");
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * Business rules for PATCH /api/vat-returns/:id, on top of the schema:
 *  1. the period is immutable - a body periodStart/periodEnd must equal the
 *     stored one (otherwise a closed-period return could be dragged into an
 *     open period);
 *  2. a submitted / filed / accepted return keeps its figures: no box or
 *     adjustment edits and no re-opening to draft / pending_review;
 *  3. no non-draft status while the stored period has not ended.
 * Manual box edits on a DRAFT return remain allowed (the edit dialog).
 */
export function evaluateVatReturnPatch(args: {
  existing: { status: string; periodStart: string | Date; periodEnd: string | Date };
  body: unknown;
  patch: z.infer<typeof vatReturnPatchSchema>;
  now?: Date;
}): VatReturnPatchDecision {
  const { existing, patch, now } = args;
  const body = (args.body && typeof args.body === "object" ? args.body : {}) as Record<string, unknown>;

  for (const key of ["periodStart", "periodEnd"] as const) {
    if (!(key in body)) continue;
    if (ymdOf(body[key]) !== ymdOf(existing[key])) {
      return {
        ok: false,
        status: 400,
        code: "VAT_PERIOD_IMMUTABLE",
        message: `A VAT return cannot be moved to another period (${key} does not match the stored period). Generate a return for the period you need instead.`,
      };
    }
  }

  if ((LOCKED_VAT_RETURN_STATUSES as readonly string[]).includes(existing.status)) {
    const editsFigures = Object.keys(patch).some(
      (k) =>
        BOX_KEY.test(k) ||
        k === "adjustmentAmount" ||
        k === "adjustmentReason" ||
        // Once filed, references and payments move only through the filing /
        // payment endpoints so the filing record and the books cannot diverge.
        (existing.status === "filed" && FILED_ONLY_ENDPOINT_FIELDS.has(k))
    );
    const reopens = patch.status === "draft" || patch.status === "pending_review";
    if (editsFigures || reopens) {
      return {
        ok: false,
        status: 409,
        code: "VAT_RETURN_LOCKED",
        message: `This VAT return is ${existing.status} and can no longer be edited or re-opened.`,
      };
    }
  }

  if (patch.status && patch.status !== "draft" && classifyVatPeriod(existing.periodStart, existing.periodEnd, now) !== "closed") {
    return {
      ok: false,
      status: 400,
      code: "PERIOD_NOT_ENDED",
      message:
        "This VAT period has not ended yet. It is a draft preview and cannot be saved, submitted or filed until the period is over.",
    };
  }

  if (patch.status === "filed" && existing.status !== "filed") {
    return {
      ok: false,
      status: 409,
      code: "VAT_FILING_REQUIRES_RECORD",
      message:
        "A return is recorded as filed with POST /api/vat-returns/:id/file (FTA reference, filing date and acknowledgement), not by editing its status.",
    };
  }

  return { ok: true };
}
