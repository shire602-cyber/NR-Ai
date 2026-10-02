/**
 * VAT 201 "filed with evidence" (Phase 4.1).
 *
 *  - recordVatFiling: reference + filing date (+ optional acknowledgement upload),
 *    an immutable snapshot of every box + SHA-256, the VAT clearing journal, and
 *    the lock of every month of the period, all in ONE transaction.
 *  - recordVatPayment: settlement payments (see tax-settlement.ts for the design).
 *  - createVatAmendment: voluntary disclosure as a new linked return that settles
 *    only the difference against the return it amends.
 *  - getVatReturnView / overlayVatReturns: a filed return always reads back as its
 *    snapshot; if the books have moved since, `driftDetected` says so per box.
 */

import { invalidateVatDueNext } from "../reports/kpis";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Request } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { AppError } from "../errors";
import {
  accounts,
  taxFilingEvidence,
  taxFilingPayments,
  taxFilings,
  vatReturns,
  type TaxFiling,
  type VatReturn,
} from "../../shared/schema";
import { defaultChartOfAccounts } from "../defaultChartOfAccounts";
import { lockPeriodInTx } from "./month-end.service";
import { acquirePeriodLockExclusive, assertMonthOpenInTx } from "./posting-lock";
import { ledgerVatBalances, planVatClearing } from "./vat-clearing.service";
import { ensureLegacyVatFilings } from "./vat-legacy-filings.service";
import { removeStoredFile } from "./document-upload.service";
import { assertVatPeriodEnded } from "./vat-period-status.service";
import { computeVatReturnForPeriod } from "./vat-return-compute.service";
import { recordAudit } from "./audit.service";
import {
  assessDraftFigures,
  buildVatSnapshot,
  diffBoxes,
  fromFils,
  hasRecordedManualEdits,
  manualEditReasonProblem,
  manualSettlementDelta,
  monthEndsInRange,
  snapshotHash,
  toFils,
  validateFilingInput,
  ymdOf,
  type AcceptFigures,
  type BoxDifference,
  type ManualEdits,
  type VatSnapshot,
} from "./tax-filing-core";
import { settlementFigures, vatSettlementFromDifference } from "./tax-settlement";
import {
  assertFilingPermission,
  buildFilingViewBase,
  buildSettlementView,
  evidenceRow,
  findAccountByCode,
  getFilingByReturn,
  missingAccountError,
  postSettlementJournal,
  recordFilingPayment,
  storeEvidenceFile,
  type AccountRef,
  type EvidenceUploadInput,
  type FilingActor,
  type PaymentInput,
} from "./tax-filing.service";

type Tx = any;

export const VAT_JOURNAL_SOURCE_FILING = "vat_filing";
export const VAT_JOURNAL_SOURCE_PAYMENT = "vat_payment";

async function loadVatReturn(returnId: string): Promise<VatReturn> {
  const ret = await storage.getVatReturn(returnId);
  if (!ret) throw new AppError({ message: "VAT return not found", statusCode: 404, code: "VAT_RETURN_NOT_FOUND" });
  return ret;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

/** FTA VAT Control Account (2025). Older charts may lack it: create it from the default template. */
async function resolveVatControl(tx: Tx, companyId: string): Promise<AccountRef> {
  const existing = await findAccountByCode(tx, companyId, "2025", ["liability"]);
  if (existing) return existing;
  const template = defaultChartOfAccounts.find((a) => a.code === "2025");
  if (!template) throw missingAccountError("FTA VAT Control Account", "2025", "liability");
  const [created] = await tx
    .insert(accounts)
    .values({
      companyId,
      code: template.code,
      nameEn: template.nameEn,
      nameAr: template.nameAr,
      description: template.description,
      type: template.type,
      subType: template.subType,
      isVatAccount: template.isVatAccount,
      vatType: template.vatType,
      isSystemAccount: template.isSystemAccount,
      isActive: true,
      isArchived: false,
    })
    .returning({ id: accounts.id, code: accounts.code, nameEn: accounts.nameEn });
  return created;
}

// ─── Chain helpers (original + amendments) ───────────────────────────────────

/** Every return of a period: the original and its amendments, oldest first. */
async function chainOf(ret: VatReturn): Promise<VatReturn[]> {
  const rootId = ret.amendsReturnId ?? ret.id;
  const rows = await db
    .select()
    .from(vatReturns)
    .where(sql`${vatReturns.id} = ${rootId} OR ${vatReturns.amendsReturnId} = ${rootId}`)
    .orderBy(asc(vatReturns.createdAt));
  return rows;
}

async function filingsByReturnIds(ids: string[]): Promise<Map<string, TaxFiling>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(taxFilings)
    .where(and(eq(taxFilings.kind, "vat"), inArray(taxFilings.returnId, ids)));
  return new Map(rows.map((f: TaxFiling) => [f.returnId, f]));
}

