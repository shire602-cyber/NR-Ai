// What a journal entry created or updated through the journal routes may take from the request.
//
// Every report trusts `source`: year-end closing entries are dropped from the profit and loss,
// vat_filing / opening_balance entries from the VAT ledger reading. A journal typed in by a user
// is therefore ALWAYS source "manual", and every column that belongs to the system (source,
// sourceId, reversedEntryId, postedBy, createdBy, entryNumber, companyId, ...) is set here from
// the session and the server, never from the body. Pure: no I/O.

import { vatAccountTouchedByLines } from "./vat-adjustments";

export const MANUAL_JOURNAL_SOURCE = "manual";

type Body = Record<string, unknown>;

const asText = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The client sends `description`; the column is `memo`. Memo wins when both are present. */
export function manualJournalMemo(body: Body): string | null | undefined {
  const memo = asText(body.memo);
  if (memo !== null && memo !== "") return memo;
  const description = asText(body.description);
  if (description !== null && description !== "") return description;
  return memo ?? undefined;
}

export interface ManualJournalInsert {
  companyId: string;
  createdBy: string;
  entryNumber: string;
  date: Date;
  memo?: string | null;
  status: "draft" | "posted";
  source: typeof MANUAL_JOURNAL_SOURCE;
  sourceId: null;
  postedBy: string | null;
  postedAt: Date | null;
}

/** The row for POST /api/companies/:companyId/journal, built from an explicit allow-list. */
export function buildManualJournalInsert(
  body: Body,
  ctx: { companyId: string; userId: string; entryNumber: string; date: Date; status: unknown; now?: Date }
): ManualJournalInsert {
  const isPosting = ctx.status === "posted";
  const now = ctx.now ?? new Date();
  const memo = manualJournalMemo(body);
  return {
    companyId: ctx.companyId,
    createdBy: ctx.userId,
    entryNumber: ctx.entryNumber,
    date: ctx.date,
    ...(memo !== undefined ? { memo } : {}),
    status: isPosting ? "posted" : "draft",
    source: MANUAL_JOURNAL_SOURCE,
    sourceId: null,
    postedBy: isPosting ? ctx.userId : null,
    postedAt: isPosting ? now : null,
  };
}

/** The patch for PUT /api/journal/:id (a draft): date, memo and draft/posted only. */
export function buildManualJournalUpdate(
  body: Body,
  ctx: { userId: string; date?: Date; now?: Date }
): Record<string, unknown> {
  const now = ctx.now ?? new Date();
  const patch: Record<string, unknown> = { updatedBy: ctx.userId, updatedAt: now };
  if (ctx.date !== undefined) patch.date = ctx.date;
  const memo = manualJournalMemo(body);
  if (memo !== undefined) patch.memo = memo;
  const requested = body.status;
  if (requested !== undefined) {
    if (requested !== "draft" && requested !== "posted") {
      throw new Error(`Invalid status '${String(requested)}' — only 'draft' or 'posted' are accepted`);
    }
    patch.status = requested;
    if (requested === "posted") {
      patch.postedBy = ctx.userId;
      patch.postedAt = now;
    }
  }
  return patch;
}

export const VAT_JOURNAL_DESCRIPTION_REQUIRED = "VAT_JOURNAL_DESCRIPTION_REQUIRED";

/**
 * A manual journal that posts to a VAT account is a VAT ADJUSTMENT on the return (see
 * vat-adjustments.ts): the accountant and the FTA see its number and description, so posting one
 * without a description is refused. Returns the refusal message, or null when the journal is fine.
 * Drafts are not checked; the description is required when the entry is posted.
 */
export function vatJournalDescriptionProblem(input: {
  isPosting: boolean;
  memo: string | null | undefined;
  lines: Array<{ accountId?: string | null }>;
  accountsById: Map<string, { code?: string | null; type?: string | null; isVatAccount?: boolean | null; vatType?: string | null }>;
}): string | null {
  if (!input.isPosting) return null;
  if (!vatAccountTouchedByLines(input.lines, input.accountsById)) return null;
  if ((input.memo ?? "").trim() !== "") return null;
  return (
    "This journal posts to a VAT account, so it is reported on the VAT return as an adjustment. " +
    "Add a description that says what it corrects (for example: \"Correct output VAT on INV-2026-00012\") and post it again."
  );
}
