/**
 * VAT 201 return lifecycle on top of the engine (W4-E): generate (aligned period, TRN, period
 * lock), readiness gate on the VAT-to-GL reconciliation, submit (never transmits to the FTA),
 * amended returns with a box-by-box diff.
 *
 *   draft -> ready -> submitted -> filed        (amended: superseded by a newer return)
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { DomainError } from "../errors";
import { storage } from "../storage";
import { vatReturns, type VatReturn } from "../../shared/schema";
import { validateUaeTrn } from "../../shared/receipt-ocr-parser";
import { assertPeriodNotLocked } from "../services/period-lock.service";
import { recordAudit } from "../services/audit.service";
import { defineMachine } from "../ledger";
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
  companyId: string,
  from: string,
  to: string
): Promise<VatReturn | undefined> {
  const rows = await storage.getVatReturnsByCompanyId(companyId);
  return rows
    .filter(
      (r) =>
        new Date(r.periodStart).toISOString().slice(0, 10) === from &&
        new Date(r.periodEnd).toISOString().slice(0, 10) === to &&
        r.status !== "amended"
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

export interface GenerateResult {
  vatReturn: VatReturn;
  computation: VatComputation;
}

/** Validate + compute without persisting (shared by generate and amend). */
export async function computeForReturn(input: {
  companyId: string;
  periodStart: unknown;
  periodEnd: unknown;
}): Promise<VatComputation> {
  const company = await loadVatCompany(input.companyId);
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
  return computeVat201({ companyId: input.companyId, from: period.from, to: period.to });
}

export async function generateVatReturn(input: {
  companyId: string;
  userId: string;
  periodStart: unknown;
  periodEnd: unknown;
}): Promise<GenerateResult> {
  const computation = await computeForReturn(input);
  const { from, to, dueDate } = computation.period;
  await assertPeriodNotLocked(input.companyId, to);
  const existing = await findReturnForPeriod(input.companyId, from, to);
  if (
    existing &&
    existing.status !== "draft" &&
    existing.status !== "pending_review" &&
    existing.status !== "ready"
  ) {
    throw new DomainError(
      "VAT_RETURN_EXISTS",
      409,
      { vatReturnId: existing.id, status: existing.status },
      `A ${existing.status} VAT return already exists for this period. File an amended return instead.`
    );
  }
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
  const vatReturn = existing
    ? await storage.updateVatReturn(existing.id, data as never)
    : await storage.createVatReturn(data as never);
  return { vatReturn, computation };
}

/**
 * Readiness gate: an unexplained VAT-to-GL difference blocks "ready to submit" unless the
 * caller gives an override reason, which is stored and audited.
 */
export async function assertReconciledOrOverridden(input: {
  vatReturn: VatReturn;
  userId: string;
  overrideReason?: string | null;
  req?: Request;
}): Promise<{ overridden: boolean; computation: VatComputation }> {
  const from = new Date(input.vatReturn.periodStart).toISOString().slice(0, 10);
  const to = new Date(input.vatReturn.periodEnd).toISOString().slice(0, 10);
  const computation = await computeVat201({
    companyId: input.vatReturn.companyId,
    from,
    to,
    allowIncomplete: true,
  });
  const r = computation.reconciliation;
  if (!r.hasUnexplainedDifference) return { overridden: false, computation };
  const reason = input.overrideReason?.trim();
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
  await storage.updateVatReturn(input.vatReturn.id, {
    reconciliationOverrideReason: reason,
    reconciliationOverrideBy: input.userId,
    reconciliationOverrideAt: new Date(),
    reconciliationSnapshot: reconciliationSnapshot(computation),
  } as never);
  await recordAudit({
    userId: input.userId,
    companyId: input.vatReturn.companyId,
    action: "vat_return.reconciliation_override",
    entityType: "vat_return",
    entityId: input.vatReturn.id,
    after: { reason, unexplained: r.aed },
    req: input.req,
  });
  return { overridden: true, computation };
}

export async function markVatReturnReady(input: {
  id: string;
  userId: string;
  overrideReason?: string | null;
  req?: Request;
}): Promise<VatReturn> {
  const existing = await storage.getVatReturn(input.id);
  if (!existing) throw new DomainError("VAT_RETURN_NOT_FOUND", 404);
  if (!vatReturnMachine.can(existing.status, "ready")) {
    throw new DomainError("INVALID_TRANSITION", 409, { from: existing.status, to: "ready" });
  }
  await assertReconciledOrOverridden({ vatReturn: existing, ...input });
  const updated = await storage.updateVatReturn(existing.id, {
    status: "ready",
    readyAt: new Date(),
    readyBy: input.userId,
  } as never);
  await recordAudit({
    userId: input.userId,
    companyId: existing.companyId,
    action: "vat_return.ready",
    entityType: "vat_return",
    entityId: existing.id,
    before: { status: existing.status },
    after: { status: "ready" },
    req: input.req,
  });
  return updated;
}

/** Amended return (voluntary disclosure basis): recompute the period, store a diff. */
export async function amendVatReturn(input: {
  id: string;
  userId: string;
  reason: string;
  req?: Request;
}): Promise<{
  vatReturn: VatReturn;
  diff: ReturnType<typeof diffReturns>;
  computation: VatComputation;
}> {
  const original = await storage.getVatReturn(input.id);
  if (!original) throw new DomainError("VAT_RETURN_NOT_FOUND", 404);
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
  const computation = await computeVat201({ companyId: original.companyId, from, to });
  const diff = diffReturns(original as unknown as Record<string, unknown>, computation.boxes);
  const created = await storage.createVatReturn({
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
        computation.boxesFils.box14PayableTax - Math.round(Number(original.box14PayableTax) * 100)
      ),
    },
    reconciliationSnapshot: reconciliationSnapshot(computation),
    engineVersion: computation.engineVersion,
    partialExemptionRatio: computation.company.exemptSupplyRatio,
    notes: `Amendment of return ${original.id}: ${input.reason}`,
    createdBy: input.userId,
  } as never);
  await db
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
  });
  return { vatReturn: created, diff, computation };
}

export async function listReturns(companyId: string) {
  return db
    .select()
    .from(vatReturns)
    .where(eq(vatReturns.companyId, companyId))
    .orderBy(desc(vatReturns.periodEnd), desc(vatReturns.createdAt));
}

export { DERIVED_BOX_KEYS };
