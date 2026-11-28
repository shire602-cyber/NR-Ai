/**
 * Adapter behind storage.createJournalEntry(insertEntry, lines). Keeps the
 * legacy signature so every existing caller goes through the kernel
 * (exact balance, account + period guards, in-transaction numbering) until
 * wave 3 moves them to postJournal directly.
 *
 * Legacy-only leniency (documented, R02-18 rounding rule):
 *   - float amounts are rounded per line ROUND_HALF_UP to 2dp (exactly what
 *     numeric(15,2) did on insert), THEN the entry must balance exactly;
 *   - a line's debit/credit are netted (a negative debit becomes a credit) and
 *     zero lines are dropped, which leaves the GL effect unchanged;
 *   - future dates and same-account entries are allowed (callers had no rule);
 *   - entryNumber from the caller is ignored: numbering happens in the tx.
 * Archived/inactive or foreign accounts, unbalanced entries and locked periods
 * are rejected (422 / 403), as for every kernel write.
 */
import type { InsertJournalEntry, InsertJournalLine, JournalEntry } from "../../shared/schema";
import { fromFils, toFils } from "../../shared/money";
import { DomainError } from "../errors";
import { insertNormalizedEntry, loadLinesFils, type InternalPostOptions } from "./kernel";
import { normalizeEntry } from "./normalize";
import { withLedgerTx } from "./tx";
import type { EntryKind, LedgerTx, PostJournalLineInput } from "./types";
import { ENTRY_KINDS } from "./types";

type LegacyEntry = InsertJournalEntry & { postedAt?: Date | null; updatedAt?: Date | null };
type LegacyLine = Omit<InsertJournalLine, "entryId">;

function legacyFils(value: unknown, field: string): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value !== "number" && typeof value !== "string") {
    throw new DomainError("INVALID_AMOUNT", 422, { field });
  }
  try {
    return toFils(value, { rounding: "halfUp" });
  } catch (err) {
    throw new DomainError("INVALID_AMOUNT", 422, { field }, `${field}: ${(err as Error).message}`);
  }
}

function legacyControlLeg(l: LegacyLine): PostJournalLineInput["controlLeg"] {
  return (l as { controlLeg?: PostJournalLineInput["controlLeg"] }).controlLeg;
}

/** Net each legacy line onto one side and drop zero lines. Exported for tests. */
export function legacyLinesToInput(lines: LegacyLine[]): PostJournalLineInput[] {
  const out: PostJournalLineInput[] = [];
  lines.forEach((l, i) => {
    const net =
      legacyFils(l.debit, `lines[${i}].debit`) - legacyFils(l.credit, `lines[${i}].credit`);
    const fNet =
      legacyFils(l.foreignDebit, `lines[${i}].foreignDebit`) -
      legacyFils(l.foreignCredit, `lines[${i}].foreignCredit`);
    if (net === 0) return;
    if (fNet !== 0 && Math.sign(fNet) !== Math.sign(net)) {
      throw new DomainError(
        "FOREIGN_SIDE_MISMATCH",
        422,
        { line: i },
        `lines[${i}] foreign amount is on the opposite side of the base amount`
      );
    }
    out.push({
      accountId: l.accountId,
      debitFils: net > 0 ? net : 0,
      creditFils: net < 0 ? -net : 0,
      description: l.description ?? null,
      ...((l as { lineKey?: string | null }).lineKey
        ? {
            lineKey: (l as { lineKey?: string | null }).lineKey,
            lineParams: (l as { lineParams?: Record<string, string> | null }).lineParams ?? null,
          }
        : {}),
      costCenterId: l.costCenterId ?? null,
      foreignCurrency: l.foreignCurrency ?? null,
      foreignDebit: fNet > 0 ? fromFils(fNet) : null,
      foreignCredit: fNet < 0 ? fromFils(-fNet) : null,
      exchangeRate: (l.exchangeRate as number | string | null | undefined) ?? null,
      ...((l as { systemVat?: boolean }).systemVat === true ? { systemVat: true } : {}),
      ...(legacyControlLeg(l) ? { controlLeg: legacyControlLeg(l) } : {}),
    });
  });
  return out;
}

function legacyKind(entry: LegacyEntry): EntryKind {
  const requested = (entry as { entryKind?: string }).entryKind;
  if (requested && (ENTRY_KINDS as readonly string[]).includes(requested)) {
    return requested as EntryKind;
  }
  const memo = String(entry.memo ?? "");
  if (entry.source === "system" && /clos/i.test(memo)) {
    return /year[\s-]*end/i.test(memo) ? "year_end_close" : "closing";
  }
  return "standard";
}

/** True when `lines` exactly undo the original entry, account by account. */
async function mirrorsOriginal(
  tx: LedgerTx,
  originalId: string,
  lines: Array<{ accountId: string; debitFils: number; creditFils: number }>
): Promise<boolean> {
  const orig = await loadLinesFils(tx, originalId);
  if (orig.length === 0) return false;
  const net = new Map<string, number>();
  for (const l of orig)
    net.set(l.accountId, (net.get(l.accountId) ?? 0) + l.debitFils - l.creditFils);
  for (const l of lines)
    net.set(l.accountId, (net.get(l.accountId) ?? 0) + l.debitFils - l.creditFils);
  return [...net.values()].every((v) => v === 0);
}

export async function createJournalEntryCompat(
  insertEntry: LegacyEntry,
  lines: LegacyLine[]
): Promise<JournalEntry> {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new DomainError(
      "TOO_FEW_LINES",
      422,
      undefined,
      "Journal entry must have at least one line"
    );
  }
  const status = (insertEntry.status ?? "draft") as "draft" | "posted";
  const n = normalizeEntry({
    companyId: insertEntry.companyId,
    date: insertEntry.date as Date | string,
    memo: insertEntry.memo ?? null,
    memoKey: insertEntry.memoKey ?? null,
    memoParams: insertEntry.memoParams ?? null,
    source: insertEntry.source ?? "manual",
    sourceId: insertEntry.sourceId ?? null,
    idempotencyKey: (insertEntry as { idempotencyKey?: string | null }).idempotencyKey ?? null,
    reference: (insertEntry as { reference?: string | null }).reference ?? null,
    status,
    kind: legacyKind(insertEntry),
    lines: legacyLinesToInput(lines),
    allowFutureDate: true,
    allowSameAccount: true,
    amountRounding: "halfUp",
  });
  const actorId = insertEntry.createdBy;
  return withLedgerTx(async (tx) => {
    const internal: InternalPostOptions = {
      postedBy: insertEntry.postedBy ?? null,
      postedAt: insertEntry.postedAt ?? null,
      reversalReason: insertEntry.reversalReason ?? null,
    };
    const origId = insertEntry.reversedEntryId ?? null;
    if (origId) {
      internal.reversedEntryId = origId;
      // Full reversals (invoice void) become kernel reversals: the original is
      // linked and a second reversal is refused. Partial credits keep the
      // reference only.
      if (status === "posted" && (await mirrorsOriginal(tx, origId, n.lines))) {
        n.kind = "reversal";
        internal.reversalOf = { entryId: origId, kind: "reversed" };
        internal.allowInactiveAccounts = true;
      }
    }
    const res = await insertNormalizedEntry(tx, n, { actorId }, internal);
    return res.entry;
  });
}