/** The most recent filed return of the chain other than `ret` (what an amendment is measured against). */
async function baseFilingFor(ret: VatReturn): Promise<{ base: VatReturn; filing: TaxFiling } | null> {
  const chain = (await chainOf(ret)).filter((r) => r.id !== ret.id);
  const filings = await filingsByReturnIds(chain.map((r) => r.id));
  const filed = chain
    .filter((r) => filings.has(r.id))
    .sort((a, b) => +new Date(filings.get(b.id)!.createdAt) - +new Date(filings.get(a.id)!.createdAt));
  const base = filed[0];
  return base ? { base, filing: filings.get(base.id)! } : null;
}

// ─── Record filing ───────────────────────────────────────────────────────────

/** What was already cleared from the ledger by the return this one amends (cumulative). */
interface ClearedSoFar {
  ledgerOutput: number;
  ledgerInput: number;
  expectedIrrecoverable: number;
  manualOutput: number;
  manualInput: number;
}

/** Stored on every new filing snapshot so an amendment can clear only the difference. */
type ClearingRecord = ClearedSoFar & { irrecoverable: number; rounding: number; manualAdjustment: number };

function clearedByBase(snap: VatSnapshot & { clearing?: ClearedSoFar; legacy?: boolean }): ClearedSoFar {
  if (snap.clearing) return snap.clearing;
  // A legacy filing was settled outside this system: measure against the figures it declared.
  return {
    ledgerOutput: snap.boxes.box12TotalDueTax ?? 0,
    ledgerInput: snap.boxes.box13RecoverableTax ?? 0,
    expectedIrrecoverable: 0,
    manualOutput: 0,
    manualInput: 0,
  };
}

export interface VatFilingResult {
  filing: TaxFiling;
  /** True when the stored draft was replaced by figures recomputed from the books at filing. */
  recomputedAtFiling: boolean;
  /** Per box: stored draft (`filed`) vs the books (`current`). Empty when they agreed. */
  differences: BoxDifference[];
  clearing: { irrecoverableVat: number; rounding: number; manualAdjustment: number };
}

