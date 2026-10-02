// What the screens tell the person after a bulk-match call: one function for the 422 (nothing posted) and the 409
// (stopped part way) so the Transactions tab and the bulk accept page report the same way.

import { ApiError } from "@/lib/queryClient";
import { bulkErrors, bulkPartial } from "@/lib/banking-api-types";
import { bankingErrorText, type CommonTr } from "./banking-common";

export interface BulkFailure {
  kind: "invalid" | "partial" | "other";
  /** One-line summary for a toast. */
  summary: string;
  /** Per-item problems (invalid) keyed by transaction id. */
  byTransaction: Record<string, string>;
  /** Transaction ids applied before a partial failure. */
  applied: string[];
}

export function describeBulkFailure(tr: CommonTr, err: unknown, locale: string): BulkFailure {
  if (err instanceof ApiError && err.code === "BULK_MATCH_INVALID") {
    const byTransaction: Record<string, string> = {};
    for (const e of bulkErrors(err.details)) if (e.transactionId) byTransaction[e.transactionId] = e.message;
    return { kind: "invalid", summary: bankingErrorText(tr, err, locale), byTransaction, applied: [] };
  }
  if (err instanceof ApiError && err.code === "BULK_MATCH_PARTIAL") {
    const p = bulkPartial(err.details);
    return { kind: "partial", summary: p.failed?.message || bankingErrorText(tr, err, locale), byTransaction: {}, applied: p.applied };
  }
  return { kind: "other", summary: bankingErrorText(tr, err, locale), byTransaction: {}, applied: [] };
}
