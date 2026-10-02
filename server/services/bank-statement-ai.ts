// Scanned PDF statements: when the text layer gives no rows, the existing OCR provider (Anthropic, else OpenAI) may
// read the pages. Paid per call, so it is OFF unless the company switches it on (companies.bank_pdf_ai_fallback) and is
// capped at 10 pages. The rows come back as a staged import for the review grid, never straight into the ledger.

import { createLogger } from "../config/logger";
import { createOcrClients, summarizeOcrProviderError } from "./ocr-provider-clients";
import type { PdfStatementResult, PdfStatementRow } from "./bank-statement-parsers";

const log = createLogger("bank-statement-ai");

export const MAX_AI_PAGES = 10;
const MAX_AI_CHARS = 60_000;
const MAX_AI_ROWS = 500;

const PROMPT = `You read bank statements from UAE banks. From the statement below return ONLY JSON of this shape:
{"openingBalance": number|null, "closingBalance": number|null, "transactions": [{"date": "YYYY-MM-DD", "description": string, "reference": string|null, "amount": number, "balance": number|null}]}
amount is signed: money out (debit, withdrawal, DR) is negative, money in (credit, deposit, CR) is positive. Dates are day-first (DD/MM/YYYY). Include every transaction line and nothing else (no totals, no headers).`;

export type AiOutcome =
  | { status: "ok"; result: PdfStatementResult }
  | { status: "not_configured" }
  | { status: "failed"; reason: string };

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Rows from the model's JSON, checked: real dates, finite non-zero amounts, bounded. Pure. */
export function normalizeAiStatement(raw: any): PdfStatementResult | null {
  const list = Array.isArray(raw?.transactions) ? raw.transactions : [];
  const rows: PdfStatementRow[] = [];
  for (const t of list.slice(0, MAX_AI_ROWS)) {
    const amount = Number(t?.amount);
    if (!isDay(t?.date) || !Number.isFinite(amount) || Math.abs(amount) < 0.005 || typeof t?.description !== "string") continue;
    const balance = Number(t?.balance);
    rows.push({
      date: t.date,
      valueDate: null,
      description: t.description.replace(/\s+/g, " ").trim().slice(0, 300) || "Bank transaction",
      reference: typeof t?.reference === "string" && t.reference.trim() ? t.reference.trim().slice(0, 120) : null,
      amount: Math.round(amount * 100) / 100,
      balance: t?.balance !== null && t?.balance !== undefined && Number.isFinite(balance) ? Math.round(balance * 100) / 100 : null,
      issues: ["ai_extracted"],
    });
  }
  if (rows.length === 0) return null;
  const days = rows.map((r) => r.date).sort();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  return { rows, openingBalance: num(raw?.openingBalance), closingBalance: num(raw?.closingBalance), statementFrom: days[0], statementTo: days[days.length - 1] };
}

function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

export function isAiStatementConfigured(): boolean {
  const { anthropic, openai } = createOcrClients();
  return Boolean(anthropic || openai);
}

export async function extractStatementWithAi(args: { pages: string[]; pdfBase64?: string | null }): Promise<AiOutcome> {
  const { anthropic, openai } = createOcrClients();
  if (!anthropic && !openai) return { status: "not_configured" };
  const pages = args.pages.slice(0, MAX_AI_PAGES);
  const text = pages.join("\n\n").slice(0, MAX_AI_CHARS);
  const hasText = text.replace(/\s+/g, "").length > 80;

  try {
    let raw: string | null = null;
    if (anthropic) {
      const content: any[] = [];
      if (!hasText && args.pdfBase64) {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: args.pdfBase64 } });
      } else if (!hasText) {
        return { status: "failed", reason: "no_text_and_no_pdf" };
      }
      content.push({ type: "text", text: hasText ? `${PROMPT}\n\nStatement text:\n${text}` : PROMPT });
      const resp = await anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 8000, messages: [{ role: "user", content }] });
      const first = resp.content[0];
      raw = first && first.type === "text" ? first.text : null;
    } else if (openai && hasText) {
      const resp = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: `${PROMPT}\n\nStatement text:\n${text}` }],
        response_format: { type: "json_object" },
        max_tokens: 8000,
      });
      raw = resp.choices[0]?.message?.content ?? null;
    }
    if (!raw) return { status: "failed", reason: "empty_response" };
    const result = normalizeAiStatement(parseJson(raw));
    return result ? { status: "ok", result } : { status: "failed", reason: "no_rows" };
  } catch (e) {
    log.warn({ err: summarizeOcrProviderError(e) }, "AI statement extraction failed");
    return { status: "failed", reason: "provider_error" };
  }
}
