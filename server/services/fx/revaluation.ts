/**
 * Period-end unrealised FX revaluation (R14-03, R14-17, R11-18).
 *
 * One fx_revaluations row per (company, as_of) while not undone. A run posts one balanced
 * journal entry dated as_of (source 'fx_revaluation', source_id = the fx_revaluations uuid)
 * and its automatic reversal dated as_of + 1 day (source 'fx_revaluation_reversal'), so the
 * realised result is recognised on settlement. Re-running the same date is a no-op; undo
 * posts equal-and-opposite entries for both and marks the run 'undone'.
 *
 * FOLLOW-UP: post through server/ledger once the W2-A ledger kernel lands; today this uses
 * storage.createJournalEntryWithLines (balance-checked, numbered, transactional per entry).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { fxRevaluations, type FxRevaluation, type JournalEntry } from "../../../shared/schema";
import { filsToNumber, fromFils, sumFils } from "../../../shared/money";
import { ACCOUNT_CODES } from "../../constants";
import { DomainError } from "../../errors";
import { assertPeriodNotLocked } from "../period-lock.service";
import { addDaysIso, isoToDate, toIsoDate } from "./rates";
import { computeFxExposure, type FxExposure } from "./exposure";

export const FX_REVALUATION_SOURCE = "fx_revaluation";
export const FX_REVALUATION_REVERSAL_SOURCE = "fx_revaluation_reversal";
export const FX_REVALUATION_UNDO_SOURCE = "fx_revaluation_undo";

/** Dedicated unrealised FX accounts (created on first use when missing). */
export const UNREALISED_FX_ACCOUNTS = {
  gain: {
    code: "4091",
    nameEn: "Unrealised Foreign Exchange Gain",
    nameAr: "أرباح صرف عملات أجنبية غير محققة",
    type: "income",
  },
  loss: {
    code: "5141",
    nameEn: "Unrealised Foreign Exchange Loss",
    nameAr: "خسائر صرف عملات أجنبية غير محققة",
    type: "expense",
  },
} as const;

export interface RevaluationLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  debitFils: number;
  creditFils: number;
  description: string;
}

interface AccountRef {
  id: string;
  code: string;
  nameEn: string;
}

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] }).rows ?? (r as Row[])) as Row[];

/**
 * A/R and bank: a gain raises the asset → debit. A/P: a gain (cost fell) lowers the
 * liability → debit as well. Losses go to the credit side.
 */
function line(acct: AccountRef, gainFils: number, description: string): RevaluationLine {
  return {
    accountId: acct.id,
    accountCode: acct.code,
    accountName: acct.nameEn,
    debitFils: gainFils > 0 ? gainFils : 0,
    creditFils: gainFils < 0 ? -gainFils : 0,
    description,
  };
}

/** Pure: balanced legs for an exposure. Throws when a control account is missing. */
export function buildRevaluationLines(
  exposure: FxExposure,
  accounts: {
    ar: AccountRef | null;
    ap: AccountRef | null;
    gain: AccountRef | null;
    loss: AccountRef | null;
    banks: Map<string, AccountRef>;
  }
): RevaluationLine[] {
  const lines: RevaluationLine[] = [];
  const { receivableFils, payableFils } = exposure.totals;
  if (receivableFils !== 0) {
    if (!accounts.ar) throw new DomainError("AR_ACCOUNT_MISSING", 422);
    lines.push(line(accounts.ar, receivableFils, "Unrealised FX revaluation — A/R"));
  }
  if (payableFils !== 0) {
    if (!accounts.ap) throw new DomainError("AP_ACCOUNT_MISSING", 422);
    lines.push(line(accounts.ap, payableFils, "Unrealised FX revaluation — A/P"));
  }
  const byBank = new Map<string, number>();
  for (const i of exposure.items.filter((x) => x.kind === "bank" && x.accountId)) {
    byBank.set(i.accountId!, (byBank.get(i.accountId!) ?? 0) + i.gainLossFils);
  }
  for (const [accountId, gainFils] of byBank) {
    if (gainFils === 0) continue;
    const acct = accounts.banks.get(accountId);
    if (!acct) throw new DomainError("BANK_ACCOUNT_MISSING", 422, { accountId });
    lines.push(line(acct, gainFils, "Unrealised FX revaluation — bank"));
  }
  if (lines.length === 0) return [];
  const net = sumFils(lines.map((l) => l.debitFils - l.creditFils));
  if (net > 0) {
    if (!accounts.gain) throw new DomainError("FX_GAIN_ACCOUNT_MISSING", 422);
    lines.push({
      accountId: accounts.gain.id,
      accountCode: accounts.gain.code,
      accountName: accounts.gain.nameEn,
      debitFils: 0,
      creditFils: net,
      description: "Unrealised FX gain",
    });
  } else if (net < 0) {
    if (!accounts.loss) throw new DomainError("FX_LOSS_ACCOUNT_MISSING", 422);
    lines.push({
      accountId: accounts.loss.id,
      accountCode: accounts.loss.code,
      accountName: accounts.loss.nameEn,
      debitFils: -net,
      creditFils: 0,
      description: "Unrealised FX loss",
    });
  }
  const dr = sumFils(lines.map((l) => l.debitFils));
  const cr = sumFils(lines.map((l) => l.creditFils));
  if (dr !== cr) throw new DomainError("UNBALANCED_REVALUATION", 500, { dr, cr });
  return lines;
}