async function recordVatFilingInner(args: {
  user: FilingActor;
  returnId: string;
  input: {
    ftaReferenceNumber?: unknown;
    filedAt?: unknown;
    notes?: unknown;
    evidence?: EvidenceUploadInput | null;
    acceptFigures?: AcceptFigures | null;
  };
  req?: Request;
}): Promise<VatFilingResult> {
  const ret = await loadVatReturn(args.returnId);
  const { companyId } = ret;
  await assertFilingPermission(args.user, companyId, "write");

  if (ret.status === "filed" || (await getFilingByReturn("vat", ret.id))) {
    throw new AppError({ message: "This VAT return is already recorded as filed.", statusCode: 409, code: "VAT_RETURN_ALREADY_FILED" });
  }
  assertVatPeriodEnded(ret.periodStart as any, ret.periodEnd as any);

  const periodStartYmd = ymdOf(ret.periodStart);
  const periodEndYmd = ymdOf(ret.periodEnd);
  const checked = validateFilingInput({
    referenceNumber: args.input.ftaReferenceNumber,
    filedAt: args.input.filedAt,
    periodEnd: periodEndYmd,
  });
  if (!checked.ok) {
    throw new AppError({ message: checked.message, statusCode: checked.status, code: checked.code });
  }
  // The clearing journal is dated on the filing day. If that day's month was locked meanwhile (month-end close), the
  // filing flow still posts it: it is the VAT filing journal, allowed into the locked month only here (PostingBypass
  // "vat_filing") and labelled so in its memo. Choice made: the journal keeps the real filing date (no re-dating) and the
  // snapshot of the filed figures is untouched. Ordinary postings into that month stay refused.

  const notes = typeof args.input.notes === "string" && args.input.notes.trim() ? args.input.notes.trim().slice(0, 2000) : null;

  const base = ret.isAmendment ? await baseFilingFor(ret) : null;
  if (ret.isAmendment && !base) {
    throw new AppError({ message: "The return this amends has not been recorded as filed.", statusCode: 409, code: "AMENDMENT_BASE_NOT_FILED" });
  }

  const stored = args.input.evidence?.fileData
    ? await storeEvidenceFile(companyId, args.user.id, args.input.evidence)
    : null;

  const lockedMonths = monthEndsInRange(periodStartYmd, periodEndYmd);

  try {
    const outcome = await db.transaction(async (tx: Tx) => {
      // FIRST, before any other work: no posting can be in flight into these months while the
      // return is recomputed, cleared and locked; later postings find them locked (posting-lock.ts).
      // Everything below runs on this one connection: postings queue behind this lock, each holding
      // a pooled connection, so waiting for a second connection here could starve the pool.
      await acquirePeriodLockExclusive(tx, companyId, [...lockedMonths, checked.filedAt]);

      // Serialise on the return row and re-check inside the transaction.
      const locked = await tx.execute(sql`SELECT status FROM vat_returns WHERE id = ${ret.id} FOR UPDATE`);
      const lockedRow = ((locked as any).rows ?? locked)[0];
      if (!lockedRow || lockedRow.status === "filed") {
        throw new AppError({ message: "This VAT return is already recorded as filed.", statusCode: 409, code: "VAT_RETURN_ALREADY_FILED" });
      }

      const [stale] = await tx.select().from(vatReturns).where(eq(vatReturns.id, ret.id));

      // Recompute the return from the books as they are NOW, and compare with the draft.
      const { returnValues, metadata } = await computeVatReturnForPeriod({
        companyId,
        userId: args.user.id,
        periodStart: periodStartYmd,
        periodEnd: periodEndYmd,
        executor: tx,
      });
      const storedSnap = buildVatSnapshot(stale as unknown as Record<string, unknown>);
      const recomputedSnap = buildVatSnapshot(returnValues as unknown as Record<string, unknown>);
      const manualEdits = ((stale as any).manualEdits ?? null) as ManualEdits | null;
      const assessment = assessDraftFigures({
        stored: storedSnap.boxes,
        recomputed: recomputedSnap.boxes,
        hasManualEdits: hasRecordedManualEdits(manualEdits, stale.adjustmentAmount),
        acceptFigures: args.input.acceptFigures ?? null,
      });
      if (assessment.action === "refuse") {
        throw new AppError({
          message:
            "The books have changed since this draft was generated, and the draft has figures that were entered by hand. " +
            "Regenerate the return, or choose which figures to file: the stored draft or the figures recomputed from the books.",
          statusCode: 409,
          code: assessment.code,
          details: {
            differences: assessment.differences,
            stored: storedSnap.boxes,
            recomputed: recomputedSnap.boxes,
            choices: ["stored", "recomputed"],
          },
        });
      }

      const useRecomputed = assessment.action === "use_recomputed";
      if (useRecomputed) {
        // The draft's figures become the books' figures (hand edits, if any, were explicitly given up).
        const boxValues: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(returnValues as Record<string, unknown>)) {
          if (/^box\d/.test(key)) boxValues[key] = value;
        }
        await tx
          .update(vatReturns)
          .set({ ...boxValues, manualEdits: null, vatAdjustments: (returnValues as any).vatAdjustments ?? [], updatedAt: new Date() } as any)
          .where(eq(vatReturns.id, ret.id));
      }
      const [fresh] = await tx.select().from(vatReturns).where(eq(vatReturns.id, ret.id));
      // Filing on hand-edited figures needs the written reason of EVERY edit (recorded when it was made).
      if (!useRecomputed) {
        const noReason = manualEditReasonProblem(manualEdits, {
          adjustmentAmount: fresh.adjustmentAmount,
          adjustmentReason: fresh.adjustmentReason,
        });
        if (noReason) {
          throw new AppError({
            message:
              "The draft has figures that were changed by hand without a written reason. Add a reason for each edit (at least 10 characters) before filing, or file the figures computed from the books.",
            statusCode: 422,
            code: "MANUAL_EDIT_REASON_REQUIRED",
            details: { boxes: noReason.boxes },
          });
        }
      }
      const snapshotBase = buildVatSnapshot(fresh as unknown as Record<string, unknown>);

      let figures: ReturnType<typeof settlementFigures>;
      let snapshot: Record<string, unknown> = snapshotBase as unknown as Record<string, unknown>;
      let baseFilingId: string | null = null;
      let baseCleared: ClearedSoFar | null = null;
      if (base) {
        const baseSnap = base.filing.snapshot as VatSnapshot;
        figures = vatSettlementFromDifference(baseSnap.boxes, snapshotBase.boxes);
        baseFilingId = base.filing.id;
        baseCleared = clearedByBase(baseSnap as any);
        snapshot = {
          ...snapshotBase,
          amendment: {
            baseReturnId: base.base.id,
            baseFilingId: base.filing.id,
            baseSnapshotHash: base.filing.snapshotHash,
            differences: diffBoxes(baseSnap.boxes, snapshotBase.boxes),
          },
        };
      } else {
        figures = settlementFigures(snapshotBase.boxes);
      }
      if (!figures.ok) {
        throw new AppError({ message: figures.message, statusCode: 422, code: figures.code });
      }

      // The clearing journal is driven by the LEDGER, so the VAT accounts end at exactly zero
      // (design: tax-settlement.ts header). Cumulative figures for this return; an amendment
      // clears only what the return it amends had not already cleared.
      const ledger = await ledgerVatBalances(tx, companyId, periodStartYmd, periodEndYmd);
      const manual = useRecomputed ? { outputVat: 0, inputVat: 0 } : manualSettlementDelta(manualEdits);
      const cumulative: ClearedSoFar = {
        ledgerOutput: ledger.outputVat,
        ledgerInput: ledger.inputVat,
        expectedIrrecoverable: Number(metadata.expectedIrrecoverableInputVat ?? 0),
        manualOutput: manual.outputVat,
        manualInput: manual.inputVat,
      };
      const delta = (now: number, before: number) => fromFils(toFils(now) - toFils(before));
      const step = baseCleared
        ? {
            ledgerOutput: delta(cumulative.ledgerOutput, baseCleared.ledgerOutput),
            ledgerInput: delta(cumulative.ledgerInput, baseCleared.ledgerInput),
            expectedIrrecoverable: delta(cumulative.expectedIrrecoverable, baseCleared.expectedIrrecoverable),
            manualOutput: delta(cumulative.manualOutput, baseCleared.manualOutput),
            manualInput: delta(cumulative.manualInput, baseCleared.manualInput),
          }
        : cumulative;

      const control = await resolveVatControl(tx, companyId);
      const plan = await planVatClearing({
        tx,
        companyId,
        ledger: { outputVat: step.ledgerOutput, inputVat: step.ledgerInput },
        figures: {
          outputVat: figures.outputVat,
          inputVat: figures.inputVat,
          net: figures.net,
          expectedIrrecoverable: step.expectedIrrecoverable,
          manual: { outputVat: step.manualOutput, inputVat: step.manualInput, reason: fresh.adjustmentReason ?? null },
        },
        controlId: control.id,
        label: `${periodStartYmd} to ${periodEndYmd}${ret.isAmendment ? " (amendment)" : ""}`,
      });
      const clearing: ClearingRecord = {
        ...cumulative,
        irrecoverable: plan.irrecoverable,
        rounding: plan.rounding,
        manualAdjustment: plan.manualAdjustment,
      };
      snapshot = {
        ...snapshot,
        clearing,
        // the manual VAT journals behind the adjustment columns, as filed
        vatAdjustments: (fresh as any).vatAdjustments ?? [],
        recompute: { action: assessment.action, differences: assessment.differences },
      };

      let filingMonthLocked = false;
      try {
        await assertMonthOpenInTx(tx, companyId, checked.filedAt);
      } catch (err) {
        if ((err as { statusCode?: number })?.statusCode !== 403 && !/locked period/i.test(String((err as Error)?.message ?? ""))) throw err;
        filingMonthLocked = true;
      }
      const clearingEntryId = await postSettlementJournal(tx, {
        companyId,
        ymd: checked.filedAt,
        memo:
          `VAT ${ret.isAmendment ? "amendment " : ""}return ${periodStartYmd} to ${periodEndYmd} filed - FTA ref ${checked.referenceNumber}` +
          (filingMonthLocked ? " (VAT filing journal posted into a locked month by the filing flow)" : ""),
        source: VAT_JOURNAL_SOURCE_FILING,
        sourceId: ret.id,
        userId: args.user.id,
        lines: plan.lines,
        allowLockedPeriod: filingMonthLocked ? { reason: "vat_filing", returnId: ret.id } : undefined,
      });

      const [row] = await tx
        .insert(taxFilings)
        .values({
          companyId,
          kind: "vat",
          returnId: ret.id,
          referenceNumber: checked.referenceNumber,
          filedAt: checked.filedAt,
          notes,
          snapshot,
          snapshotHash: snapshotHash(snapshot),
          baseFilingId,
          settlementOutput: figures.outputVat,
          settlementInput: figures.inputVat,
          settlementNet: figures.net,
          clearingEntryId,
          filedBy: args.user.id,
        })
        .returning();

      await tx
        .update(vatReturns)
        .set({
          status: "filed",
          ftaReferenceNumber: checked.referenceNumber,
          notes: notes ?? fresh.notes,
          submittedBy: args.user.id,
          submittedAt: fresh.submittedAt ?? new Date(),
          paymentStatus: figures.net === 0 ? "paid" : "unpaid",
          updatedAt: new Date(),
        })
        .where(eq(vatReturns.id, ret.id));

      // Lock every month of the period; if this fails the filing fails.
      for (const monthEnd of lockedMonths) {
        await lockPeriodInTx(tx, companyId, monthEnd, args.user.id);
      }

      if (stored) {
        await tx.insert(taxFilingEvidence).values(evidenceRow(companyId, row.id, args.user.id, stored));
      }
      return { filing: row as TaxFiling, assessment, plan };
    });

    const { filing, assessment, plan } = outcome;
    await recordAudit({
      userId: args.user.id,
      companyId,
      action: "tax_filing.file",
      entityType: "vat_return",
      entityId: ret.id,
      after: {
        filingId: filing.id,
        referenceNumber: filing.referenceNumber,
        filedAt: filing.filedAt,
        snapshotHash: filing.snapshotHash,
        settlementNet: filing.settlementNet,
        lockedMonths,
        isAmendment: ret.isAmendment,
        figures: assessment.action,
        recomputedDifferences: assessment.differences.length,
        irrecoverableVat: plan.irrecoverable,
        rounding: plan.rounding,
      },
      req: args.req,
    });
    return {
      filing,
      recomputedAtFiling: assessment.action === "use_recomputed" && assessment.differences.length > 0,
      differences: assessment.differences,
      clearing: { irrecoverableVat: plan.irrecoverable, rounding: plan.rounding, manualAdjustment: plan.manualAdjustment },
    };
  } catch (err) {
    if (stored) await removeStoredFile(stored.key);
    throw err;
  }
}

