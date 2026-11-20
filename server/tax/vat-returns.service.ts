/**
 * VAT 201 return lifecycle on top of the engine (W4-E): generate (aligned period, TRN, period
 * lock), readiness gate on the VAT-to-GL reconciliation, submit (never transmits to the FTA),
 * amended returns with a box-by-box diff.
 *
 *   draft -> ready -> submitted -> filed        (amended: superseded by a newer return)
 */
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { DomainError } from "../errors";
import { vatReturns, type VatReturn } from "../../shared/schema";
import { validateUaeTrn } from "../../shared/receipt-ocr-parser";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { recordAudit } from "../services/audit.service";
import { defineMachine, withLedgerTx, type LedgerTx } from "../ledger";
import { todayIso } from "../ledger/normalize";
import { lockVatReturns } from "../ledger/vat-lock";
import { getVatReturnSettlement } from "./vat-settlement.service";
import { computeVat201, loadVatCompany, type VatComputation } from "./vat-engine";
import { assertAlignedPeriod } from "./vat-periods";
import {
  DERIVED_BOX_KEYS,
  EMIRATE_BOX_PREFIX,
  VAT201_BOX_KEYS,
  filsToAed,
  type Vat201Aed,
  type Vat201Key,
} from "./vat-boxes";
import { EMIRATES } from "../../shared/validators/primitives";
import type { Request } from "express";

export const VAT_RETURN_STATES = [
  "draft",
  "pending_review",
  "ready",
  "submitted",
  "filed",
  "amended",
] as const;
export const vatReturnMachine = defineMachine<(typeof VAT_RETURN_STATES)[number]>({
  states: VAT_RETURN_STATES,
  transitions: {
    draft: ["ready", "submitted", "filed"],
    pending_review: ["ready", "submitted", "filed"],
    ready: ["draft", "submitted", "filed"],
    submitted: ["filed", "amended"],
    filed: ["amended"],
  },
});

/** Assert the company TRN is present and well formed (15 digits, starts with 100). */
export function assertCompanyTrn(trn: string | null | undefined): string {
  if (!trn) {
    throw new DomainError(
      "NO_TRN",
      400,
      undefined,
      "Company must have a TRN/VAT number to generate VAT returns. Please update your company profile."
    );
  }
  const v = validateUaeTrn(trn);
  if (!v.valid) {
    throw new DomainError(
      "INVALID_TRN",
      422,
      { issue: v.issue },
      `Company TRN is invalid: ${v.issue}`
    );
  }
  return v.trn!;
}

/** vat_returns columns (AED numbers) from engine boxes, plus legacy mirror columns. */
export function vatReturnColumns(b: Vat201Aed): Record<string, number> {
  const cols: Record<string, number> = {};
  for (const k of VAT201_BOX_KEYS) cols[k] = b[k];
  const std = EMIRATES.reduce((s, e) => s + b[`${EMIRATE_BOX_PREFIX[e]}Amount` as Vat201Key], 0);
  cols.box1SalesStandard = Math.round(std * 100) / 100;
  cols.box2SalesOtherEmirates = 0;
  cols.box3SalesTaxExempt = b.box4ZeroRatedAmount;
  cols.box4SalesExempt = b.box5ExemptAmount;
  cols.box5TotalOutputTax = b.box12TotalDueTax;
  cols.box6ExpensesStandard = b.box9ExpensesAmount;
  cols.box7ExpensesTouristRefund = b.box2TouristRefundVat;
  cols.box8TotalInputTax = b.box13RecoverableTax;
  cols.box9NetTax = b.box14PayableTax;
  return cols;
}

/** Box-by-box difference new - old (AED), non-zero keys only. */
export function diffReturns(
  previous: Partial<Record<string, unknown>>,
  next: Vat201Aed
): Array<{ box: Vat201Key; previous: number; amended: number; difference: number }> {
  const out: Array<{ box: Vat201Key; previous: number; amended: number; difference: number }> = [];
  for (const k of VAT201_BOX_KEYS) {
    const p = Math.round(Number(previous[k] ?? 0) * 100);
    const n = Math.round(next[k] * 100);
    if (p !== n)
      out.push({
        box: k,
        previous: filsToAed(p),
        amended: filsToAed(n),
        difference: filsToAed(n - p),
      });
  }
  return out;
}