async function resolveAccounts(
  companyId: string,
  exposure: FxExposure,
  create: boolean
): Promise<Parameters<typeof buildRevaluationLines>[1]> {
  const all = await storage.getAccountsByCompanyId(companyId);
  const ref = (a: { id: string; code: string; nameEn: string }): AccountRef => ({
    id: a.id,
    code: a.code,
    nameEn: a.nameEn,
  });
  const byCode = (code: string) => all.find((a) => a.code === code) ?? null;
  const ensure = async (spec: (typeof UNREALISED_FX_ACCOUNTS)["gain" | "loss"]) => {
    const found = byCode(spec.code);
    if (found) {
      if (found.type !== spec.type) {
        throw new DomainError(
          "FX_ACCOUNT_CODE_CONFLICT",
          422,
          { code: spec.code, expectedType: spec.type, actualType: found.type },
          `Account ${spec.code} exists with type ${found.type}; expected ${spec.type}`
        );
      }
      return ref(found);
    }
    if (!create) {
      return { id: `new:${spec.code}`, code: spec.code, nameEn: spec.nameEn };
    }
    const created = await storage.createAccount({
      companyId,
      code: spec.code,
      nameEn: spec.nameEn,
      nameAr: spec.nameAr,
      description: "Period-end unrealised FX revaluation (auto-created)",
      type: spec.type,
      subType: null,
      isVatAccount: false,
      vatType: null,
      isSystemAccount: false,
    } as Parameters<typeof storage.createAccount>[0]);
    return ref(created);
  };
  const banks = new Map<string, AccountRef>();
  for (const i of exposure.items) {
    if (i.kind !== "bank" || !i.accountId) continue;
    const a = all.find((x) => x.id === i.accountId);
    if (a) banks.set(a.id, ref(a));
  }
  const ar = byCode(ACCOUNT_CODES.AR);
  const ap = byCode(ACCOUNT_CODES.AP);
  const net = exposure.totals.netFils;
  return {
    ar: ar ? ref(ar) : null,
    ap: ap ? ref(ap) : null,
    gain: net > 0 ? await ensure(UNREALISED_FX_ACCOUNTS.gain) : null,
    loss: net < 0 ? await ensure(UNREALISED_FX_ACCOUNTS.loss) : null,
    banks,
  };
}

export async function getActiveRevaluation(
  companyId: string,
  asOfIso: string
): Promise<FxRevaluation | null> {
  const [row] = await db
    .select()
    .from(fxRevaluations)
    .where(
      and(
        eq(fxRevaluations.companyId, companyId),
        eq(fxRevaluations.asOf, asOfIso),
        sql`${fxRevaluations.status} <> 'undone'`
      )
    )
    .limit(1);
  return row ?? null;
}

function assertAsOf(asOfInput: string | undefined): string {
  const asOf = toIsoDate(asOfInput, "asOf");
  if (asOf > new Date().toISOString().slice(0, 10)) {
    throw new DomainError("FUTURE_REVALUATION_DATE", 400, { asOf });
  }
  return asOf;
}

const serialise = (lines: RevaluationLine[]) =>
  lines.map((l) => ({
    ...l,
    debit: fromFils(l.debitFils),
    credit: fromFils(l.creditFils),
  }));

