/**
 * Corporate-tax return lifecycle (W4-A: R08-04, R08-09, R08-19).
 *
 *   draft ──compute──▶ computed ──review──▶ reviewed ──file──▶ filed ──▶ paid
 *     │                  ▲   │                 │                 │        │
 *     └──void            │   └──void           └──(un-review)────┘        │
 *                        │                                     amend (copy)
 *
 * - Every transition is one conditional UPDATE (status = from) and one audit
 *   row; a lost race answers 409.
 * - Filed / paid / amended / void returns are immutable. Amending copies the
 *   return into a new draft that references the original; the original
 *   becomes `amended` and its CT provision entry is reversed.
 * - The reviewer must differ from the preparer (single-member companies may
 *   self-review; the audit row records it).
 * - Filing optionally posts the CT provision (Dr tax expense / Cr CT payable)
 *   through server/ledger. Nothing here submits anything to the FTA.
 * - A4 (M2, IAS 12.12): the current-tax liability is recognised at the
 *   reporting date, before the return is filed: `accrueCtReturn` posts the
 *   computed tax as a year-end accrual dated period end (source
 *   `corporate_tax_accrual`; re-accruing reverses the previous accrual first).
 *   Filing then posts only the true-up (filed tax - accrued tax), dated period
 *   end while that period is open, else on the filing date as a prior-period
 *   under/over-provision (IAS 8.36 change in estimate).
 */
import { journalLine, journalMemo } from "@shared/journal-memo";
import type { Request } from "express";
import { pool } from "../../db";
import { DomainError } from "../../errors";
import {
  defineMachine,
  assertTransition,
  postJournal,
  reverseBySource,
  reverseEntry,
} from "../../ledger";
import { recordAudit } from "../audit.service";
import { storage } from "../../storage";
import { assertDifferentActor, companyHasSingleMember } from "../../middleware/companyRolePolicy";
import type { CorporateTaxReturn } from "../../../shared/schema";
import { computeReturnState, uaeIsoDate, type ComputeOverrides } from "./engine";
import { ensureCtTagAccounts } from "./repository";
import { assertPeriodNotLocked, isPeriodLocked } from "../period-lock.service";
import { uaeToday } from "./deadlines";

export const CT_RETURN_STATES = [
  "draft",
  "computed",
  "reviewed",
  "filed",
  "paid",
  "amended",
  "void",
] as const;
export type CtReturnStatus = (typeof CT_RETURN_STATES)[number];

export const ctReturnMachine = defineMachine<CtReturnStatus>({
  states: CT_RETURN_STATES,
  transitions: {
    draft: ["computed", "void"],
    computed: ["reviewed", "void"],
    reviewed: ["computed", "filed"],
    // filed -> reviewed is "mark not filed" (unfileCtReturn): audited, with a reason.
    filed: ["paid", "amended", "reviewed"],
    paid: ["amended"],
  },
});

/** Statuses whose figures may still change. */
export const CT_EDITABLE_STATUSES: readonly CtReturnStatus[] = ["draft", "computed"];

export const CT_PROVISION_SOURCE = "corporate_tax";
/** Year-end current-tax accrual posted before filing (A4, M2). */
export const CT_ACCRUAL_SOURCE = "corporate_tax_accrual";

export function assertEditable(ctReturn: Pick<CorporateTaxReturn, "status" | "id">): void {
  if (!(CT_EDITABLE_STATUSES as readonly string[]).includes(ctReturn.status)) {
    throw new DomainError(
      "CT_RETURN_IMMUTABLE",
      409,
      { status: ctReturn.status },
      ctReturn.status === "reviewed"
        ? "This return has been reviewed. Send it back to computed before editing."
        : `A ${ctReturn.status} return cannot be changed. Amend it to create a new version.`
    );
  }
}

function snapshot(r: CorporateTaxReturn) {
  return {
    status: r.status,
    taxableIncome: r.taxableIncome,
    taxPayable: r.taxPayable,
    filedAt: r.filedAt,
    filedBy: r.filedBy,
    reviewedBy: r.reviewedBy,
    provisionEntryId: r.provisionEntryId,
    accrualEntryId: r.accrualEntryId ?? null,
    accruedTax: r.accruedTax ?? 0,
  };
}