export function reconciliationSnapshot(c: VatComputation) {
  return {
    engineVersion: c.engineVersion,
    computedAt: new Date().toISOString(),
    ...c.reconciliation,
    issues: c.issues,
    excluded: {
      outOfScopeFils: c.excluded.outOfScopeFils,
      outOfScopeDocuments: c.excluded.outOfScope.length,
      intraGroupDocuments: c.excluded.intraGroup.length,
    },
  };
}

function toStartTs(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function toEndTs(iso: string): Date {
  return new Date(`${iso}T23:59:59.999Z`);
}

export async function findReturnForPeriod(
  tx: LedgerTx,
  companyId: string,
  from: string,
  to: string
): Promise<VatReturn | undefined> {
  const [row] = await tx
    .select()
    .from(vatReturns)
    .where(
      and(
        eq(vatReturns.companyId, companyId),
        sql`${vatReturns.periodStart}::date = ${from}::date`,
        sql`${vatReturns.periodEnd}::date = ${to}::date`,
        ne(vatReturns.status, "amended")
      )
    )
    .orderBy(sql`(${vatReturns.status} IN ('submitted', 'filed')) DESC`, desc(vatReturns.createdAt))
    .limit(1);
  return row;
}

export async function loadVatReturnForUpdate(
  tx: LedgerTx,
  companyId: string,
  id: string
): Promise<VatReturn> {
  // Acquire the same lock before taking any return row lock, including on an amendment chain.
  await lockVatReturns(tx, companyId);
  const [row] = await tx
    .select()
    .from(vatReturns)
    .where(and(eq(vatReturns.companyId, companyId), eq(vatReturns.id, id)))
    .for("update");
  if (!row) throw new DomainError("VAT_RETURN_NOT_FOUND", 404);
  return row;
}

const dateOf = (value: Date) => value.toISOString().slice(0, 10);

export function assertReturnIsEditable(existing: VatReturn | undefined): void {
  if (!existing || ["draft", "pending_review", "ready"].includes(existing.status)) return;
  throw new DomainError(
    "VAT_RETURN_EXISTS",
    409,
    { vatReturnId: existing.id, status: existing.status },
    `A ${existing.status} VAT return already exists for this period. File an amended return instead.`
  );
}

export interface GenerateResult {
  vatReturn: VatReturn;
  computation: VatComputation;
}

/** Validate + compute without persisting (shared by generate and amend). */
export async function computeForReturn(
  input: {
    companyId: string;
    periodStart: unknown;
    periodEnd: unknown;
  },
  tx?: LedgerTx
): Promise<VatComputation> {
  const company = await loadVatCompany(input.companyId, tx);
  assertCompanyTrn(company.trn);
  const period = assertAlignedPeriod({
    from: input.periodStart,
    to: input.periodEnd,
    frequency: company.frequency,
    startMonth: company.startMonth,
  });
  const today = new Date().toISOString().slice(0, 10);
  if (period.to > today) {
    // X5 (J1 D7): the running period can be previewed (GET /vat/compute); the return itself
    // is generated only once the period has ended.
    throw new DomainError(
      "PERIOD_IN_FUTURE",
      422,
      { periodEnd: period.to, previewAvailable: true },
      `This VAT period has not ended yet (it ends ${period.to}). Preview the figures now; generate the return after the period ends.`
    );
  }
  return computeVat201({ companyId: input.companyId, from: period.from, to: period.to }, tx);
}

export async function generateVatReturn(input: {
  companyId: string;
  userId: string;
  periodStart: unknown;
  periodEnd: unknown;
}): Promise<GenerateResult> {
  return withLedgerTx(async (tx) => {
    await lockVatReturns(tx, input.companyId);
    const computation = await computeForReturn(input, tx);
    const { from, to, dueDate } = computation.period;
    await assertPeriodNotLocked(input.companyId, to, tx);
    const existing = await findReturnForPeriod(tx, input.companyId, from, to);
    assertReturnIsEditable(existing);
    const data = {
      companyId: input.companyId,
      periodStart: toStartTs(from),
      periodEnd: toEndTs(to),
      dueDate: toStartTs(dueDate),
      status: "draft",
      vatStagger: computation.company.frequency,
      ...vatReturnColumns(computation.boxes),
      reconciliationSnapshot: reconciliationSnapshot(computation),
      engineVersion: computation.engineVersion,
      vatGroupId: computation.group?.groupId ?? null,
      partialExemptionRatio: computation.company.exemptSupplyRatio,
      readyAt: null,
      readyBy: null,
      reconciliationOverrideReason: null,
      reconciliationOverrideBy: null,
      reconciliationOverrideAt: null,
      createdBy: input.userId,
    };
    // A1 (C1): an amendment draft (voluntary disclosure) is regenerated after the late documents
    // are posted into the re-opened period; refresh its box-by-box diff against the filed return.
    if (existing?.amendsReturnId) {
      const [original] = await tx
        .select()
        .from(vatReturns)
        .where(eq(vatReturns.id, existing.amendsReturnId));
      if (original) {
        const prior = (existing.amendmentDiff ?? {}) as { reason?: string };
        Object.assign(data, {
          amendmentDiff: {
            reason: prior.reason ?? null,
            boxes: diffReturns(original as unknown as Record<string, unknown>, computation.boxes),
            netChange: filsToAed(
              computation.boxesFils.box14PayableTax -
                Math.round(Number(original.box14PayableTax) * 100)
            ),
          },
        });
      }
    }
    const [vatReturn] = existing
      ? await tx
          .update(vatReturns)
          .set({ ...data, updatedAt: new Date() })
          .where(eq(vatReturns.id, existing.id))
          .returning()
      : await tx.insert(vatReturns).values(data).returning();
    return { vatReturn, computation };
  });
}

/**
 * Reconcile after posting the apportionment in this transaction. If a late posting changed
 * an engine-generated return, the user must regenerate the figures before recording a filing.
 */
async function prepareReturnForFinalization(
  tx: LedgerTx,
  vatReturn: VatReturn,
  input: { userId: string; overrideReason?: string | null; req?: Request }
) {
  const from = dateOf(vatReturn.periodStart);
  const to = dateOf(vatReturn.periodEnd);
  const { postPartialExemptionForPeriod } = await import("./vat-partial-exemption.service");
  await postPartialExemptionForPeriod({
    companyId: vatReturn.companyId,
    from,
    to,
    actorId: input.userId,
    vatReturnId: vatReturn.id,
    tx,
  });
  const computation = await computeVat201(
    {
      companyId: vatReturn.companyId,
      from,
      to,
      allowIncomplete: true,
    },
    tx
  );
  if (
    vatReturn.engineVersion &&
    diffReturns(vatReturn as unknown as Record<string, unknown>, computation.boxes).length
  ) {
    throw new DomainError(
      "VAT_RETURN_STALE",
      409,
      undefined,
      "The VAT figures changed after this return was generated. Regenerate the return before filing."
    );
  }
  const snapshot = reconciliationSnapshot(computation);
  const r = computation.reconciliation;
  if (!r.hasUnexplainedDifference) return { reconciliationSnapshot: snapshot };
  const reason = input.overrideReason?.trim();
  if (!reason && vatReturn.status === "ready" && vatReturn.reconciliationOverrideReason) {
    return { reconciliationSnapshot: snapshot };
  }
  if (!reason) {
    throw new DomainError(
      "VAT_RECONCILIATION_DIFFERENCE",
      409,
      {
        unexplainedOutputVat: r.aed.unexplainedOutput,
        unexplainedInputVat: r.aed.unexplainedInput,
        byCategory: r.byCategory.filter(
          (row) => !row.explained && (row.outputDifferenceFils || row.inputDifferenceFils)
        ),
      },
      "The VAT return does not agree with the VAT control accounts in the ledger. Resolve the difference or give an override reason."
    );
  }
  await recordAudit({
    userId: input.userId,
    companyId: vatReturn.companyId,
    action: "vat_return.reconciliation_override",
    entityType: "vat_return",
    entityId: vatReturn.id,
    after: { reason, unexplained: r.aed },
    req: input.req,
    tx,
  });
  return {
    reconciliationOverrideReason: reason,
    reconciliationOverrideBy: input.userId,
    reconciliationOverrideAt: new Date(),
    reconciliationSnapshot: snapshot,
  };
}

async function assertNoOtherFinalReturn(tx: LedgerTx, vatReturn: VatReturn): Promise<void> {
  const [other] = await tx
    .select()
    .from(vatReturns)
    .where(
      and(
        eq(vatReturns.companyId, vatReturn.companyId),
        ne(vatReturns.id, vatReturn.id),
        sql`${vatReturns.status} IN ('submitted', 'filed')`,
        sql`${vatReturns.periodStart}::date <= ${dateOf(vatReturn.periodEnd)}::date`,
        sql`${vatReturns.periodEnd}::date >= ${dateOf(vatReturn.periodStart)}::date`
      )
    )
    .limit(1);
  assertReturnIsEditable(other);
}

async function transitionReturn(
  tx: LedgerTx,
  existing: VatReturn,
  values: Partial<typeof vatReturns.$inferInsert> & { status: string },
  input: { userId: string; req?: Request }
): Promise<VatReturn> {
  const [updated] = await tx
    .update(vatReturns)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(vatReturns.id, existing.id))
    .returning();
  await recordAudit({
    userId: input.userId,
    companyId: existing.companyId,
    action: `vat_return.${values.status}`,
    entityType: "vat_return",
    entityId: existing.id,
    before: { status: existing.status },
    after: {
      status: values.status,
      ...(values.ftaReferenceNumber !== undefined
        ? { ftaReferenceNumber: values.ftaReferenceNumber }
        : {}),
    },
    req: input.req,
    tx,
  });
  return updated;
}

