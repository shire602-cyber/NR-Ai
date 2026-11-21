/**
 * The ledger posting kernel: the one place journal entries are written.
 * Public surface is re-exported from ./index.ts and documented in README.md.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias as aliasTable } from "drizzle-orm/pg-core";
import {
  accounts,
  auditLogs,
  costCenters,
  journalEntries,
  journalLines,
  type JournalEntry,
  type JournalLine,
} from "../../shared/schema";
import { filsToNumber, toFils } from "../../shared/money";
import { db } from "../db";
import { DomainError } from "../errors";
import {
  assertPeriodNotLocked,
  getEffectiveLock,
  lockPeriodPolicy,
} from "../services/period-lock.service";
import {
  assertLinesBalanced,
  assertNotFuture,
  isUuid,
  normalizeEntry,
  parseLedgerDate,
  todayIso,
} from "./normalize";
import { allocateEntryNumber, lockIdempotencyKey } from "./numbering";
import { journalMemo } from "@shared/journal-memo";
import { journalMachine, transitionRow } from "./state-machines";
import { assertVatPeriodOpen } from "./vat-lock";
import { assertKernelControlPosting, stampControlAdjustment } from "./control-accounts";
import { findPgError, rowsOf, withLedgerTx } from "./tx";
import type {
  EntryKind,
  JournalLineAttributes,
  LedgerContext,
  LedgerTx,
  NormalizedEntry,
  NormalizedLine,
  PostDraftOptions,
  PostJournalInput,
  PostJournalResult,
  ReverseOptions,
  ReverseResult,
} from "./types";

/** Options only the kernel's own flows (reversal, legacy adapter) may set. */
export interface InternalPostOptions {
  /** Skip the active/archived check (reversals must be able to undo old postings). */
  allowInactiveAccounts?: boolean;
  reversedEntryId?: string | null;
  reversalReason?: string | null;
  /** Mark this original as reversed by the new entry (same transaction). */
  reversalOf?: { entryId: string; kind: "reversed" | "voided" } | null;
  postedBy?: string | null;
  postedAt?: Date | null;
  auditAction?: string;
  auditBefore?: unknown;
}

function actorOf(ctx: LedgerContext): string {
  if (!ctx || !isUuid(ctx.actorId)) {
    throw new DomainError("ACTOR_REQUIRED", 422, undefined, "Ledger writes need an acting user id");
  }
  return ctx.actorId;
}

function requestMeta(ctx: LedgerContext): { ipAddress: string | null; userAgent: string | null } {
  const req = ctx.req;
  if (!req) return { ipAddress: null, userAgent: null };
  const fwd = req.headers?.["x-forwarded-for"];
  const ip =
    (typeof fwd === "string" ? fwd.split(",")[0]?.trim() : undefined) ||
    req.socket?.remoteAddress ||
    null;
  const ua = req.headers?.["user-agent"];
  return { ipAddress: ip, userAgent: typeof ua === "string" ? ua : null };
}