async function audit(
  action: string,
  userId: string,
  before: CorporateTaxReturn | null,
  after: CorporateTaxReturn,
  req?: Request,
  extra?: Record<string, unknown>
): Promise<void> {
  await recordAudit({
    userId,
    companyId: after.companyId,
    action: `corporate_tax_return.${action}`,
    entityType: "corporate_tax_return",
    entityId: after.id,
    before: before ? snapshot(before) : null,
    after: snapshot(after),
    req,
    extra,
  });
}

export async function auditCtReturn(
  action: string,
  userId: string,
  before: CorporateTaxReturn | null,
  after: CorporateTaxReturn,
  req?: Request,
  extra?: Record<string, unknown>
): Promise<void> {
  await audit(action, userId, before, after, req, extra);
}

/**
 * Conditional update: only applies while the row is still in one of `from`.
 * Returns the updated row or throws 409 when it lost a race / wrong state.
 */
export async function updateIfStatus(
  id: string,
  companyId: string,
  from: readonly string[],
  data: Partial<CorporateTaxReturn>
): Promise<CorporateTaxReturn> {
  const current = await storage.getCorporateTaxReturn(id);
  if (!current || current.companyId !== companyId) {
    throw new DomainError("CT_RETURN_NOT_FOUND", 404);
  }
  if (!from.includes(current.status)) {
    throw new DomainError("CT_RETURN_IMMUTABLE", 409, { status: current.status });
  }
  const columns: Record<string, string> = {
    status: "status",
    totalRevenue: "total_revenue",
    totalExpenses: "total_expenses",
    totalDeductions: "total_deductions",
    taxableIncome: "taxable_income",
    taxPayable: "tax_payable",
    exemptionThreshold: "exemption_threshold",
    taxRate: "tax_rate",
    lossBroughtForward: "loss_brought_forward",
    lossCarriedForward: "loss_carried_forward",
    interestCarriedForward: "interest_carried_forward",
    smallBusinessRelief: "small_business_relief",
    relatedPartyNotes: "related_party_notes",
    notes: "notes",
    workpaper: "workpaper",
    taxPeriodStart: "tax_period_start",
    taxPeriodEnd: "tax_period_end",
    preparedBy: "prepared_by",
    computedAt: "computed_at",
    reviewedBy: "reviewed_by",
    reviewedAt: "reviewed_at",
    filedAt: "filed_at",
    filedBy: "filed_by",
    filingReference: "filing_reference",
    supersededById: "superseded_by_id",
    provisionEntryId: "provision_entry_id",
    provisionReversalEntryId: "provision_reversal_entry_id",
    accrualEntryId: "accrual_entry_id",
    accruedTax: "accrued_tax",
  };
  const sets: string[] = [];
  const values: unknown[] = [id, companyId, from as unknown as string[]];
  for (const [key, value] of Object.entries(data)) {
    const col = columns[key];
    if (!col || value === undefined) continue;
    values.push(key === "workpaper" ? JSON.stringify(value) : value);
    sets.push(`${col} = $${values.length}${key === "workpaper" ? "::jsonb" : ""}`);
  }
  sets.push("updated_at = now()");
  const r = await pool.query(
    `UPDATE corporate_tax_returns SET ${sets.join(", ")}
      WHERE id = $1 AND company_id = $2 AND status = ANY($3::text[])
      RETURNING id`,
    values
  );
  if (r.rowCount === 0) {
    throw new DomainError("CT_RETURN_CONFLICT", 409, undefined, "The return changed; reload it");
  }
  const updated = await storage.getCorporateTaxReturn(id);
  return updated!;
}

/** Recompute an editable return and persist; status becomes `computed` when asked. */
export async function recomputeAndSave(
  ctReturn: CorporateTaxReturn,
  userId: string,
  overrides: ComputeOverrides & {
    extra?: Partial<CorporateTaxReturn>;
    markComputed?: boolean;
  },
  req?: Request,
  action = "recompute"
) {
  assertEditable(ctReturn);
  const { computation, update } = await computeReturnState(ctReturn, overrides);
  const data: Partial<CorporateTaxReturn> = {
    ...update,
    ...(overrides.extra ?? {}),
    preparedBy: userId,
    computedAt: new Date(),
  };
  if (overrides.markComputed && ctReturn.status === "draft") data.status = "computed";
  const updated = await updateIfStatus(ctReturn.id, ctReturn.companyId, CT_EDITABLE_STATUSES, data);
  await audit(action, userId, ctReturn, updated, req);
  return { return: updated, computation };
}

