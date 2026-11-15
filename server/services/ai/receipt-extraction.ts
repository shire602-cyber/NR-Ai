// Shared receipt/invoice extraction used by the interactive OCR route and the
// email-intake pipeline (R05-15, R05-16, R05-17, R05-21, R05-22).
//
// - models come from the per-task router (AI_MODEL_OCR)
// - Anthropic is called with forced tool-use, OpenAI with a strict JSON schema
// - output is zod-validated with one retry carrying validator feedback
// - sanity checks (subtotal + VAT ~ total, date window, ISO currency, TRN format)
// - every call is quota-checked and recorded in ai_usage_events
// - untrusted OCR text is passed inside delimited data blocks

import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { ValidationIssue } from "../../../shared/receipt-confidence";
import { createLogger } from "../../config/logger";
import { formatProviderFailures, summarizeOcrProviderError } from "../ocr-provider-clients";
import { DATA_BLOCK_INSTRUCTION, wrapUserData } from "./data-blocks";
import { resolveOcrModel } from "./model-router";
import { createRedactor, isRedactionEnabled } from "./redact";
import {
  ANTHROPIC_RECEIPT_TOOL,
  VALID_RECEIPT_CATEGORIES,
  openAiReceiptResponseFormat,
  receiptExtractionSchema,
  runStructured,
  sanityCheckReceipt,
  type ReceiptExtraction,
} from "./structured-output";
import { assertAiQuota, recordAiUsage, type AiContext } from "./usage-meter";

const log = createLogger("receipt-extraction");

export type ExtractionInput =
  | { kind: "image"; base64: string; mediaType: string }
  | { kind: "text"; text: string };

export interface ExtractionClients {
  anthropic: Anthropic | null;
  openai: OpenAI | null;
}

export interface ExtractionOutcome {
  data: ReceiptExtraction;
  issues: ValidationIssue[];
  provider: "anthropic" | "openai";
  model: string;
  attempts: number;
}

export const RECEIPT_EXTRACTION_PROMPT = `You are an expert accountant specializing in UAE business receipt and invoice processing. Read the document carefully (English and/or Arabic, any layout) and extract ALL financial data with high precision by calling the provided tool / returning the JSON schema.

Field rules:
- merchant: the exact supplier name as printed (keep Arabic spelling if the name is Arabic).
- date: transaction date as YYYY-MM-DD. Day-first is normal in the UAE. Convert Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) and Hijri-looking prefixes carefully; if no date is printed use null.
- invoiceNumber: invoice / receipt / transaction number, or null.
- subtotal: amount BEFORE VAT. vatPercentage: VAT rate (5 for standard UAE supplies, 0 for zero-rated/exempt). vatAmount: VAT charged. total: the grand total INCLUDING VAT.
- If only one amount is shown treat it as the total and compute subtotal = total / 1.05. If subtotal and VAT are shown but no total, total = subtotal + VAT. subtotal + vatAmount must equal total.
- currency: ISO 4217 code (AED unless clearly otherwise; "د.إ"/"درهم" = AED, "ر.س" = SAR).
- category: one of ${VALID_RECEIPT_CATEGORIES.join(", ")}.
- supplierTrn: the supplier's 15-digit UAE Tax Registration Number (labelled TRN / الرقم الضريبي) or null. Do not guess.
- isTaxInvoice: true only if the document is titled "Tax Invoice" / "فاتورة ضريبية". simplifiedInvoice: true if it is a simplified tax invoice.
- reverseChargeSuggested: true if the supplier is outside the UAE with no UAE VAT charged, or the document mentions reverse charge.
- lineItems: each item with description (keep the original language, bilingual text allowed), quantity, unitPrice, total.
- confidence: your honest 0..1 confidence in the extracted numbers; use a low value when the image is blurry, cropped or ambiguous. Never omit it.`;

type AnthropicImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
const ANTHROPIC_IMAGE_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function feedbackSuffix(feedback?: string): string {
  return feedback ? `\n\nCORRECTION NEEDED: ${feedback}` : "";
}

async function callAnthropic(
  client: Anthropic,
  model: string,
  input: ExtractionInput,
  ctx: AiContext,
  feedback?: string
): Promise<unknown> {
  const prompt =
    input.kind === "text"
      ? `${RECEIPT_EXTRACTION_PROMPT}\n\n${DATA_BLOCK_INSTRUCTION}\n\nExtract receipt data from this OCR text:\n${wrapUserData("ocr_text", input.text)}${feedbackSuffix(feedback)}`
      : `${RECEIPT_EXTRACTION_PROMPT}${feedbackSuffix(feedback)}`;

  const content: any[] = [];
  if (input.kind === "image") {
    content.push(
      input.mediaType === "application/pdf"
        ? {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: input.base64 },
          }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: (ANTHROPIC_IMAGE_TYPES.has(input.mediaType)
                ? input.mediaType
                : "image/jpeg") as AnthropicImageType,
              data: input.base64,
            },
          }
    );
  }
  content.push({ type: "text", text: prompt });

  const response: any = await client.messages.create({
    model,
    max_tokens: 1500,
    tools: [ANTHROPIC_RECEIPT_TOOL as any],
    tool_choice: { type: "tool", name: ANTHROPIC_RECEIPT_TOOL.name },
    messages: [{ role: "user", content }],
  });
  await recordAiUsage(ctx, "anthropic", model, {
    inputTokens: response?.usage?.input_tokens,
    outputTokens: response?.usage?.output_tokens,
  });
  const toolUse = (response?.content ?? []).find((b: any) => b?.type === "tool_use");
  if (toolUse) return toolUse.input;
  const text = (response?.content ?? []).find((b: any) => b?.type === "text");
  if (text) return text.text;
  throw new Error("Unexpected Anthropic response (no tool_use or text block)");
}