async function writeAudit(
  tx: LedgerTx,
  ctx: LedgerContext,
  companyId: string,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown
): Promise<void> {
  const meta = requestMeta(ctx);
  await tx.insert(auditLogs).values({
    userId: ctx.actorId,
    action,
    resourceType: "journal_entry",
    resourceId: entityId,
    details: JSON.stringify({ companyId, before: before ?? null, after: after ?? null }),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

/** Sub-types whose accounts become non-postable headers once they have sub-accounts. */
export const HEADER_SUB_TYPES = ["cash", "bank"] as const;

/** Accounts must exist in the company; unless allowed, be active and not archived. */
async function assertAccountsUsable(
  tx: LedgerTx,
  companyId: string,
  lines: NormalizedLine[],
  allowInactive: boolean
): Promise<void> {
  const ids = [...new Set(lines.map((l) => l.accountId))];
  const rows: Array<{ id: string; companyId: string; isActive: boolean; isArchived: boolean }> =
    await tx
      .select({
        id: accounts.id,
        companyId: accounts.companyId,
        isActive: accounts.isActive,
        isArchived: accounts.isArchived,
      })
      .from(accounts)
      .where(inArray(accounts.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const acc = byId.get(id);
    if (!acc || acc.companyId !== companyId) {
      throw new DomainError(
        "ACCOUNT_NOT_FOUND",
        422,
        { accountId: id },
        `Account ${id} is not in this company's chart of accounts`
      );
    }
    if (!allowInactive && (!acc.isActive || acc.isArchived)) {
      throw new DomainError(
        "ACCOUNT_INACTIVE",
        422,
        { accountId: id },
        "Cannot post to an inactive or archived account"
      );
    }
  }
  if (!allowInactive) {
    // X5 (J1 D1) / X6a: a cash or bank header account (a cash/bank account with sub-accounts)
    // summarises its children and never receives postings, so money always lands on the leaf
    // the bank statement can match. The rule is deliberately limited to cash/bank sub-types:
    // users may add sub-accounts under revenue, receivables, VAT or expense accounts for
    // reporting, and the system posting codes (4010, 1040, 2020, ...) must keep working.
    // Reversals (allowInactive) may still mirror an old posting to it.
    const parent = aliasTable(accounts, "parent_account");
    const headers: Array<{ id: string }> = await tx
      .select({ id: parent.id })
      .from(parent)
      .innerJoin(
        accounts,
        and(eq(accounts.parentId, parent.id), eq(accounts.companyId, parent.companyId))
      )
      .where(
        and(
          eq(parent.companyId, companyId),
          inArray(parent.id, ids),
          inArray(parent.subType, [...HEADER_SUB_TYPES]),
          eq(accounts.isArchived, false)
        )
      )
      .limit(1);
    const header = headers[0]?.id;
    if (header) {
      throw new DomainError(
        "ACCOUNT_IS_HEADER",
        422,
        { accountId: header },
        "Cannot post to a bank or cash header account that has sub-accounts; choose one of its sub-accounts"
      );
    }
  }
  const ccIds = [...new Set(lines.map((l) => l.costCenterId).filter((x): x is string => !!x))];
  if (ccIds.length) {
    const ccRows: Array<{ id: string }> = await tx
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(and(eq(costCenters.companyId, companyId), inArray(costCenters.id, ccIds)));
    const found = new Set(ccRows.map((r) => r.id));
    const missing = ccIds.find((id) => !found.has(id));
    if (missing) {
      throw new DomainError(
        "COST_CENTER_NOT_FOUND",
        422,
        { costCenterId: missing },
        `Cost center ${missing} not found in this company`
      );
    }
  }
}

function lineRow(entryId: string, l: NormalizedLine) {
  return {
    entryId,
    accountId: l.accountId,
    costCenterId: l.costCenterId,
    debit: filsToNumber(l.debitFils),
    credit: filsToNumber(l.creditFils),
    description: l.description,
    lineKey: l.lineKey ?? null,
    lineParams: l.lineKey ? (l.lineParams ?? null) : null,
    foreignCurrency: l.foreignCurrency,
    foreignDebit: filsToNumber(l.foreignDebitFils),
    foreignCredit: filsToNumber(l.foreignCreditFils),
    ...(l.exchangeRate ? { exchangeRate: Number(l.exchangeRate) } : {}),
    // WQ3 (0124): the derived VAT leg and the descriptive per-line attributes.
    systemVat: l.systemVat === true,
    contactType: l.attributes?.contactType ?? null,
    contactId: l.attributes?.contactId ?? null,
    vatTreatment: l.attributes?.vatTreatment ?? null,
    ctTreatment: l.attributes?.ctTreatment ?? null,
    ctDisallowedPct: l.attributes?.ctDisallowedPct ?? null,
  };
}

async function findByIdempotencyKey(
  tx: LedgerTx,
  companyId: string,
  key: string
): Promise<PostJournalResult | null> {
  const [entry]: JournalEntry[] = await tx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.idempotencyKey, key)));
  if (!entry) return null;
  const lines: JournalLine[] = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, entry.id));
  return { entry, lines, replayed: true };
}

function isEntryNumberConflict(err: unknown): boolean {
  const pg = findPgError(err, "23505");
  const text = String(pg?.constraint || pg?.detail || "").toLowerCase();
  return !!pg && (text.includes("entry_number") || text.includes("company_entry"));
}

function isOneReversalConflict(err: unknown): boolean {
  const pg = findPgError(err, "23505");
  return !!pg && String(pg.constraint || pg.detail || "").includes("one_reversal");
}

function isIdempotencyConflict(err: unknown): boolean {
  const pg = findPgError(err, "23505");
  return !!pg && String(pg.constraint || pg.detail || "").includes("idempotency");
}