export async function markVatReturnReady(input: {
  id: string;
  companyId: string;
  userId: string;
  overrideReason?: string | null;
  req?: Request;
}): Promise<VatReturn> {
  return withLedgerTx(async (tx) => {
    const existing = await loadVatReturnForUpdate(tx, input.companyId, input.id);
    if (existing.status === "ready") return existing;
    if (!vatReturnMachine.can(existing.status, "ready")) {
      throw new DomainError("INVALID_TRANSITION", 409, { from: existing.status, to: "ready" });
    }
    await assertNoOtherFinalReturn(tx, existing);
    const reconciliation = await prepareReturnForFinalization(tx, existing, input);
    return transitionReturn(
      tx,
      existing,
      {
        ...reconciliation,
        status: "ready",
        readyAt: new Date(),
        readyBy: input.userId,
      },
      input
    );
  });
}

function validateFilingDate(filedOn: string, reference: string | null, periodEnd: Date) {
  if (!reference) {
    throw new DomainError(
      "VALIDATION_ERROR",
      400,
      { fields: { ftaReferenceNumber: ["Enter the EmaraTax reference number"] } },
      "A filing date needs the EmaraTax reference number"
    );
  }
  if (filedOn > todayIso()) {
    throw new DomainError(
      "VAT_FILED_ON_FUTURE",
      422,
      { fields: { filedOn: ["The filing date cannot be in the future"] } },
      "The filing date cannot be in the future"
    );
  }
  const periodEndIso = dateOf(periodEnd);
  if (filedOn <= periodEndIso) {
    throw new DomainError(
      "VAT_FILED_ON_IN_PERIOD",
      422,
      { periodEnd: periodEndIso, fields: { filedOn: ["File after the tax period ends"] } },
      "A VAT return is filed after its tax period ends"
    );
  }
}