// ─── Payment ─────────────────────────────────────────────────────────────────

export async function recordVatPayment(args: {
  user: FilingActor;
  returnId: string;
  input: PaymentInput;
  req?: Request;
}) {
  const ret = await loadVatReturn(args.returnId);
  const filing = await getFilingByReturn("vat", ret.id);
  if (!filing) {
    throw new AppError({ message: "Record the return as filed before recording a payment.", statusCode: 409, code: "VAT_RETURN_NOT_FILED" });
  }
  return recordFilingPayment({
    user: args.user,
    companyId: ret.companyId,
    filing,
    input: args.input,
    req: args.req,
    control: {
      resolve: resolveVatControl,
      journalSource: VAT_JOURNAL_SOURCE_PAYMENT,
      label: "VAT",
    },
    // Mirror the legacy payment columns so older screens and reports stay right.
    onSettled: async (tx, view, paidAtYmd) => {
      await tx
        .update(vatReturns)
        .set({
          paymentStatus: view.status === "paid" ? "paid" : "partial",
          paymentAmount: view.paid,
          paymentDate: new Date(`${paidAtYmd}T00:00:00Z`),
          updatedAt: new Date(),
        })
        .where(eq(vatReturns.id, ret.id));
    },
  });
}

// ─── Amendment ───────────────────────────────────────────────────────────────

