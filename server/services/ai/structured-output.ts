// Structured model output (R05-22, R05-15): JSON-schema / tool-use definitions, zod
// validation, one retry with validator feedback, and receipt sanity checks. A model's
// missing confidence is never defaulted: it counts as low.

import { todayDubai } from "@shared/accounting-date";
import { z } from "zod";
import type { ValidationIssue } from "../../../shared/receipt-confidence";
import { validateUaeTrn } from "../../../shared/receipt-ocr-parser";

export const VALID_RECEIPT_CATEGORIES = [
  "Office Supplies",
  "Utilities",
  "Travel",
  "Meals",
  "Rent",
  "Marketing",
  "Equipment",
  "Professional Services",
  "Insurance",
  "Maintenance",
  "Communication",
  "Other",
] as const;

/** ISO 4217 codes we accept on receipts (UAE business context). */
export const ISO_CURRENCIES = new Set([
  "AED",
  "USD",
  "EUR",
  "GBP",
  "SAR",
  "QAR",
  "KWD",
  "BHD",
  "OMR",
  "EGP",
  "JOD",
  "INR",
  "PKR",
  "PHP",
  "BDT",
  "LKR",
  "CNY",
  "JPY",
  "CHF",
  "CAD",
  "AUD",
  "SGD",
  "HKD",
  "TRY",
  "ZAR",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
  "THB",
  "MYR",
  "IDR",
  "KRW",
  "RUB",
  "LBP",
  "MAD",
  "TND",
  "NGN",
  "KES",
]);

// ---- schema -------------------------------------------------------------------

const amount = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, ""));
    return Number.isNaN(n) ? v : n;
  }
  return v;
}, z.number().finite().min(0));

/**
 * A printed figure that may be absent: null (or blank) means "not printed on the document" and is
 * kept as null, NOT coerced to 0, so an explicit "VAT 0.00" (0) stays distinguishable from a VAT
 * amount that was never shown (null). Downstream reconciliation derives and flags missing figures.
 */
const printedAmount = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, ""));
    return Number.isNaN(n) ? v : n;
  }
  return v;
}, z.number().finite().min(0).nullable());

const lineItemSchema = z.object({
  description: z.string().max(500).catch(""),
  quantity: amount.catch(1),
  unitPrice: amount.catch(0),
  total: amount.catch(0),
});

export const receiptExtractionSchema = z.object({
  merchant: z.string().min(1).max(300),
  date: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  subtotal: printedAmount.optional().default(null),
  vatPercentage: z
    .preprocess((v) => (v === "" ? null : v), z.coerce.number().min(0).max(100).nullable())
    .optional(),
  vatAmount: printedAmount.optional().default(null),
  total: amount.optional().default(0),
  currency: z.string().max(10).nullable().optional(),
  category: z.string().nullable().optional(),
  lineItems: z.array(lineItemSchema).max(200).optional().default([]),
  supplierTrn: z.string().nullable().optional(),
  isTaxInvoice: z.boolean().nullable().optional(),
  simplifiedInvoice: z.boolean().nullable().optional(),
  reverseChargeSuggested: z.boolean().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;

const nullable = (type: string) => ({ type: [type, "null"] });

/** JSON schema shared by OpenAI json_schema mode and Anthropic tool-use. */
export const RECEIPT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "merchant",
    "date",
    "invoiceNumber",
    "subtotal",
    "vatPercentage",
    "vatAmount",
    "total",
    "currency",
    "category",
    "lineItems",
    "supplierTrn",
    "isTaxInvoice",
    "simplifiedInvoice",
    "reverseChargeSuggested",
    "confidence",
  ],
  properties: {
    merchant: { type: "string" },
    date: nullable("string"),
    invoiceNumber: nullable("string"),
    subtotal: nullable("number"),
    vatPercentage: nullable("number"),
    vatAmount: nullable("number"),
    total: { type: "number" },
    currency: nullable("string"),
    category: { type: "string", enum: [...VALID_RECEIPT_CATEGORIES] },
    lineItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unitPrice", "total"],
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          unitPrice: { type: "number" },
          total: { type: "number" },
        },
      },
    },
    supplierTrn: nullable("string"),
    isTaxInvoice: nullable("boolean"),
    simplifiedInvoice: nullable("boolean"),
    reverseChargeSuggested: nullable("boolean"),
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

/** OpenAI `response_format` for receipt extraction. */
export function openAiReceiptResponseFormat() {
  return {
    type: "json_schema" as const,
    json_schema: { name: "receipt_extraction", strict: true, schema: RECEIPT_JSON_SCHEMA },
  };
}

/** Anthropic forced tool-use definition for receipt extraction. */
export const ANTHROPIC_RECEIPT_TOOL = {
  name: "record_receipt",
  description: "Record the data extracted from a receipt or tax invoice.",
  input_schema: RECEIPT_JSON_SCHEMA,
} as const;

// ---- parsing ------------------------------------------------------------------

export function extractJsonValue(raw: unknown): unknown {
  if (raw && typeof raw === "object") return raw;
  const text = String(raw ?? "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Model output was not valid JSON");
  }
}

// ---- sanity checks ------------------------------------------------------------

const DAY_MS = 86_400_000;