export async function previewRevaluation(companyId: string, asOfInput?: string) {
  const asOf = assertAsOf(asOfInput);
  const exposure = await computeFxExposure(companyId, asOf);
  const accounts = await resolveAccounts(companyId, exposure, false);
  const lines = buildRevaluationLines(exposure, accounts);
  const existing = await getActiveRevaluation(companyId, asOf);
  return {
    asOf,
    reversalDate: addDaysIso(asOf, 1),
    baseCurrency: exposure.baseCurrency,
    exposure,
    lines: serialise(lines),
    netGainLoss: fromFils(exposure.totals.netFils),
    alreadyPosted: existing ? { id: existing.id, status: existing.status } : null,
    stale: exposure.items.some((i) => i.stale),
    missingRates: exposure.missingRates,
    warnings: exposure.warnings,
  };
}

type JeLine = { accountId: string; debit: number; credit: number; description: string };

const toJeLines = (lines: RevaluationLine[], flip = false, prefix = ""): JeLine[] =>
  lines.map((l) => ({
    accountId: l.accountId,
    debit: filsToNumber(flip ? l.creditFils : l.debitFils),
    credit: filsToNumber(flip ? l.debitFils : l.creditFils),
    description: `${prefix}${l.description}`.slice(0, 255),
  }));

async function post(
  companyId: string,
  dateIso: string,
  userId: string,
  data: { memo: string; source: string; sourceId: string; reversedEntryId?: string },
  lines: JeLine[]
): Promise<JournalEntry> {
  const { entry } = await storage.createJournalEntryWithLines(
    companyId,
    isoToDate(dateIso),
    {
      memo: data.memo,
      status: "posted",
      source: data.source,
      sourceId: data.sourceId,
      reversedEntryId: data.reversedEntryId ?? null,
      createdBy: userId,
      postedBy: userId,
    },
    lines
  );
  return entry;
}

export interface RunOptions {
  /** Proceed although at least one rate is older than the proximity window. */
  acknowledgeStale?: boolean;
}

export async function runRevaluation(
  companyId: string,
  asOfInput: string | undefined,
  userId: string,
  opts: RunOptions = {}
) {
  const asOf = assertAsOf(asOfInput);
  const reversalDate = addDaysIso(asOf, 1);

  const existing = await getActiveRevaluation(companyId, asOf);
  if (existing) {
    return { posted: false as const, noop: true, reason: "ALREADY_POSTED", revaluation: existing };
  }

  const exposure = await computeFxExposure(companyId, asOf);
  if (exposure.missingRates.length > 0) {
    throw new DomainError(
      "NO_EXCHANGE_RATE",
      422,
      { missing: [...new Set(exposure.missingRates.map((m) => m.currency))], asOf },
      "Add the missing exchange rates before revaluing"
    );
  }
  if (exposure.items.some((i) => i.stale) && !opts.acknowledgeStale) {
    throw new DomainError(
      "STALE_EXCHANGE_RATE",
      409,
      { warnings: exposure.warnings, asOf },
      "At least one rate is older than the proximity window; resend with acknowledgeStale=true"
    );
  }

  const accounts = await resolveAccounts(companyId, exposure, true);
  const lines = buildRevaluationLines(exposure, accounts);
  if (lines.length === 0) {
    return { posted: false as const, noop: true, reason: "NO_REVALUATION", revaluation: null };
  }

  await assertPeriodNotLocked(companyId, isoToDate(asOf));
  await assertPeriodNotLocked(companyId, isoToDate(reversalDate));

  // Claim the (company, as_of) slot first; a concurrent run loses here and is a no-op.
  const claimed = rowsOf(
    await db.execute(sql`
      INSERT INTO fx_revaluations (company_id, as_of, status, created_by)
      VALUES (${companyId}, ${asOf}, 'pending', ${userId})
      ON CONFLICT (company_id, as_of) WHERE status <> 'undone' DO NOTHING
      RETURNING id`)
  );
  if (claimed.length === 0) {
    const again = await getActiveRevaluation(companyId, asOf);
    return { posted: false as const, noop: true, reason: "ALREADY_POSTED", revaluation: again };
  }
  const revaluationId = String(claimed[0].id);

  let entry: JournalEntry | null = null;
  try {
    entry = await post(
      companyId,
      asOf,
      userId,
      {
        memo: `Unrealised FX revaluation ${asOf}`,
        source: FX_REVALUATION_SOURCE,
        sourceId: revaluationId,
      },
      toJeLines(lines)
    );
    const reversal = await post(
      companyId,
      reversalDate,
      userId,
      {
        memo: `Automatic reversal of unrealised FX revaluation ${asOf}`,
        source: FX_REVALUATION_REVERSAL_SOURCE,
        sourceId: revaluationId,
        reversedEntryId: entry.id,
      },
      toJeLines(lines, true, "Reversal — ")
    );
    const summary = {
      receivable: fromFils(exposure.totals.receivableFils),
      payable: fromFils(exposure.totals.payableFils),
      bank: fromFils(exposure.totals.bankFils),
      rateType: exposure.rateType,
      reversalDate,
      items: exposure.items.length,
      lines: serialise(lines),
      warnings: exposure.warnings,
    };
    const [row] = await db
      .update(fxRevaluations)
      .set({
        status: "posted",
        journalEntryId: entry.id,
        reversalEntryId: reversal.id,
        netGainLoss: filsToNumber(exposure.totals.netFils),
        summary,
      })
      .where(eq(fxRevaluations.id, revaluationId))
      .returning();
    return {
      posted: true as const,
      noop: false,
      revaluation: row,
      journalEntryId: entry.id,
      reversalEntryId: reversal.id,
      netGainLoss: fromFils(exposure.totals.netFils),
      lines: serialise(lines),
      warnings: exposure.warnings,
    };
  } catch (err) {
    // Compensate a half-posted run so the books never keep an unreversed revaluation.
    if (entry) {
      await post(
        companyId,
        asOf,
        userId,
        {
          memo: `Rollback of failed FX revaluation ${asOf}`,
          source: FX_REVALUATION_UNDO_SOURCE,
          sourceId: revaluationId,
          reversedEntryId: entry.id,
        },
        toJeLines(lines, true, "Rollback — ")
      ).catch(() => undefined);
      await db
        .update(fxRevaluations)
        .set({ status: "undone", journalEntryId: entry.id, undoneAt: new Date() })
        .where(eq(fxRevaluations.id, revaluationId));
    } else {
      await db.delete(fxRevaluations).where(eq(fxRevaluations.id, revaluationId));
    }
    throw err;
  }
}