/** Insert a normalised entry inside `tx`. Numbering, idempotency, guards. */
export async function insertNormalizedEntry(
  tx: LedgerTx,
  n: NormalizedEntry,
  ctx: LedgerContext,
  internal: InternalPostOptions = {}
): Promise<PostJournalResult> {
  const actorId = actorOf(ctx);
  // Year-end close/reopen takes this lock exclusively before posting a journal.
  await lockPeriodPolicy(tx, n.companyId, "shared");
  if (n.idempotencyKey) {
    await lockIdempotencyKey(tx, n.companyId, n.idempotencyKey);
    const replay = await findByIdempotencyKey(tx, n.companyId, n.idempotencyKey);
    if (replay) return replay;
  }
  await assertPeriodNotLocked(n.companyId, n.dateAt, tx);
  assertLinesBalanced(n.lines, { allowSameAccount: true });
  await assertAccountsUsable(tx, n.companyId, n.lines, !!internal.allowInactiveAccounts);
  // B1 (NC1): control accounts take lines only from their sub-ledger, or as a reasoned
  // adjustment. A reversal mirrors an entry that already passed this gate.
  const controlReason = internal.reversedEntryId
    ? null
    : await assertKernelControlPosting(tx, {
        companyId: n.companyId,
        source: n.source,
        lines: n.lines,
        ctx,
      });

  const isPosted = n.status === "posted";
  // A1 (C1): a submitted / filed VAT return closes its period for VAT-affecting postings.
  if (isPosted) {
    await assertVatPeriodOpen(tx, {
      companyId: n.companyId,
      dateIso: n.dateIso,
      source: n.source,
      accountIds: n.lines.map((l) => l.accountId),
      reversedEntryId: internal.reversedEntryId ?? null,
      reportsVat: n.reportsVat === true,
    });
  }
  const values = {
    companyId: n.companyId,
    entryNumber: "",
    date: n.dateAt,
    memo: n.memo,
    memoKey: n.memoKey,
    memoParams: n.memoParams,
    status: n.status,
    source: n.source,
    sourceId: n.sourceId,
    reversedEntryId: internal.reversedEntryId ?? null,
    reversalReason: internal.reversalReason ?? null,
    createdBy: actorId,
    postedBy: isPosted ? (internal.postedBy ?? actorId) : null,
    postedAt: isPosted ? (internal.postedAt ?? new Date()) : null,
    idempotencyKey: n.idempotencyKey,
    entryKind: n.kind,
    reference: n.reference,
    autoReverseOn: n.autoReverseOn,
  };

  let result: { entry: JournalEntry; lines: JournalLine[] } | null = null;
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    try {
      // Savepoint: a 23505 on the number rolls back only this attempt, so the
      // retry also works inside a caller's transaction.
      result = await tx.transaction(async (sp: LedgerTx) => {
        values.entryNumber = await allocateEntryNumber(sp, n.companyId, n.dateAt);
        const [entry]: JournalEntry[] = await sp.insert(journalEntries).values(values).returning();
        const lines: JournalLine[] = await sp
          .insert(journalLines)
          .values(n.lines.map((l) => lineRow(entry.id, l)))
          .returning();
        return { entry, lines };
      });
    } catch (err) {
      if (isOneReversalConflict(err)) {
        throw new DomainError("ALREADY_REVERSED", 409, { entryId: internal.reversedEntryId });
      }
      if (n.idempotencyKey && isIdempotencyConflict(err)) {
        const replay = await findByIdempotencyKey(tx, n.companyId, n.idempotencyKey);
        if (replay) return replay;
      }
      if (attempt === 0 && isEntryNumberConflict(err)) continue;
      throw err;
    }
  }
  if (!result) throw new DomainError("ENTRY_NUMBER_CONFLICT", 409);
  const { entry } = result;
  if (controlReason) await stampControlAdjustment(tx, entry.id, controlReason, actorId);

  if (internal.reversalOf) {
    const rows: JournalEntry[] = await tx
      .update(journalEntries)
      .set({
        reversedByEntryId: entry.id,
        reversalKind: internal.reversalOf.kind,
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(journalEntries.id, internal.reversalOf.entryId),
          sql`${journalEntries.reversedByEntryId} IS NULL`
        )
      )
      .returning();
    if (rows.length === 0) {
      throw new DomainError("ALREADY_REVERSED", 409, { entryId: internal.reversalOf.entryId });
    }
  }

  const action =
    internal.auditAction ??
    (ctx.audit ? (isPosted ? "journal.create_posted" : "journal.create_draft") : null);
  if (action) {
    await writeAudit(tx, ctx, n.companyId, action, entry.id, internal.auditBefore ?? null, {
      entryNumber: entry.entryNumber,
      status: entry.status,
      kind: entry.entryKind,
      totalDebitFils: n.totalDebitFils,
      totalCreditFils: n.totalCreditFils,
      lineCount: n.lines.length,
    });
  }
  return { entry, lines: result.lines, replayed: false };
}