export interface TransitionInput {
  to: "computed" | "reviewed" | "filed" | "paid" | "void";
  filingReference?: string;
  /** ISO date the return was filed in EmaraTax (default: today). */
  filedOn?: string;
  postProvision?: boolean;
  note?: string;
}

const toFilsAed = (v: unknown) => Math.round((Number(v) || 0) * 100);

async function ctProvisionAccounts(companyId: string) {
  const accounts = await ensureCtTagAccounts(companyId, [
    "corporate_tax_expense",
    "corporate_tax_payable",
  ]);
  const expense = accounts.get("corporate_tax_expense");
  const payable = accounts.get("corporate_tax_payable");
  if (!expense || !payable) throw new DomainError("CT_PROVISION_ACCOUNTS_MISSING", 500);
  return { expense, payable };
}

/** Dr/Cr lines moving `fils` (signed: + more tax) between tax expense and CT payable. */
type ProvisionKind = "UnderProvision" | "OverProvision" | "Accrual";

function provisionLines(
  expenseId: string,
  payableId: string,
  fils: number,
  kind: ProvisionKind
) {
  const expense = journalLine(`ctExpense${kind}`);
  const payable = journalLine(`ctPayable${kind}`);
  return fils >= 0
    ? [
        { accountId: expenseId, debitFils: fils, ...expense },
        { accountId: payableId, creditFils: fils, ...payable },
      ]
    : [
        { accountId: payableId, debitFils: -fils, ...payable },
        { accountId: expenseId, creditFils: -fils, ...expense },
      ];
}

/**
 * A4 (M2): filing against a year-end accrual posts only the difference. Dated period end while
 * that period is open; once it is locked, on the filing date (prior-period under/over-provision).
 */
async function postProvisionTrueUp(
  ctReturn: CorporateTaxReturn,
  userId: string,
  filedOn: string,
  req?: Request
): Promise<string | null> {
  const delta = toFilsAed(ctReturn.taxPayable) - toFilsAed(ctReturn.accruedTax);
  if (delta === 0) return null;
  const { expense, payable } = await ctProvisionAccounts(ctReturn.companyId);
  const periodEnd = uaeIsoDate(ctReturn.taxPeriodEnd);
  const date = (await isPeriodLocked(ctReturn.companyId, periodEnd)) ? filedOn : periodEnd;
  const unfiled = await pool.query(
    `SELECT count(*)::int AS n FROM audit_logs
      WHERE company_id = $1 AND resource_id = $2 AND action = 'corporate_tax_return.unfiled'`,
    [ctReturn.companyId, ctReturn.id]
  );
  const refile = Number(unfiled.rows[0]?.n ?? 0);
  const what: ProvisionKind = delta > 0 ? "UnderProvision" : "OverProvision";
  const result = await postJournal(
    {
      companyId: ctReturn.companyId,
      date,
      ...journalMemo("corporateTaxTrueUp", {
        from: uaeIsoDate(ctReturn.taxPeriodStart),
        to: periodEnd,
      }),
      source: CT_PROVISION_SOURCE,
      sourceId: ctReturn.id,
      idempotencyKey: `ct-return:${ctReturn.id}:trueup${refile > 0 ? `:refile-${refile}` : ""}`,
      status: "posted",
      lines: provisionLines(expense.id, payable.id, delta, what),
    },
    { actorId: userId, req, audit: true }
  );
  return result.entry.id;
}

/**
 * A4 (M2, IAS 12.12): accrue the computed current tax at the reporting date, before filing.
 * Dr corporate tax expense / Cr corporate tax payable, dated period end. Re-accruing after the
 * figures changed reverses the previous accrual and posts the new amount; an unchanged amount is
 * a no-op. Filing later posts only the true-up.
 */