export async function submitVatReturn(input: {
  id: string;
  companyId: string;
  userId: string;
  ftaReferenceNumber?: string | null;
  filedOn?: string | null;
  notes?: string | null;
  declarantName?: string | null;
  declarantPosition?: string | null;
  overrideReason?: string | null;
  req?: Request;
}): Promise<VatReturn> {
  const reference = input.ftaReferenceNumber?.trim() || null;
  const target = reference ? "filed" : "submitted";
  const { filedOn } = input;
  return withLedgerTx(async (tx) => {
    const existing = await loadVatReturnForUpdate(tx, input.companyId, input.id);
    if (filedOn) validateFilingDate(filedOn, reference, existing.periodEnd);
    if (existing.status === target) {
      const storedDate = existing.declarationDate && dateOf(existing.declarationDate);
      if (
        target === "filed" &&
        (existing.ftaReferenceNumber !== reference || (filedOn && filedOn !== storedDate))
      ) {
        throw new DomainError(
          "VAT_FILING_CONFLICT",
          409,
          undefined,
          "A filing with a different reference or date is already recorded for this return."
        );
      }
      return existing;
    }
    if (!vatReturnMachine.can(existing.status, target)) {
      throw new DomainError("INVALID_TRANSITION", 409, { from: existing.status, to: target });
    }
    await assertNoOtherFinalReturn(tx, existing);
    await assertPeriodNotLocked(existing.companyId, existing.periodEnd, tx);
    if (filedOn && existing.status === "submitted") {
      const settlement = await getVatReturnSettlement(existing.companyId, existing.id, tx);
      if (settlement && settlement.date < filedOn) {
        throw new DomainError(
          "VAT_FILING_AFTER_SETTLEMENT",
          409,
          { paymentDate: settlement.date },
          "The filing date is after the recorded settlement. Reverse the settlement before recording this filing date."
        );
      }
    }
    const reconciliation =
      existing.status === "submitted"
        ? {}
        : await prepareReturnForFinalization(tx, existing, input);
    const declaration = filedOn ? new Date(`${filedOn}T08:00:00Z`) : null;
    return transitionReturn(
      tx,
      existing,
      {
        ...reconciliation,
        status: target,
        notes: input.notes ?? existing.notes ?? null,
        ftaReferenceNumber: reference,
        submittedBy: input.userId,
        submittedAt: declaration ?? new Date(),
        ...(declaration ? { declarationDate: declaration } : {}),
        declarantName: input.declarantName ?? existing.declarantName ?? null,
        declarantPosition: input.declarantPosition ?? existing.declarantPosition ?? null,
      },
      input
    );
  });
}