/**
 * Post (or save as draft) one balanced journal entry. Throws DomainError 422
 * for invalid input, 403 for a locked period.
 */
export async function postJournal(
  input: PostJournalInput,
  ctx: LedgerContext
): Promise<PostJournalResult> {
  const n = normalizeEntry(input);
  return postNormalized(n, ctx);
}

export async function postNormalized(
  n: NormalizedEntry,
  ctx: LedgerContext,
  internal: InternalPostOptions = {}
): Promise<PostJournalResult> {
  actorOf(ctx);
  return withLedgerTx((tx) => insertNormalizedEntry(tx, n, ctx, internal), ctx.tx);
}

// ─── Entry loading ──────────────────────────────────────────────────────

export interface LineFils {
  id: string;
  accountId: string;
  costCenterId: string | null;
  debitFils: number;
  creditFils: number;
  description: string | null;
  lineKey: string | null;
  lineParams: Record<string, string> | null;
  foreignCurrency: string | null;
  foreignDebitFils: number;
  foreignCreditFils: number;
  exchangeRate: string | null;
  /** WQ3 (0124): the stored VAT-leg flag and per-line attributes (copied by a reversal). */
  systemVat: boolean;
  attributes: JournalLineAttributes;
}

async function loadEntry(
  tx: LedgerTx,
  entryId: string,
  companyId?: string,
  forUpdate = false
): Promise<JournalEntry | null> {
  if (!isUuid(entryId)) return null;
  const cond = companyId
    ? and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId))
    : eq(journalEntries.id, entryId);
  let q = tx.select().from(journalEntries).where(cond).$dynamic();
  if (forUpdate) q = q.for("update");
  const [row]: JournalEntry[] = await q;
  return row ?? null;
}

export async function loadLinesFils(tx: LedgerTx, entryId: string): Promise<LineFils[]> {
  const res = await tx.execute(sql`
    SELECT id, account_id, cost_center_id, debit::text AS debit, credit::text AS credit,
           description, line_key, line_params, foreign_currency, COALESCE(foreign_debit, 0)::text AS foreign_debit,
           COALESCE(foreign_credit, 0)::text AS foreign_credit, exchange_rate::text AS exchange_rate,
           system_vat, contact_type, contact_id, vat_treatment, ct_treatment,
           ct_disallowed_pct::text AS ct_disallowed_pct
      FROM journal_lines WHERE entry_id = ${entryId}
  `);
  return rowsOf<Record<string, string | null>>(res).map((r) => ({
    systemVat: (r.system_vat as unknown) === true,
    attributes: compactAttributes({
      contactType: (r.contact_type as JournalLineAttributes["contactType"]) ?? null,
      contactId: r.contact_id ?? null,
      vatTreatment: (r.vat_treatment as JournalLineAttributes["vatTreatment"]) ?? null,
      ctTreatment: (r.ct_treatment as JournalLineAttributes["ctTreatment"]) ?? null,
      ctDisallowedPct: r.ct_disallowed_pct ?? null,
    }),
    id: String(r.id),
    accountId: String(r.account_id),
    costCenterId: r.cost_center_id ?? null,
    debitFils: toFils(r.debit ?? "0"),
    creditFils: toFils(r.credit ?? "0"),
    description: r.description ?? null,
    lineKey: r.line_key ?? null,
    lineParams: (r.line_params as unknown as Record<string, string> | null) ?? null,
    foreignCurrency: r.foreign_currency ?? null,
    foreignDebitFils: toFils(r.foreign_debit ?? "0"),
    foreignCreditFils: toFils(r.foreign_credit ?? "0"),
    exchangeRate: r.exchange_rate ?? null,
  }));
}

/** Drop null attributes so an untouched line mirrors to an untouched line. */
function compactAttributes(a: JournalLineAttributes): JournalLineAttributes {
  return Object.fromEntries(
    Object.entries(a).filter(([, v]) => v !== null && v !== undefined)
  ) as JournalLineAttributes;
}