export async function accrueCtReturn(
  ctReturn: CorporateTaxReturn,
  userId: string,
  req?: Request
): Promise<{ return: CorporateTaxReturn; changed: boolean; entryId: string | null }> {
  if (!["computed", "reviewed"].includes(ctReturn.status)) {
    throw new DomainError(
      "CT_ACCRUAL_NOT_ALLOWED",
      409,
      { status: ctReturn.status },
      ctReturn.status === "draft"
        ? "Compute the return before accruing the tax"
        : "A filed return is settled by its filing; amend it to change the tax"
    );
  }
  const taxFils = toFilsAed(ctReturn.taxPayable);
  const accruedFils = toFilsAed(ctReturn.accruedTax);
  if (taxFils === accruedFils && (taxFils === 0 || ctReturn.accrualEntryId)) {
    return { return: ctReturn, changed: false, entryId: ctReturn.accrualEntryId ?? null };
  }
  const periodEnd = uaeIsoDate(ctReturn.taxPeriodEnd);
  await assertPeriodNotLocked(ctReturn.companyId, periodEnd);
  let reversalId: string | null = null;
  if (ctReturn.accrualEntryId) {
    const rev = await reverseEntry(
      ctReturn.accrualEntryId,
      { date: periodEnd, reason: "Corporate tax accrual replaced after recomputation" },
      { actorId: userId, req, companyId: ctReturn.companyId }
    );
    reversalId = rev.reversal.id;
  }
  let entryId: string | null = null;
  if (taxFils > 0) {
    const { expense, payable } = await ctProvisionAccounts(ctReturn.companyId);
    const seq = await pool.query(
      `SELECT count(*)::int AS n FROM journal_entries
        WHERE company_id = $1 AND source = $2 AND source_id = $3`,
      [ctReturn.companyId, CT_ACCRUAL_SOURCE, ctReturn.id]
    );
    const result = await postJournal(
      {
        companyId: ctReturn.companyId,
        date: periodEnd,
        ...journalMemo("corporateTaxAccrual", {
          from: uaeIsoDate(ctReturn.taxPeriodStart),
          to: periodEnd,
        }),
        source: CT_ACCRUAL_SOURCE,
        sourceId: ctReturn.id,
        idempotencyKey: `ct-return:${ctReturn.id}:accrual:${Number(seq.rows[0]?.n ?? 0) + 1}`,
        status: "posted",
        lines: provisionLines(expense.id, payable.id, taxFils, "Accrual"),
      },
      { actorId: userId, req, audit: true }
    );
    entryId = result.entry.id;
  }
  await pool.query(
    `UPDATE corporate_tax_returns SET accrual_entry_id = $2, accrued_tax = $3, updated_at = now()
      WHERE id = $1`,
    [ctReturn.id, entryId, (taxFils / 100).toFixed(2)]
  );
  const updated = (await storage.getCorporateTaxReturn(ctReturn.id))!;
  await audit("accrued", userId, ctReturn, updated, req, {
    accrualEntryId: entryId,
    replacedAccrualReversalId: reversalId,
  });
  return { return: updated, changed: true, entryId };
}

async function postProvision(
  ctReturn: CorporateTaxReturn,
  userId: string,
  req?: Request
): Promise<string | null> {
  const fils = Math.round((Number(ctReturn.taxPayable) || 0) * 100);
  if (fils <= 0) return null;
  const { expense, payable } = await ctProvisionAccounts(ctReturn.companyId);
  const periodEnd = uaeIsoDate(ctReturn.taxPeriodEnd);
  // A return marked not filed had its provision reversed; re-filing posts a fresh one.
  const unfiled = await pool.query(
    `SELECT count(*)::int AS n FROM audit_logs
      WHERE company_id = $1 AND resource_id = $2 AND action = 'corporate_tax_return.unfiled'`,
    [ctReturn.companyId, ctReturn.id]
  );
  const refile = Number(unfiled.rows[0]?.n ?? 0);
  const result = await postJournal(
    {
      companyId: ctReturn.companyId,
      date: periodEnd,
      ...journalMemo("corporateTaxProvision", {
        from: uaeIsoDate(ctReturn.taxPeriodStart),
        to: periodEnd,
      }),
      source: CT_PROVISION_SOURCE,
      sourceId: ctReturn.id,
      idempotencyKey: `ct-return:${ctReturn.id}:provision${refile > 0 ? `:refile-${refile}` : ""}`,
      status: "posted",
      lines: [
        { accountId: expense.id, debitFils: fils, ...journalLine("ctExpense") },
        { accountId: payable.id, creditFils: fils, ...journalLine("ctPayable") },
      ],
    },
    { actorId: userId, req, audit: true }
  );
  return result.entry.id;
}