export async function createVatAmendment(args: { user: FilingActor; returnId: string; req?: Request }) {
  const ret = await loadVatReturn(args.returnId);
  await assertFilingPermission(args.user, ret.companyId, "write");
  await ensureLegacyVatFilings(ret.companyId);

  const chain = await chainOf(ret);
  const filings = await filingsByReturnIds(chain.map((r) => r.id));
  const open = chain.find((r) => r.isAmendment && !filings.has(r.id));
  if (open) {
    throw new AppError({
      message: "An amendment for this period is already in progress. File or finish it first.",
      statusCode: 409,
      code: "AMENDMENT_IN_PROGRESS",
      details: { amendmentId: open.id },
    });
  }
  const filedChain = chain.filter((r) => filings.has(r.id));
  const latest = filedChain.sort((a, b) => +new Date(filings.get(b.id)!.createdAt) - +new Date(filings.get(a.id)!.createdAt))[0];
  if (!latest) {
    throw new AppError({ message: "Only a return recorded as filed can be amended.", statusCode: 409, code: "VAT_RETURN_NOT_FILED" });
  }
  const baseFiling = filings.get(latest.id)!;
  const baseSnap = baseFiling.snapshot as VatSnapshot;

  const { returnValues } = await computeVatReturnForPeriod({
    companyId: ret.companyId,
    userId: args.user.id,
    periodStart: ymdOf(latest.periodStart),
    periodEnd: ymdOf(latest.periodEnd),
  });
  const current = buildVatSnapshot(returnValues as unknown as Record<string, unknown>);
  const differences = diffBoxes(baseSnap.boxes, current.boxes);
  if (differences.length === 0) {
    throw new AppError({
      message: "The books still produce exactly the figures that were filed: there is nothing to amend.",
      statusCode: 422,
      code: "NO_DIFFERENCE",
    });
  }

  const amendment = await storage.createVatReturn({
    ...(returnValues as any),
    status: "draft",
    isAmendment: true,
    amendsReturnId: ret.amendsReturnId ?? ret.id,
    notes: `Amendment (voluntary disclosure) of the return filed under FTA reference ${baseFiling.referenceNumber}`,
  });

  await recordAudit({
    userId: args.user.id,
    companyId: ret.companyId,
    action: "tax_filing.amend",
    entityType: "vat_return",
    entityId: amendment.id,
    after: { amends: latest.id, differences: differences.length },
    req: args.req,
  });
  return { amendment, differences, baseReturnId: latest.id, baseFilingId: baseFiling.id };
}