async function callOpenAi(
  client: OpenAI,
  model: string,
  input: ExtractionInput,
  ctx: AiContext,
  feedback?: string
): Promise<unknown> {
  const userContent: any[] = [];
  if (input.kind === "image") {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${input.mediaType};base64,${input.base64}`, detail: "high" },
    });
    userContent.push({
      type: "text",
      text: `Extract the receipt data.${feedbackSuffix(feedback)}`,
    });
  } else {
    userContent.push({
      type: "text",
      text: `Extract receipt data from this OCR text:\n${wrapUserData("ocr_text", input.text)}${feedbackSuffix(feedback)}`,
    });
  }
  const messages: any[] = [
    { role: "system", content: `${RECEIPT_EXTRACTION_PROMPT}\n\n${DATA_BLOCK_INSTRUCTION}` },
    { role: "user", content: userContent },
  ];

  let response: any;
  try {
    response = await client.chat.completions.create({
      model,
      messages,
      response_format: openAiReceiptResponseFormat(),
      max_tokens: 1500,
      temperature: 0,
    });
  } catch (err: any) {
    // Older models reject json_schema; degrade to json_object (still zod-validated).
    if (err?.status === 400 && /response_format|json_schema/i.test(String(err?.message))) {
      response = await client.chat.completions.create({
        model,
        messages,
        response_format: { type: "json_object" },
        max_tokens: 1500,
        temperature: 0,
      });
    } else {
      throw err;
    }
  }
  await recordAiUsage(ctx, "openai", model, {
    inputTokens: response?.usage?.prompt_tokens,
    outputTokens: response?.usage?.completion_tokens,
  });
  const raw = response?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty OpenAI response");
  return raw;
}

/**
 * Extract structured receipt data. Throws AiQuotaExceededError (429) when over the monthly
 * cap, or an Error summarising every provider failure. Returns the validated data with any
 * remaining validation issues (e.g. an amount mismatch the retry could not fix).
 */
export async function extractReceipt(args: {
  clients: ExtractionClients;
  input: ExtractionInput;
  ctx: AiContext;
  today?: string;
  env?: Record<string, string | undefined>;
}): Promise<ExtractionOutcome> {
  const { clients, ctx } = args;
  await assertAiQuota(ctx.companyId);

  // Optional PII masking for text sent to external providers (images cannot be masked).
  let input = args.input;
  let redactor: ReturnType<typeof createRedactor> | null = null;
  if (input.kind === "text" && isRedactionEnabled(args.env)) {
    redactor = createRedactor({ names: ctx.redactNames });
    input = { kind: "text", text: redactor.redact(input.text) };
  }

  const failures: Array<{ provider: "Anthropic" | "OpenAI"; error: unknown }> = [];
  const isPdf = input.kind === "image" && input.mediaType === "application/pdf";

  const attempt = async (
    provider: "anthropic" | "openai",
    model: string,
    call: (feedback?: string) => Promise<unknown>
  ): Promise<ExtractionOutcome> => {
    const result = await runStructured({
      schema: receiptExtractionSchema,
      call,
      sanity: (d) => sanityCheckReceipt(d, { today: args.today }),
    });
    const data = redactor
      ? ({ ...result.data, merchant: redactor.restore(result.data.merchant) } as ReceiptExtraction)
      : result.data;
    return { data, issues: result.issues, provider, model, attempts: result.attempts };
  };

  if (clients.anthropic) {
    const model = resolveOcrModel("anthropic", args.env);
    try {
      return await attempt("anthropic", model, (fb) =>
        callAnthropic(clients.anthropic!, model, input, { ...ctx, task: "ocr" }, fb)
      );
    } catch (err) {
      if ((err as any)?.code === "AI_QUOTA_EXCEEDED") throw err;
      failures.push({ provider: "Anthropic", error: err });
      if (clients.openai && !isPdf) {
        log.warn(
          { err: summarizeOcrProviderError(err) },
          "Anthropic extraction failed; trying OpenAI"
        );
      }
    }
  }

  if (clients.openai && !isPdf) {
    const model = resolveOcrModel("openai", args.env);
    try {
      return await attempt("openai", model, (fb) =>
        callOpenAi(clients.openai!, model, input, { ...ctx, task: "ocr" }, fb)
      );
    } catch (err) {
      if ((err as any)?.code === "AI_QUOTA_EXCEEDED") throw err;
      failures.push({ provider: "OpenAI", error: err });
    }
  }

  if (failures.length === 0) {
    throw new Error(
      isPdf ? "PDF extraction needs an Anthropic key" : "No extraction client available"
    );
  }
  throw new Error(
    failures.length === 1 && failures[0].provider === "Anthropic" && !clients.openai
      ? summarizeOcrProviderError(failures[0].error)
      : formatProviderFailures(failures)
  );
}
