// Reusable receipt/invoice OCR extraction for the email-intake pipeline.
//
// The interactive OCR endpoint (ocr.routes) extracts inline and returns JSON to
// the client. Email intake has no client in the loop, so it needs a callable
// extractor: image/PDF bytes → a normalised OcrReceipt that runAutopilot can
// persist. The amount-reconciliation rules mirror ocr.routes' buildResult so a
// document produces the same figures whichever path it came in through.
//
// normalizeOcrJson is pure (no model, no I/O) and unit-tested. The vision call
// is env-keyed and returns null when no AI provider is configured, so the whole
// thing is a safe no-op until keys + the mailbox are set.

import { createLogger } from "../config/logger";
import type { OcrReceipt } from "./receipt-autopilot.service";
import {
  createOcrClients,
  formatProviderFailures,
  summarizeOcrProviderError,
} from "./ocr-provider-clients";

const log = createLogger("ocr-extraction");

export const VALID_OCR_CATEGORIES = [
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

export const RECEIPT_EXTRACTION_PROMPT = `You are an expert accountant specialising in UAE business receipt and invoice processing. Extract financial data with high precision and respond ONLY with valid JSON of this shape:
{"merchant":"string","date":"YYYY-MM-DD","invoiceNumber":"string|null","subtotal":number,"vatPercentage":number,"vatAmount":number,"total":number,"currency":"string","category":"string","lineItems":[{"description":"string","quantity":number,"unitPrice":number,"total":number}],"confidence":number}
Rules: "total" is the grand total INCLUDING VAT. If only one amount is present treat it as total and compute subtotal = total / 1.05 for UAE. If subtotal+vatAmount present but no total, total = subtotal + vatAmount. Default VAT 5% for UAE; explicit 0 means zero-rated. Parse thousands separators. Category must be one of: ${VALID_OCR_CATEGORIES.join(", ")}.`;

function parseNonNegative(val: unknown): number {
  if (val === null || val === undefined) return 0;
  const n = parseFloat(String(val).replace(/,/g, ""));
  return !isNaN(n) && n >= 0 ? n : 0;
}

/**
 * Normalise a model's raw JSON into the OcrReceipt shape runAutopilot consumes,
 * applying the same amount-reconciliation rules as the interactive OCR route.
 * `today` is injectable for deterministic tests.
 */
export function normalizeOcrJson(
  raw: any,
  opts: { rawText?: string | null; imageData?: string | null; today?: string } = {}
): OcrReceipt {
  const sIn = parseNonNegative(raw?.subtotal);
  const vIn = parseNonNegative(raw?.vatAmount);
  const vatPercentage =
    raw?.vatPercentage === null || raw?.vatPercentage === undefined
      ? 5
      : parseNonNegative(raw.vatPercentage);
  const tIn = parseNonNegative(raw?.total);
  const round2 = (x: number) => parseFloat(x.toFixed(2));

  // Reconcile to a self-consistent triple where subtotal + vat == total. The
  // interactive route can leave total==subtotal for a subtotal-only receipt;
  // intake AUTO-POSTS, so the figures must balance or runAutopilot would build
  // an unbalanced entry. Net (subtotal) is runAutopilot's contract.
  let derivedSubtotal: number;
  let derivedVat: number;
  let derivedTotal: number;
  if (tIn > 0 && sIn > 0) {
    derivedSubtotal = sIn;
    derivedTotal = tIn;
    derivedVat = vIn > 0 ? vIn : round2(tIn - sIn);
  } else if (tIn > 0) {
    derivedTotal = tIn;
    derivedSubtotal = round2(tIn / (1 + vatPercentage / 100));
    derivedVat = vIn > 0 ? vIn : round2(derivedTotal - derivedSubtotal);
  } else if (sIn > 0) {
    derivedSubtotal = sIn;
    derivedVat = vIn > 0 ? vIn : round2((sIn * vatPercentage) / 100);
    derivedTotal = round2(sIn + derivedVat);
  } else {
    derivedSubtotal = 0;
    derivedVat = 0;
    derivedTotal = 0;
  }

  const category = (VALID_OCR_CATEGORIES as readonly string[]).includes(raw?.category)
    ? raw.category
    : "Other";

  const fallbackDate = opts.today ?? new Date().toISOString().split("T")[0];
  const date =
    typeof raw?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : fallbackDate;

  const lineItems = Array.isArray(raw?.lineItems)
    ? raw.lineItems.map((li: any) => ({ description: String(li?.description || "").slice(0, 500) }))
    : [];

  return {
    merchant: raw?.merchant ? String(raw.merchant).slice(0, 200) : "Unknown Merchant",
    amount: derivedSubtotal, // net (subtotal) — runAutopilot's contract
    vatAmount: derivedVat,
    total: derivedTotal,
    currency: raw?.currency ? String(raw.currency).slice(0, 10) : "AED",
    date,
    category,
    lineItems,
    rawText: opts.rawText ?? null,
    imageData: opts.imageData ?? null,
  };
}

function extractJson(rawText: string): any {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1].trim() : rawText.trim());
}