export function sanityCheckReceipt(
  data: Partial<ReceiptExtraction>,
  opts: { today?: string } = {}
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const todayMs = Date.parse(`${opts.today ?? todayDubai()}T00:00:00Z`);
  const subtotal = Number(data.subtotal) || 0;
  const vat = Number(data.vatAmount) || 0;
  // null/undefined VAT means "not printed", not "0": the gap is left to reconcileReceiptAmounts,
  // which derives and flags it (VAT_DERIVED), instead of asking the model to fill the figure in.
  const vatPrinted = data.vatAmount !== null && data.vatAmount !== undefined;
  const total = Number(data.total) || 0;

  if (total <= 0 && subtotal <= 0) {
    issues.push({
      code: "MISSING_AMOUNT",
      severity: "error",
      message: "No total or subtotal found",
    });
  }
  if (vatPrinted && subtotal > 0 && total > 0) {
    const tolerance = Math.max(0.05, total * 0.01);
    if (Math.abs(subtotal + vat - total) > tolerance) {
      issues.push({
        code: "AMOUNT_MISMATCH",
        severity: "error",
        message: `Subtotal ${subtotal} + VAT ${vat} does not equal total ${total}`,
      });
    }
  }

  if (data.date) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
      Number.isNaN(Date.parse(`${data.date}T00:00:00Z`))
    ) {
      issues.push({
        code: "DATE_FORMAT",
        severity: "error",
        message: `Date "${data.date}" is not a valid YYYY-MM-DD date`,
      });
    } else {
      const ms = Date.parse(`${data.date}T00:00:00Z`);
      if (ms > todayMs + DAY_MS) {
        issues.push({
          code: "DATE_FUTURE",
          severity: "error",
          message: `Date ${data.date} is in the future`,
        });
      } else if (ms < todayMs - 3653 * DAY_MS) {
        issues.push({
          code: "DATE_ANCIENT",
          severity: "error",
          message: `Date ${data.date} is more than 10 years old`,
        });
      }
    }
  } else {
    issues.push({ code: "DATE_MISSING", severity: "warning", message: "No date found" });
  }

  if (data.currency) {
    const code = data.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || !ISO_CURRENCIES.has(code)) {
      issues.push({
        code: "CURRENCY_INVALID",
        severity: "error",
        message: `"${data.currency}" is not a recognised ISO 4217 currency`,
      });
    }
  }

  if (data.supplierTrn) {
    const trn = validateUaeTrn(data.supplierTrn);
    if (!trn.valid) {
      issues.push({
        code: "TRN_INVALID",
        severity: "warning",
        message: trn.issue ?? "Supplier TRN is not a valid 15-digit UAE TRN",
      });
    }
  }

  if (
    data.vatPercentage !== null &&
    data.vatPercentage !== undefined &&
    ![0, 5].includes(Number(data.vatPercentage))
  ) {
    issues.push({
      code: "VAT_RATE_UNUSUAL",
      severity: "warning",
      message: `VAT rate ${data.vatPercentage}% is not a UAE standard (0% or 5%)`,
    });
  }

  return issues;
}

// ---- runner -------------------------------------------------------------------

export class StructuredOutputError extends Error {
  code = "STRUCTURED_OUTPUT_INVALID";
  constructor(
    message: string,
    public readonly attempts: number
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

export interface RunStructuredOptions<T> {
  schema: z.ZodType<T, unknown>;
  /** Performs one model call. `feedback` describes what was wrong with the previous attempt. */
  call: (feedback?: string) => Promise<unknown>;
  sanity?: (data: T) => ValidationIssue[];
  /** Retries after the first attempt. Defaults to 1. */
  maxRetries?: number;
}

export interface StructuredResult<T> {
  data: T;
  /** Issues remaining on the returned data (empty when the output was fully valid). */
  issues: ValidationIssue[];
  attempts: number;
  /** The first successfully parsed attempt (before any correction retry). */
  firstData?: T;
}

export async function runStructured<T>(
  opts: RunStructuredOptions<T>
): Promise<StructuredResult<T>> {
  const maxRetries = opts.maxRetries ?? 1;
  let feedback: string | undefined;
  let best: { data: T; issues: ValidationIssue[] } | null = null;
  let lastError = "Model output was invalid";
  let firstData: T | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let parsed: z.ZodSafeParseResult<T>;
    try {
      const raw = await opts.call(feedback);
      parsed = opts.schema.safeParse(extractJsonValue(raw));
    } catch (err) {
      lastError = (err as Error).message;
      feedback = `Your previous reply could not be parsed: ${lastError}. Reply with valid JSON only.`;
      continue;
    }

    if (!parsed.success) {
      lastError = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
        .join("; ");
      feedback = `Your previous reply failed schema validation (${lastError}). Fix these fields and reply with valid JSON only.`;
      continue;
    }

    if (firstData === undefined) firstData = parsed.data;
    const issues = opts.sanity ? opts.sanity(parsed.data) : [];
    const errors = issues.filter((i) => i.severity === "error");
    // Prefer the attempt with fewer sanity errors.
    if (!best || errors.length < best.issues.filter((i) => i.severity === "error").length) {
      best = { data: parsed.data, issues };
    }
    if (errors.length === 0) return { data: parsed.data, issues, attempts: attempt + 1, firstData };
    feedback = `Your previous reply failed validation: ${errors.map((e) => e.message).join("; ")}. Re-read the document and correct only figures you misread that are PRINTED on it. Never calculate, estimate or fill in a figure that is not printed (for example VAT): leave it null.`;
  }

  if (best) return { ...best, attempts: maxRetries + 1, firstData };
  throw new StructuredOutputError(lastError, maxRetries + 1);
}

/** Normalise a possibly-missing model confidence: missing means low (0), never a default. */
export function normalizeModelConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