function entryIso(entry: JournalEntry): string {
  return new Date(entry.date).toISOString().slice(0, 10);
}

function notFound(entryId: string): DomainError {
  return new DomainError("ENTRY_NOT_FOUND", 404, { entryId }, "Journal entry not found");
}

// ─── Draft -> posted ─────────────────────────────────────────────────────

/**
 * Post a draft: ONE conditional UPDATE ... WHERE status = 'draft' RETURNING.
 * Concurrent callers: one wins, the rest get 409 ENTRY_NOT_DRAFT; exactly one
 * audit row is written (in the same transaction as the update).
 */
export async function postDraft(
  entryId: string,
  ctx: LedgerContext,
  opts: PostDraftOptions = {}
): Promise<PostJournalResult> {
  const actorId = actorOf(ctx);
  return withLedgerTx(async (tx) => {
    const pre = await loadEntry(tx, entryId, ctx.companyId, true);
    if (!pre) throw notFound(entryId);
    if (pre.status !== "draft") {
      throw new DomainError(
        "ENTRY_NOT_DRAFT",
        409,
        { status: pre.status },
        "Only draft entries can be posted"
      );
    }
    await lockPeriodPolicy(tx, pre.companyId, "shared");
    await assertPeriodNotLocked(pre.companyId, pre.date, tx);
    assertNotFuture(entryIso(pre));
    const raw = await loadLinesFils(tx, entryId);
    const lines = raw.filter((l) => l.debitFils !== 0 || l.creditFils !== 0);
    const normalized: NormalizedLine[] = lines.map((l) => ({ ...l }));
    const totals = assertLinesBalanced(normalized, { allowSameAccount: true });
    await assertAccountsUsable(tx, pre.companyId, normalized, false);
    await assertVatPeriodOpen(tx, {
      companyId: pre.companyId,
      dateIso: entryIso(pre),
      source: pre.source ?? null,
      accountIds: normalized.map((l) => l.accountId),
      entryId,
    });

    const patch: Record<string, unknown> = {
      postedBy: actorId,
      postedAt: new Date(),
      updatedBy: actorId,
      updatedAt: new Date(),
    };
    const threshold = opts.approvalThresholdFils;
    if (threshold != null && totals.debitFils > threshold && pre.approvalStatus !== "approved") {
      if (pre.createdBy === actorId) {
        throw new DomainError(
          "APPROVAL_REQUIRED",
          409,
          { thresholdFils: threshold, totalFils: totals.debitFils },
          "This entry is above the approval threshold and must be approved by another user"
        );
      }
      patch.approvalStatus = "approved";
      patch.approvedBy = actorId;
      patch.approvedAt = new Date();
    }

    const row = await transitionRow<JournalEntry>(
      tx,
      journalEntries,
      entryId,
      "draft",
      "posted",
      patch,
      { machine: journalMachine, where: eq(journalEntries.companyId, pre.companyId) }
    );
    if (!row) {
      throw new DomainError("ENTRY_NOT_DRAFT", 409, undefined, "Entry is no longer a draft");
    }
    await writeAudit(
      tx,
      ctx,
      pre.companyId,
      "journal.post",
      entryId,
      { status: "draft" },
      {
        status: "posted",
        entryNumber: row.entryNumber,
        approvedBy: patch.approvedBy ?? null,
      }
    );
    const outLines: JournalLine[] = await tx
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, entryId));
    return { entry: row, lines: outLines, replayed: false };
  }, ctx.tx);
}

// ─── Reversal / void ─────────────────────────────────────────────────────

type ReversalMode = "reversed" | "voided";

async function resolveReversalDate(
  tx: LedgerTx,
  original: JournalEntry,
  opts: ReverseOptions,
  mode: ReversalMode
): Promise<Date> {
  const origIso = entryIso(original);
  if (mode === "voided") return new Date(original.date);
  if (opts.date) {
    const { iso, at } = parseLedgerDate(opts.date);
    if (iso < origIso) {
      throw new DomainError(
        "REVERSAL_BEFORE_ORIGINAL",
        422,
        { date: iso, originalDate: origIso },
        "A reversal cannot be dated before the entry it reverses"
      );
    }
    if (!opts.allowFutureDate) assertNotFuture(iso);
    return iso === origIso ? new Date(original.date) : at;
  }
  await lockPeriodPolicy(tx, original.companyId, "shared");
  if (!(await getEffectiveLock(original.companyId, origIso, tx))) return new Date(original.date);
  return new Date(`${todayIso()}T00:00:00.000Z`);
}