// ─── Reads: overlay + view ───────────────────────────────────────────────────

/** A filed return reads as its snapshot, whatever the row says now. */
export function overlaySnapshot<T extends Record<string, unknown>>(row: T, filing: TaxFiling | undefined | null): T {
  if (!filing) return row;
  const snap = filing.snapshot as VatSnapshot;
  return { ...row, ...snap.boxes };
}

/** Light overlay for lists: snapshot figures + a filing summary, no live drift computation. */
export async function overlayVatReturns(rows: VatReturn[]) {
  for (const companyId of new Set(rows.map((r) => r.companyId))) await ensureLegacyVatFilings(companyId);
  const ids = rows.map((r) => r.id);
  const filings = await filingsByReturnIds(ids);
  const filingIds = [...filings.values()].map((f) => f.id);
  const paymentSums = new Map<string, number[]>();
  const evidenceCounts = new Map<string, number>();
  if (filingIds.length > 0) {
    const pays = await db
      .select({ filingId: taxFilingPayments.filingId, amount: taxFilingPayments.amount })
      .from(taxFilingPayments)
      .where(inArray(taxFilingPayments.filingId, filingIds));
    for (const p of pays) paymentSums.set(p.filingId, [...(paymentSums.get(p.filingId) ?? []), p.amount]);
    const ev = await db
      .select({ filingId: taxFilingEvidence.filingId })
      .from(taxFilingEvidence)
      .where(and(inArray(taxFilingEvidence.filingId, filingIds), isNull(taxFilingEvidence.removedAt)));
    for (const e of ev) evidenceCounts.set(e.filingId, (evidenceCounts.get(e.filingId) ?? 0) + 1);
  }
  const amendedBy = new Map<string, string[]>();
  for (const r of rows) {
    if (r.isAmendment && r.amendsReturnId) amendedBy.set(r.amendsReturnId, [...(amendedBy.get(r.amendsReturnId) ?? []), r.id]);
  }
  return rows.map((r) => {
    const filing = filings.get(r.id);
    const overlaid = overlaySnapshot(r as unknown as Record<string, unknown>, filing);
    return {
      ...overlaid,
      amendedBy: amendedBy.get(r.id) ?? [],
      filing: filing
        ? {
            id: filing.id,
            referenceNumber: filing.referenceNumber,
            filedAt: String(filing.filedAt).slice(0, 10),
            snapshotHash: filing.snapshotHash,
            evidenceCount: evidenceCounts.get(filing.id) ?? 0,
            settlement: buildSettlementView(filing.settlementNet, paymentSums.get(filing.id) ?? []),
            // recorded with "Filed outside Muhasib": figures are zero, nothing was posted
            filedElsewhere: (filing.snapshot as { filedElsewhere?: boolean } | null)?.filedElsewhere === true,
          }
        : null,
    };
  });
}

