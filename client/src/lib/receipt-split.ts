/**
 * Receipt split-lines / revise / split-into-receipts helpers (R05-19b, S2). The API is
 * PUT /api/receipts/:id { lines } (unposted), POST /api/receipts/:id/revise { ..., lines, reason }
 * (posted: reversal + repost) and POST /api/receipts/:id/split { parts } (unposted upload holding
 * several receipts). All arithmetic is in integer fils so the totals match the server's.
 */

export interface ReceiptLineDraft {
  accountId: string;
  amount: string;
  vatAmount: string;
  description: string;
}

export interface ReceiptPartDraft {
  merchant: string;
  amount: string;
  vatAmount: string;
  category: string;
}

export type ReceiptSplitError =
  | "LINE_ACCOUNT_REQUIRED"
  | "LINE_AMOUNT_INVALID"
  | "LINE_VAT_EXCEEDS_AMOUNT"
  | "LINES_REQUIRED"
  | "PARTS_REQUIRED"
  | "PARTS_TOTAL_MISMATCH"
  | "REASON_REQUIRED";

/** "12.5" -> 1250; null when not a non-negative amount with at most 2 decimals. */
export function toFilsInput(value: string): number | null {
  const s = value.trim();
  if (s === "") return 0;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export const formatFils = (fils: number): string =>
  `${fils < 0 ? "-" : ""}${Math.floor(Math.abs(fils) / 100)}.${String(Math.abs(fils) % 100).padStart(2, "0")}`;

export function emptyLine(accountId = ""): ReceiptLineDraft {
  return { accountId, amount: "", vatAmount: "", description: "" };
}

/** Seed the editor from a stored receipt (its lines, else one line with the header amounts). */
export function linesFromReceipt(receipt: {
  lines?: unknown;
  accountId?: string | null;
  amount?: number | string | null;
  vatAmount?: number | string | null;
}): ReceiptLineDraft[] {
  if (Array.isArray(receipt.lines) && receipt.lines.length > 0) {
    return receipt.lines.map((l: Record<string, unknown>) => ({
      accountId: String(l.accountId ?? ""),
      amount: l.amount === null || l.amount === undefined ? "" : String(l.amount),
      vatAmount: l.vatAmount === null || l.vatAmount === undefined ? "" : String(l.vatAmount),
      description: String(l.description ?? ""),
    }));
  }
  // Receipt `amount` is the net amount; VAT is stored separately (receipt-posting.service).
  const vat = Number(receipt.vatAmount ?? 0);
  const net = Number(receipt.amount ?? 0);
  return [
    {
      accountId: receipt.accountId ?? "",
      amount: net ? formatFils(Math.round(net * 100)) : "",
      vatAmount: vat ? formatFils(Math.round(vat * 100)) : "",
      description: "",
    },
  ];
}

export interface LinesTotals {
  netFils: number;
  vatFils: number;
  grossFils: number;
}

export function linesTotals(lines: readonly ReceiptLineDraft[]): LinesTotals {
  let netFils = 0;
  let vatFils = 0;
  for (const l of lines) {
    netFils += toFilsInput(l.amount) ?? 0;
    vatFils += toFilsInput(l.vatAmount) ?? 0;
  }
  return { netFils, vatFils, grossFils: netFils + vatFils };
}

/** First problem with the lines (index + code), or null when they can be sent. */
export function validateLines(
  lines: readonly ReceiptLineDraft[]
): { index: number; code: ReceiptSplitError } | null {
  if (lines.length === 0) return { index: -1, code: "LINES_REQUIRED" };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.accountId) return { index: i, code: "LINE_ACCOUNT_REQUIRED" };
    const amount = toFilsInput(l.amount);
    const vat = toFilsInput(l.vatAmount);
    if (amount === null || amount <= 0 || vat === null) {
      return { index: i, code: "LINE_AMOUNT_INVALID" };
    }
    if (vat > amount) return { index: i, code: "LINE_VAT_EXCEEDS_AMOUNT" };
  }
  return null;
}

/** API `lines` payload (major units as numbers; the server converts to fils). */
export function linesPayload(lines: readonly ReceiptLineDraft[]) {
  return lines.map((l) => ({
    accountId: l.accountId,
    amount: (toFilsInput(l.amount) ?? 0) / 100,
    vatAmount: (toFilsInput(l.vatAmount) ?? 0) / 100,
    description: l.description.trim() || null,
  }));
}

/** Body for PUT (unposted) or POST /revise (posted, reason required). */
export function buildLinesRequest(
  receipt: { id: string; posted?: boolean | null },
  lines: readonly ReceiptLineDraft[],
  reason: string
):
  | { ok: true; method: "PUT" | "POST"; url: string; body: Record<string, unknown> }
  | { ok: false; error: { index: number; code: ReceiptSplitError } } {
  const problem = validateLines(lines);
  if (problem) return { ok: false, error: problem };
  if (receipt.posted) {
    if (!reason.trim()) return { ok: false, error: { index: -1, code: "REASON_REQUIRED" } };
    return {
      ok: true,
      method: "POST",
      url: `/api/receipts/${receipt.id}/revise`,
      body: { lines: linesPayload(lines), reason: reason.trim() },
    };
  }
  return {
    ok: true,
    method: "PUT",
    url: `/api/receipts/${receipt.id}`,
    body: { lines: linesPayload(lines) },
  };
}

/** Body for POST /split: 2-20 parts, each valid; the parts must add up to the receipt total. */
export function buildSplitRequest(
  receipt: { id: string; amount?: number | string | null },
  parts: readonly ReceiptPartDraft[]
):
  | { ok: true; url: string; body: { parts: Array<Record<string, unknown>> } }
  | { ok: false; error: { index: number; code: ReceiptSplitError } } {
  if (parts.length < 2) return { ok: false, error: { index: -1, code: "PARTS_REQUIRED" } };
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const amount = toFilsInput(parts[i].amount);
    const vat = toFilsInput(parts[i].vatAmount);
    if (amount === null || amount <= 0 || vat === null) {
      return { ok: false, error: { index: i, code: "LINE_AMOUNT_INVALID" } };
    }
    if (vat > amount) return { ok: false, error: { index: i, code: "LINE_VAT_EXCEEDS_AMOUNT" } };
    total += amount;
  }
  const receiptTotal = Math.round(Number(receipt.amount ?? 0) * 100);
  if (receiptTotal > 0 && total !== receiptTotal) {
    return { ok: false, error: { index: -1, code: "PARTS_TOTAL_MISMATCH" } };
  }
  return {
    ok: true,
    url: `/api/receipts/${receipt.id}/split`,
    body: {
      parts: parts.map((p) => ({
        merchant: p.merchant.trim() || null,
        amount: (toFilsInput(p.amount) ?? 0) / 100,
        vatAmount: (toFilsInput(p.vatAmount) ?? 0) / 100,
        category: p.category.trim() || null,
      })),
    },
  };
}