export async function undoRevaluation(companyId: string, revaluationId: string, userId: string) {
  const [row] = await db
    .select()
    .from(fxRevaluations)
    .where(and(eq(fxRevaluations.id, revaluationId), eq(fxRevaluations.companyId, companyId)))
    .limit(1);
  if (!row) throw new DomainError("REVALUATION_NOT_FOUND", 404);
  if (row.status !== "posted") {
    throw new DomainError("REVALUATION_NOT_POSTED", 409, { status: row.status });
  }
  const reversalDate = addDaysIso(row.asOf, 1);
  await assertPeriodNotLocked(companyId, isoToDate(row.asOf));
  await assertPeriodNotLocked(companyId, isoToDate(reversalDate));

  const undoIds: string[] = [];
  for (const [entryId, dateIso] of [
    [row.journalEntryId, row.asOf],
    [row.reversalEntryId, reversalDate],
  ] as const) {
    if (!entryId) continue;
    const original = await storage.getJournalLinesByEntryId(entryId);
    const undo = await post(
      companyId,
      dateIso,
      userId,
      {
        memo: `Undo of unrealised FX revaluation ${row.asOf}`,
        source: FX_REVALUATION_UNDO_SOURCE,
        sourceId: row.id,
        reversedEntryId: entryId,
      },
      original.map((l) => ({
        accountId: l.accountId,
        debit: Number(l.credit) || 0,
        credit: Number(l.debit) || 0,
        description: `Undo — ${l.description ?? ""}`.slice(0, 255),
      }))
    );
    undoIds.push(undo.id);
  }
  const [updated] = await db
    .update(fxRevaluations)
    .set({
      status: "undone",
      undoneBy: userId,
      undoneAt: new Date(),
      summary: { ...((row.summary as Record<string, unknown>) ?? {}), undoEntryIds: undoIds },
    })
    .where(eq(fxRevaluations.id, row.id))
    .returning();
  return { undone: true, revaluation: updated, undoEntryIds: undoIds };
}

export async function listRevaluations(companyId: string): Promise<FxRevaluation[]> {
  return db
    .select()
    .from(fxRevaluations)
    .where(eq(fxRevaluations.companyId, companyId))
    .orderBy(desc(fxRevaluations.asOf), desc(fxRevaluations.createdAt))
    .limit(200);
}