async function lockedMonthsOf(companyId: string, periodStartYmd: string, periodEndYmd: string) {
  const months = monthEndsInRange(periodStartYmd, periodEndYmd);
  const res: any = await db.execute(sql`
    SELECT to_char(period_end, 'YYYY-MM-DD') AS period_end
    FROM month_end_close
    WHERE company_id = ${companyId} AND status = 'locked'
      AND period_end IN (${sql.join(months.map((m) => sql`${m}::date`), sql`, `)})`);
  const locked = new Set<string>(((res.rows ?? res) as Array<{ period_end: string }>).map((r) => r.period_end));
  return { months, locked: months.filter((m) => locked.has(m)) };
}

async function computeVatDrift(ret: VatReturn, userId: string, snapshot: VatSnapshot) {
  try {
    const { returnValues } = await computeVatReturnForPeriod({
      companyId: ret.companyId,
      userId,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
    });
    const live = buildVatSnapshot(returnValues as unknown as Record<string, unknown>);
    const differences = diffBoxes(snapshot.boxes, live.boxes);
    return { detected: differences.length > 0, differences, check: "ok" as const };
  } catch (err) {
    return {
      detected: false,
      differences: [] as BoxDifference[],
      check: "unavailable" as const,
      message: (err as Error).message,
    };
  }
}