function assertReversible(entry: JournalEntry): void {
  if (entry.status !== "posted") {
    throw new DomainError(
      "ENTRY_NOT_POSTED",
      409,
      { status: entry.status },
      "Only posted entries can be reversed or voided"
    );
  }
  if (entry.reversedByEntryId) {
    throw new DomainError(
      "ALREADY_REVERSED",
      409,
      { reversedByEntryId: entry.reversedByEntryId },
      "This entry has already been reversed"
    );
  }
  if (entry.entryKind === "reversal") {
    throw new DomainError(
      "ENTRY_IS_REVERSAL",
      409,
      { reversalOf: entry.reversedEntryId },
      "A reversal entry cannot itself be reversed; post a new entry instead"
    );
  }
}

async function reverseInTx(
  tx: LedgerTx,
  entryId: string,
  opts: ReverseOptions,
  mode: ReversalMode,
  ctx: LedgerContext
): Promise<ReverseResult> {
  const original = await loadEntry(tx, entryId, ctx.companyId, true);
  if (!original) throw notFound(entryId);
  assertReversible(original);
  const date = await resolveReversalDate(tx, original, opts, mode);
  const lines = await loadLinesFils(tx, entryId);
  const mirrored: NormalizedLine[] = lines
    .filter((l) => l.debitFils !== 0 || l.creditFils !== 0)
    .flatMap((l) => {
      const line: NormalizedLine = {
        accountId: l.accountId,
        debitFils: l.creditFils,
        creditFils: l.debitFils,
        description: l.description,
        ...(l.lineKey ? { lineKey: l.lineKey, lineParams: l.lineParams } : {}),
        costCenterId: l.costCenterId,
        foreignCurrency: l.foreignCurrency,
        foreignDebitFils: l.foreignCreditFils,
        foreignCreditFils: l.foreignDebitFils,
        exchangeRate: l.exchangeRate,
        // WQ3: the reversal carries the same VAT-leg flag and CT treatment, so the CT workpaper
        // and the VAT engine net the reversed line to zero.
        ...(l.systemVat ? { systemVat: true } : {}),
        ...(Object.keys(l.attributes).length ? { attributes: l.attributes } : {}),
      };
      if (line.debitFils > 0 && line.creditFils > 0) {
        // Split the two sides of a historical line, preserving its gross movement.
        return [
          { ...line, creditFils: 0, foreignCreditFils: 0 },
          { ...line, debitFils: 0, foreignDebitFils: 0 },
        ];
      }
      return [line];
    });
  if (mirrored.length === 0) {
    throw new DomainError(
      "ENTRY_HAS_NO_LINES",
      422,
      undefined,
      "Cannot reverse an entry with no lines"
    );
  }
  const { debitFils, creditFils } = assertLinesBalanced(mirrored, { allowSameAccount: true });
  const reason = opts.reason ? String(opts.reason).slice(0, 1000) : null;
  const n: NormalizedEntry = {
    companyId: original.companyId,
    dateIso: date.toISOString().slice(0, 10),
    dateAt: date,
    ...(opts.memo
      ? {
          memo: String(opts.memo).slice(0, 1000),
          memoKey: opts.memoKey ? String(opts.memoKey).slice(0, 80) : null,
          memoParams: opts.memoKey && opts.memoParams ? opts.memoParams : null,
        }
      : (() => {
          const m = journalMemo(
            `${mode === "voided" ? "void" : "reversal"}Of${reason ? "Reason" : ""}` as
              | "voidOf"
              | "voidOfReason"
              | "reversalOf"
              | "reversalOfReason",
            { entry: original.entryNumber, reason: reason ?? "" }
          );
          return {
            memo: m.memo.slice(0, 1000),
            memoKey: m.memoKey as string | null,
            memoParams: m.memoParams as Record<string, string> | null,
          };
        })()),
    reference: original.reference ?? null,
    source: opts.source ? String(opts.source) : "reversal",
    sourceId: opts.sourceId ?? original.id,
    idempotencyKey: null,
    status: "posted",
    kind: "reversal" satisfies EntryKind,
    autoReverseOn: null,
    lines: mirrored,
    totalDebitFils: debitFils,
    totalCreditFils: creditFils,
  };
  const res = await insertNormalizedEntry(tx, n, ctx, {
    // A reversal mirrors the original exactly, including accounts archived since posting.
    allowInactiveAccounts: true,
    reversedEntryId: original.id,
    reversalReason: reason,
    reversalOf: { entryId: original.id, kind: mode },
    auditAction: mode === "voided" ? "journal.void" : "journal.reverse",
    auditBefore: { status: "posted", entryNumber: original.entryNumber, reversalOf: original.id },
  });
  const updated = (await loadEntry(tx, original.id)) ?? original;
  return { original: updated, reversal: res.entry, lines: res.lines };
}