/** Amended return (voluntary disclosure basis): recompute the period, store a diff. */
export async function amendVatReturn(input: {
  id: string;
  companyId: string;
  userId: string;
  reason: string;
  req?: Request;
}): Promise<{
  vatReturn: VatReturn;
  diff: ReturnType<typeof diffReturns>;
  computation: VatComputation;
}> {
  return withLedgerTx(async (tx) => {
    const original = await loadVatReturnForUpdate(tx, input.companyId, input.id);
    if (original.status !== "submitted" && original.status !== "filed") {
      throw new DomainError(
        "VAT_RETURN_NOT_FINAL",
        409,
        { status: original.status },
        "Only a submitted or filed return can be amended; regenerate the draft instead."
      );
    }
    const from = new Date(original.periodStart).toISOString().slice(0, 10);
    const to = new Date(original.periodEnd).toISOString().slice(0, 10);
    const computation = await computeVat201({ companyId: original.companyId, from, to }, tx);
    const diff = diffReturns(original as unknown as Record<string, unknown>, computation.boxes);
    const [created] = await tx
      .insert(vatReturns)
      .values({
        companyId: original.companyId,
        periodStart: original.periodStart,
        periodEnd: original.periodEnd,
        dueDate: original.dueDate,
        status: "draft",
        vatStagger: original.vatStagger,
        ...vatReturnColumns(computation.boxes),
        amendsReturnId: original.id,
        amendmentDiff: {
          reason: input.reason,
          boxes: diff,
          netChange: filsToAed(
            computation.boxesFils.box14PayableTax -
              Math.round(Number(original.box14PayableTax) * 100)
          ),
        },
        reconciliationSnapshot: reconciliationSnapshot(computation),
        engineVersion: computation.engineVersion,
        partialExemptionRatio: computation.company.exemptSupplyRatio,
        notes: `Amendment of return ${original.id}: ${input.reason}`,
        createdBy: input.userId,
      })
      .returning();
    await tx
      .update(vatReturns)
      .set({ status: "amended", updatedAt: new Date() })
      .where(and(eq(vatReturns.id, original.id), eq(vatReturns.companyId, original.companyId)));
    await recordAudit({
      userId: input.userId,
      companyId: original.companyId,
      action: "vat_return.amend",
      entityType: "vat_return",
      entityId: created.id,
      before: { amends: original.id },
      after: { diff, reason: input.reason },
      req: input.req,
      tx,
    });
    return { vatReturn: created, diff, computation };
  });
}

export async function listReturns(companyId: string) {
  return db
    .select()
    .from(vatReturns)
    .where(eq(vatReturns.companyId, companyId))
    .orderBy(desc(vatReturns.periodEnd), desc(vatReturns.createdAt));
}

export { DERIVED_BOX_KEYS };