/** Full read model of one VAT return for the UI and the API. */
export async function getVatReturnView(ret: VatReturn, userId: string) {
  await ensureLegacyVatFilings(ret.companyId);
  const filing = await getFilingByReturn("vat", ret.id);
  const drift = filing
    ? await computeVatDrift(ret, userId, filing.snapshot as VatSnapshot)
    : { detected: false, differences: [] as BoxDifference[], check: "not_applicable" as const };
  const base = await buildFilingViewBase(filing, drift);

  const periodStartYmd = ymdOf(ret.periodStart);
  const periodEndYmd = ymdOf(ret.periodEnd);
  const lock = await lockedMonthsOf(ret.companyId, periodStartYmd, periodEndYmd);

  const chain = await chainOf(ret);
  const chainFilings = await filingsByReturnIds(chain.map((r) => r.id));

  // Draft amendment: show what would change against the filing it amends.
  let amendmentDifferences: BoxDifference[] = [];
  let amendsFiling: TaxFiling | null = null;
  if (ret.isAmendment) {
    const baseRef = await baseFilingFor(ret);
    if (baseRef) {
      amendsFiling = baseRef.filing;
      const current = filing ? (filing.snapshot as VatSnapshot) : buildVatSnapshot(ret as unknown as Record<string, unknown>);
      amendmentDifferences = diffBoxes((baseRef.filing.snapshot as VatSnapshot).boxes, current.boxes);
    }
  }

  return {
    ...base,
    return: {
      ...overlaySnapshot(ret as unknown as Record<string, unknown>, filing),
    },
    isAmendment: ret.isAmendment,
    amendsReturnId: ret.amendsReturnId ?? null,
    amendsReference: amendsFiling?.referenceNumber ?? null,
    amendmentDifferences,
    amendedBy: (ret.isAmendment ? [] : chain.filter((r) => r.isAmendment))
      .map((r) => ({
        id: r.id,
        status: r.status,
        filed: chainFilings.has(r.id),
        referenceNumber: chainFilings.get(r.id)?.referenceNumber ?? null,
      })),
    period: {
      start: periodStartYmd,
      end: periodEndYmd,
      months: lock.months,
      lockedMonths: lock.locked,
      locked: lock.months.length > 0 && lock.locked.length === lock.months.length,
    },
  };
}

// ─── Unlock support ──────────────────────────────────────────────────────────

/** Filed VAT returns whose period covers the calendar month ending at `monthEndYmd`. */
export async function findFiledVatReturnsCoveringMonth(companyId: string, monthEndYmd: string) {
  const monthStart = `${monthEndYmd.slice(0, 8)}01`;
  const res: any = await db.execute(sql`
    SELECT r.id AS return_id, f.reference_number, to_char(f.filed_at, 'YYYY-MM-DD') AS filed_at
    FROM tax_filings f
    JOIN vat_returns r ON r.id = f.return_id
    WHERE f.company_id = ${companyId} AND f.kind = 'vat'
      AND r.period_start::date <= ${monthEndYmd}::date
      AND r.period_end::date >= ${monthStart}::date`);
  return ((res.rows ?? res) as Array<{ return_id: string; reference_number: string; filed_at: string }>).map((r) => ({
    returnId: r.return_id,
    referenceNumber: r.reference_number,
    filedAt: r.filed_at,
  }));
}

/** Filing a return moves the VAT "due next" on the dashboard: drop its cache for the company, before and after. */
export async function recordVatFiling(args: Parameters<typeof recordVatFilingInner>[0]): Promise<VatFilingResult> {
  const companyId = (await loadVatReturn(args.returnId).catch(() => null))?.companyId;
  try {
    return await recordVatFilingInner(args);
  } finally {
    if (companyId) invalidateVatDueNext(companyId);
  }
}