/** Apply a lifecycle transition. Permission checks happen in the route. */
export async function transitionCtReturn(
  ctReturn: CorporateTaxReturn,
  input: TransitionInput,
  userId: string,
  req?: Request
): Promise<CorporateTaxReturn> {
  assertTransition(ctReturnMachine, ctReturn.status, input.to);
  const from = [ctReturn.status];
  let updated: CorporateTaxReturn;
  const extra: Record<string, unknown> = {};
  switch (input.to) {
    case "computed": {
      if (ctReturn.status === "draft") {
        return (await recomputeAndSave(ctReturn, userId, { markComputed: true }, req, "computed"))
          .return;
      }
      // reviewed -> computed: send back for changes; the review is cleared.
      updated = await updateIfStatus(ctReturn.id, ctReturn.companyId, from, {
        status: "computed",
        reviewedBy: null,
        reviewedAt: null,
      });
      extra.note = input.note ?? null;
      break;
    }
    case "reviewed": {
      const single = await companyHasSingleMember(ctReturn.companyId);
      assertDifferentActor(ctReturn.preparedBy, userId, { allowSingleOwner: single });
      updated = await updateIfStatus(ctReturn.id, ctReturn.companyId, from, {
        status: "reviewed",
        reviewedBy: userId,
        reviewedAt: new Date(),
      });
      extra.selfReviewed = ctReturn.preparedBy === userId;
      break;
    }
    case "filed": {
      const reference = (input.filingReference ?? "").trim();
      if (reference.length < 3) {
        throw new DomainError(
          "CT_FILING_REFERENCE_REQUIRED",
          422,
          undefined,
          "Enter the EmaraTax filing reference"
        );
      }
      // The provision is a ledger posting dated period end: check the period lock BEFORE the
      // status changes, so a locked period never leaves a return "filed" without its provision.
      // A soft lock passes with an audited X-Period-Lock-Reason. With a year-end accrual (A4)
      // only the true-up posts, on the filing date when the period is locked.
      const hasAccrual = !!ctReturn.accrualEntryId || toFilsAed(ctReturn.accruedTax) !== 0;
      const filedOn = input.filedOn ?? uaeToday();
      if (!hasAccrual && input.postProvision && (Number(ctReturn.taxPayable) || 0) > 0) {
        await assertPeriodNotLocked(ctReturn.companyId, uaeIsoDate(ctReturn.taxPeriodEnd));
      }
      updated = await updateIfStatus(ctReturn.id, ctReturn.companyId, from, {
        status: "filed",
        filedAt: input.filedOn ? new Date(`${input.filedOn}T00:00:00.000Z`) : new Date(),
        filedBy: userId,
        filingReference: reference,
      });
      if (input.postProvision) {
        const entryId = hasAccrual
          ? await postProvisionTrueUp(updated, userId, filedOn, req)
          : await postProvision(updated, userId, req);
        if (entryId) {
          await pool.query(
            `UPDATE corporate_tax_returns SET provision_entry_id = $2 WHERE id = $1`,
            [updated.id, entryId]
          );
          updated = (await storage.getCorporateTaxReturn(updated.id))!;
          extra.provisionEntryId = entryId;
        }
      }
      extra.manualFiling = "Recorded as filed in EmaraTax by the user; Muhasib does not submit.";
      break;
    }
    case "paid": {
      updated = await updateIfStatus(ctReturn.id, ctReturn.companyId, from, { status: input.to });
      break;
    }
    case "void": {
      updated = await updateIfStatus(ctReturn.id, ctReturn.companyId, from, { status: input.to });
      // A voided return no longer supports its year-end accrual (A4).
      if (ctReturn.accrualEntryId) {
        try {
          const rev = await reverseEntry(
            ctReturn.accrualEntryId,
            { reason: "Corporate tax return voided" },
            { actorId: userId, req, companyId: ctReturn.companyId }
          );
          extra.accrualReversalEntryId = rev.reversal.id;
        } catch (err) {
          if ((err as { code?: string }).code !== "ALREADY_REVERSED") throw err;
        }
      }
      break;
    }
    default:
      throw new DomainError("INVALID_TRANSITION", 409);
  }
  await audit(input.to, userId, ctReturn, updated, req, extra);
  return updated;
}

