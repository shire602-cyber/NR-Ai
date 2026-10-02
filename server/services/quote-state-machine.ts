// Quote lifecycle rules (Phase 8 D1). Pure module.
//
//   draft -> sent (mints the public link) -> accepted | declined | expired
//   sent / declined / expired -> draft   (revise: revokes the link, the old signature is superseded)
//   draft / sent / accepted -> converted (to an invoice or a sales order, once)

import { createHash } from "crypto";

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired" | "converted";
export type QuoteAction = "send" | "accept" | "decline" | "expire" | "revise" | "convert";

const ALLOWED: Record<QuoteAction, readonly string[]> = {
  send: ["draft"],
  accept: ["sent"],
  decline: ["sent"],
  expire: ["sent"],
  revise: ["sent", "declined", "expired"],
  convert: ["draft", "sent", "accepted"],
};

export function canQuoteTransition(from: string, action: QuoteAction): boolean {
  return ALLOWED[action].includes(from);
}

/** Only a draft is edited; a quote that went out must be revised first. */
export const isQuoteEditable = (status: string): boolean => status === "draft";

/** Signatures are kept for 5 years even when a declined quote is deleted. */
export const isQuoteDeletable = (status: string): boolean => ["draft", "declined", "expired"].includes(status);

/** Calendar days (YYYY-MM-DD): the quote is expired once its expiry day is before today. */
export function isQuoteExpiredByDate(expiryDate: string | null | undefined, today: string): boolean {
  if (!expiryDate) return false;
  return expiryDate.slice(0, 10) < today.slice(0, 10);
}

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])])
    );
  }
  return value;
};

/** sha256 of the totals and lines a customer agreed to (key order does not matter). */
export function quoteContentHash(content: { subtotal: number; vatAmount: number; total: number; lines: Array<Record<string, unknown>> }): string {
  return createHash("sha256").update(JSON.stringify(stable(content))).digest("hex");
}