/** Whether any AI provider is configured (extraction is possible). */
export function isOcrExtractionConfigured(): boolean {
  const { anthropic, openai } = createOcrClients();
  return Boolean(anthropic || openai);
}

const ANTHROPIC_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Extract an OcrReceipt from a document's bytes. Returns null when no AI provider
 * is configured (caller then leaves the doc pending). PDFs go through Anthropic's
 * document block; images through the vision block (Anthropic preferred, OpenAI
 * fallback for images).
 */
export async function extractReceiptToOcr(args: {
  content: Buffer;
  mimeType: string;
  rawText?: string | null;
}): Promise<OcrReceipt | null> {
  const { anthropic, openai } = createOcrClients();
  if (!anthropic && !openai) return null;

  const base64 = args.content.toString("base64");
  const isPdf = /pdf$/i.test(args.mimeType);
  const failures: Array<{ provider: "Anthropic" | "OpenAI"; error: unknown }> = [];

  if (anthropic) {
    try {
      const block = isPdf
        ? {
            type: "document" as const,
            source: {
              type: "base64" as const,
              media_type: "application/pdf" as const,
              data: base64,
            },
          }
        : {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: (ANTHROPIC_IMAGE_TYPES.has(args.mimeType)
                ? args.mimeType
                : "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: base64,
            },
          };
      const resp = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [
          { role: "user", content: [block, { type: "text", text: RECEIPT_EXTRACTION_PROMPT }] },
        ],
      });
      const first = resp.content[0];
      if (!first || first.type !== "text") throw new Error("Unexpected Anthropic response");
      return normalizeOcrJson(extractJson(first.text), {
        rawText: args.rawText,
        imageData: base64,
      });
    } catch (err) {
      failures.push({ provider: "Anthropic", error: err });
      if (openai && !isPdf) {
        log.warn(
          { err: summarizeOcrProviderError(err), mimeType: args.mimeType },
          "Anthropic OCR extraction failed; trying OpenAI"
        );
      }
    }
  }

  // OpenAI fallback — images only.
  if (openai && !isPdf) {
    try {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${args.mimeType};base64,${base64}`, detail: "high" },
              },
              { type: "text", text: RECEIPT_EXTRACTION_PROMPT },
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1500,
      });
      const raw = resp.choices[0]?.message?.content;
      if (!raw) throw new Error("Empty OpenAI response");
      return normalizeOcrJson(JSON.parse(raw), { rawText: args.rawText, imageData: base64 });
    } catch (err) {
      failures.push({ provider: "OpenAI", error: err });
    }
  }

  if (failures.length > 0) {
    log.warn(
      { err: formatProviderFailures(failures), mimeType: args.mimeType },
      "OCR extraction failed"
    );
  }
  return null; // PDF with only an OpenAI key, or all configured providers failed.
}