async function reverseOrVoid(
  entryId: string,
  opts: ReverseOptions,
  mode: ReversalMode,
  ctx: LedgerContext
): Promise<ReverseResult> {
  actorOf(ctx);
  return withLedgerTx((tx) => reverseInTx(tx, entryId, opts, mode, ctx), ctx.tx);
}

/**
 * Reverse a posted entry: a new posted entry that mirrors the ORIGINAL lines
 * exactly (accounts, base and foreign amounts, rate, cost centre) with sides
 * swapped. Exactly one reversal per entry (409 ALREADY_REVERSED).
 */
export function reverseEntry(
  entryId: string,
  opts: ReverseOptions,
  ctx: LedgerContext
): Promise<ReverseResult> {
  return reverseOrVoid(entryId, opts ?? {}, "reversed", ctx);
}

/** Void = a reversal dated on the original date; the original is labelled "voided". */
export function voidEntry(
  entryId: string,
  opts: { reason?: string | null },
  ctx: LedgerContext
): Promise<ReverseResult> {
  return reverseOrVoid(entryId, { reason: opts?.reason ?? null }, "voided", ctx);
}

/**
 * Reverse every unreversed posted entry of one source document (void, credit,
 * unmatch and revise flows). Returns [] when there is nothing to reverse.
 */
export async function reverseBySource(
  companyId: string,
  source: string,
  sourceId: string,
  opts: ReverseOptions & { void?: boolean },
  ctx: LedgerContext
): Promise<ReverseResult[]> {
  actorOf(ctx);
  if (!isUuid(companyId) || !isUuid(sourceId)) return [];
  const mode: ReversalMode = opts?.void ? "voided" : "reversed";
  const candidates: JournalEntry[] = await (ctx.tx ?? db)
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, companyId),
        eq(journalEntries.source, source),
        eq(journalEntries.sourceId, sourceId),
        eq(journalEntries.status, "posted"),
        sql`${journalEntries.reversedByEntryId} IS NULL`,
        sql`${journalEntries.entryKind} <> 'reversal'`
      )
    );
  if (candidates.length === 0) return [];
  const scoped: LedgerContext = { ...ctx, companyId };
  return withLedgerTx(async (tx) => {
    const out: ReverseResult[] = [];
    for (const c of candidates) {
      out.push(await reverseInTx(tx, c.id, opts ?? {}, mode, scoped));
    }
    return out;
  }, ctx.tx);
}

/** Mark a draft as waiting for approval (maker-checker). */
export async function submitForApproval(
  entryId: string,
  ctx: LedgerContext
): Promise<JournalEntry> {
  const actorId = actorOf(ctx);
  const tx = ctx.tx ?? db;
  const cond = ctx.companyId
    ? and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, ctx.companyId))
    : eq(journalEntries.id, entryId);
  const rows: JournalEntry[] = await tx
    .update(journalEntries)
    .set({ approvalStatus: "pending", updatedBy: actorId, updatedAt: new Date() })
    .where(and(cond, eq(journalEntries.status, "draft")))
    .returning();
  if (!rows[0]) throw new DomainError("ENTRY_NOT_DRAFT", 409);
  return rows[0];
}

/**
 * Replace a DRAFT's header and lines (same validation as postJournal). One
 * conditional UPDATE ... WHERE status = 'draft'; 409 ENTRY_NOT_DRAFT otherwise.
 * The entry number is kept.
 */