/**
 * X4 (J3): "mark not filed" — undo a mistaken "record as filed" (filed, not yet paid).
 * The return goes back to `reviewed`, the filing reference/date are cleared, any CT
 * provision posted at filing is reversed, and the reason is audited.
 */
export async function unfileCtReturn(
  ctReturn: CorporateTaxReturn,
  userId: string,
  reason: string,
  req?: Request
): Promise<CorporateTaxReturn> {
  if (ctReturn.status !== "filed") {
    throw new DomainError(
      "CT_RETURN_NOT_FILED",
      409,
      { status: ctReturn.status },
      "Only a filed (unpaid) return can be marked as not filed; amend paid returns instead"
    );
  }
  assertTransition(ctReturnMachine, ctReturn.status, "reviewed");
  let reversalId: string | null = null;
  if (ctReturn.provisionEntryId) {
    const reversals = await reverseBySource(
      ctReturn.companyId,
      CT_PROVISION_SOURCE,
      ctReturn.id,
      { reason: `Corporate tax return marked not filed: ${reason}` },
      { actorId: userId, req, companyId: ctReturn.companyId }
    );
    reversalId = reversals[0]?.reversal.id ?? null;
  }
  const updated = await updateIfStatus(ctReturn.id, ctReturn.companyId, ["filed"], {
    status: "reviewed",
    filedAt: null,
    filedBy: null,
    filingReference: null,
    provisionEntryId: null,
  });
  await audit("unfiled", userId, ctReturn, updated, req, {
    reason,
    previousFilingReference: ctReturn.filingReference ?? null,
    provisionReversalEntryId: reversalId,
  });
  return updated;
}

/**
 * Amend a filed (or paid) return by copy: the original becomes `amended`
 * (immutable, superseded_by_id set) and its CT provision is reversed; the new
 * draft references it and is recomputed.
 */
export async function amendCtReturn(
  original: CorporateTaxReturn,
  userId: string,
  reason: string,
  req?: Request
): Promise<{ original: CorporateTaxReturn; amendment: CorporateTaxReturn }> {
  assertTransition(ctReturnMachine, original.status, "amended");
  const copy = await pool.query(
    `INSERT INTO corporate_tax_returns
       (company_id, tax_period_start, tax_period_end, total_revenue, total_expenses,
        total_deductions, taxable_income, exemption_threshold, tax_rate, tax_payable,
        loss_brought_forward, loss_carried_forward, small_business_relief, related_party_notes,
        status, workpaper, notes, prepared_by, amends_return_id, amendment_number,
        interest_carried_forward, accrual_entry_id, accrued_tax)
     SELECT company_id, tax_period_start, tax_period_end, total_revenue, total_expenses,
            total_deductions, taxable_income, exemption_threshold, tax_rate, tax_payable,
            loss_brought_forward, loss_carried_forward, small_business_relief, related_party_notes,
            'draft', workpaper, notes, $2, id, amendment_number + 1, interest_carried_forward,
            accrual_entry_id, accrued_tax
       FROM corporate_tax_returns WHERE id = $1 AND company_id = $3
     RETURNING id`,
    [original.id, userId, original.companyId]
  );
  const amendmentId = copy.rows[0]?.id as string | undefined;
  if (!amendmentId) throw new DomainError("CT_RETURN_NOT_FOUND", 404);

  let reversalId: string | null = null;
  if (original.provisionEntryId) {
    const reversals = await reverseBySource(
      original.companyId,
      CT_PROVISION_SOURCE,
      original.id,
      { reason: `Amended corporate tax return: ${reason}` },
      { actorId: userId, req, companyId: original.companyId }
    );
    reversalId = reversals[0]?.reversal.id ?? null;
  }
  const amendedOriginal = await updateIfStatus(original.id, original.companyId, ["filed", "paid"], {
    status: "amended",
    supersededById: amendmentId,
    ...(reversalId ? { provisionReversalEntryId: reversalId } : {}),
  });
  let amendment = (await storage.getCorporateTaxReturn(amendmentId))!;
  amendment = (await recomputeAndSave(amendment, userId, {}, req, "amendment_recompute")).return;
  await audit("amended", userId, original, amendedOriginal, req, {
    reason,
    amendmentId,
    provisionReversalEntryId: reversalId,
  });
  await audit("created_amendment", userId, null, amendment, req, {
    reason,
    amendsReturnId: original.id,
  });
  return { original: amendedOriginal, amendment };
}