export async function updateDraftEntry(
  entryId: string,
  input: Omit<PostJournalInput, "status" | "companyId" | "idempotencyKey" | "source">,
  ctx: LedgerContext
): Promise<PostJournalResult> {
  const actorId = actorOf(ctx);
  return withLedgerTx(async (tx) => {
    const pre = await loadEntry(tx, entryId, ctx.companyId, true);
    if (!pre) throw notFound(entryId);
    if (pre.status !== "draft") {
      throw new DomainError(
        "ENTRY_NOT_DRAFT",
        409,
        { status: pre.status },
        "Only draft entries can be edited"
      );
    }
    const n = normalizeEntry({
      ...input,
      companyId: pre.companyId,
      status: "draft",
      source: pre.source,
    });
    await lockPeriodPolicy(tx, pre.companyId, "shared");
    await assertPeriodNotLocked(pre.companyId, pre.date, tx);
    if (entryIso(pre) !== n.dateIso) await assertPeriodNotLocked(pre.companyId, n.dateAt, tx);
    await assertAccountsUsable(tx, pre.companyId, n.lines, false);
    // B1 (NC1) / C1: an edited draft is held to the control-account rule like a new entry,
    // whatever its source: the edited lines are the user's, never a service's derived legs.
    const stamped = rowsOf<{ r: string | null }>(
      await tx.execute(
        sql`SELECT control_adjustment_reason AS r FROM journal_entries WHERE id = ${entryId}`
      )
    )[0]?.r;
    const controlReason = await assertKernelControlPosting(tx, {
      companyId: pre.companyId,
      source: pre.source ?? null,
      lines: n.lines,
      ctx,
      stampedReason: stamped ?? null,
    });
    const rows: JournalEntry[] = await tx
      .update(journalEntries)
      .set({
        date: n.dateAt,
        memo: n.memo,
        memoKey: n.memoKey,
        memoParams: n.memoParams,
        reference: n.reference,
        autoReverseOn: n.autoReverseOn,
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(journalEntries.id, entryId),
          eq(journalEntries.companyId, pre.companyId),
          eq(journalEntries.status, "draft")
        )
      )
      .returning();
    if (!rows[0])
      throw new DomainError("ENTRY_NOT_DRAFT", 409, undefined, "Entry is no longer a draft");
    await tx.delete(journalLines).where(eq(journalLines.entryId, entryId));
    const lines: JournalLine[] = await tx
      .insert(journalLines)
      .values(n.lines.map((l) => lineRow(entryId, l)))
      .returning();
    await stampControlAdjustment(tx, entryId, controlReason, actorId);
    await writeAudit(
      tx,
      ctx,
      pre.companyId,
      "journal.update",
      entryId,
      {
        entryNumber: pre.entryNumber,
        status: pre.status,
      },
      { totalDebitFils: n.totalDebitFils, lineCount: n.lines.length, date: n.dateIso }
    );
    return { entry: rows[0], lines, replayed: false };
  }, ctx.tx);
}

/**
 * Delete a DRAFT entry and its lines (a draft has no ledger effect, so removing it is the inverse
 * of creating it). Conditional on `status = 'draft'` and the company; returns false when the entry
 * is already gone, 409 ENTRY_NOT_DRAFT when it has been posted (reverse it instead). Audited.
 */
export async function deleteDraft(entryId: string, ctx: LedgerContext): Promise<boolean> {
  actorOf(ctx);
  return withLedgerTx(async (tx) => {
    const pre = await loadEntry(tx, entryId, ctx.companyId, true);
    if (!pre) return false;
    if (pre.status !== "draft") {
      throw new DomainError(
        "ENTRY_NOT_DRAFT",
        409,
        { status: pre.status },
        "Only draft entries can be deleted; reverse a posted entry instead"
      );
    }
    await tx.delete(journalLines).where(eq(journalLines.entryId, entryId));
    const rows = await tx
      .delete(journalEntries)
      .where(
        and(
          eq(journalEntries.id, entryId),
          eq(journalEntries.companyId, pre.companyId),
          eq(journalEntries.status, "draft")
        )
      )
      .returning({ id: journalEntries.id });
    if (!rows[0]) throw new DomainError("ENTRY_NOT_DRAFT", 409);
    await writeAudit(
      tx,
      ctx,
      pre.companyId,
      "journal.delete_draft",
      entryId,
      { entryNumber: pre.entryNumber, status: pre.status, source: pre.source },
      null
    );
    return true;
  }, ctx.tx);
}

/** Lifecycle view of an entry for API responses (both sides of a reversal). */
export function describeReversal(entry: JournalEntry): {
  reversedByEntryId: string | null;
  reversalOf: string | null;
  reversalKind: string | null;
} {
  return {
    reversedByEntryId: entry.reversedByEntryId ?? null,
    reversalOf: entry.entryKind === "reversal" ? (entry.reversedEntryId ?? null) : null,
    reversalKind: entry.reversalKind ?? null,
  };
}
