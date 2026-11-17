/**
 * Deferred tax (A4: M2, IAS 12.15-24) and returns filed outside Muhasib (A4: M13).
 *
 * Deferred tax is a MANUAL adjustment journal type. The preparer states the closing deferred tax
 * asset and liability at a reporting date, either directly or from a temporary-difference
 * schedule (carrying amount vs tax base per item, x the CT rate, 9% by default). The movement
 * against the ledger balance is posted through server/ledger:
 *
 *   DTA up:   Dr 1270 Deferred tax asset      / Cr 5210 Deferred tax expense (income)
 *   DTL up:   Dr 5210 Deferred tax expense    / Cr 2260 Deferred tax liability
 *   (and the reverse for decreases)
 *
 * 5210 carries the `corporate_tax_expense` tag: it is excluded from the CT base (Art. 33(9))
 * and reported with income tax, not operating expenses. DTA and DTL are non-current (IAS 1.56).
 * The full automatic temporary-difference schedule from the fixed-asset register and other
 * sub-ledgers is a documented follow-up; the CT workpaper's deferred-tax note can seed this
 * schedule (`fromReturnId`).
 *
 * External returns (FDL 47/2022 Art. 37): the loss and disallowed interest carried forward by a
 * return filed before go-live are entered here and feed the next return's brought-forward pool
 * (repository.getPriorCtFacts).
 */
import type { Request } from "express";
import { pool } from "../../db";
import { DomainError } from "../../errors";
import { postJournal, reverseBySource } from "../../ledger";
import { recordAudit } from "../audit.service";
import { accountTotals } from "../../reporting";
import { assertPeriodNotLocked } from "../period-lock.service";
import { storage } from "../../storage";
import { CT_STANDARD_RATE } from "../../../shared/ct-workpaper";
import { ensureCtTagAccounts } from "./repository";

export const DEFERRED_TAX_SOURCE = "deferred_tax";

interface AccountSpec {
  code: string;
  nameEn: string;
  nameAr: string;
  type: "asset" | "liability" | "expense";
  subType: string;
  taxTag: string | null;
  description: string;
}

export const DEFERRED_TAX_ACCOUNTS = {
  asset: {
    code: "1270",
    nameEn: "Deferred Tax Asset",
    nameAr: "أصل ضريبي مؤجل",
    type: "asset",
    subType: "non_current_asset",
    taxTag: null,
    description: "Deferred tax on deductible temporary differences and unused tax losses (IAS 12)",
  },
  liability: {
    code: "2260",
    nameEn: "Deferred Tax Liability",
    nameAr: "التزام ضريبي مؤجل",
    type: "liability",
    subType: "non_current_liability",
    taxTag: null,
    description: "Deferred tax on taxable temporary differences (IAS 12)",
  },
  expense: {
    code: "5210",
    nameEn: "Deferred Tax Expense",
    nameAr: "مصروف الضريبة المؤجلة",
    type: "expense",
    subType: "income_tax",
    taxTag: "corporate_tax_expense",
    description: "Deferred tax movement (part of income tax expense, IAS 12.58)",
  },
} as const satisfies Record<string, AccountSpec>;

async function ensureAccount(companyId: string, spec: AccountSpec): Promise<string> {
  const found = await pool.query(
    `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 AND type = $3 LIMIT 1`,
    [companyId, spec.code, spec.type]
  );
  if (found.rows[0]) return found.rows[0].id as string;
  const taken = await pool.query(`SELECT code FROM accounts WHERE company_id = $1`, [companyId]);
  const codes = new Set(taken.rows.map((r: { code: string }) => String(r.code)));
  let n = Number(spec.code);
  while (codes.has(String(n))) n += 1;
  const ins = await pool.query(
    `INSERT INTO accounts (company_id, code, name_en, name_ar, type, sub_type, tax_tag,
                           is_system_account, is_active, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false, true, $8)
     ON CONFLICT (company_id, code) DO NOTHING
     RETURNING id`,
    [
      companyId,
      String(n),
      spec.nameEn,
      spec.nameAr,
      spec.type,
      spec.subType,
      spec.taxTag,
      spec.description,
    ]
  );
  if (ins.rows[0]) return ins.rows[0].id as string;
  const again = await pool.query(`SELECT id FROM accounts WHERE company_id = $1 AND code = $2`, [
    companyId,
    String(n),
  ]);
  return again.rows[0].id as string;
}

export interface DeferredTaxScheduleItem {
  description: string;
  /** asset / liability: a balance-sheet item; tax_loss / interest: an unused tax attribute. */
  kind: "asset" | "liability" | "tax_loss" | "interest";
  carryingAmount?: number;
  taxBase?: number;
  /** tax_loss / interest: the unused amount carried forward. */
  amount?: number;
}

export interface DeferredTaxScheduleRow extends DeferredTaxScheduleItem {
  temporaryDifference: number;
  /** deductible -> DTA; taxable -> DTL. */
  nature: "deductible" | "taxable" | "none";
  deferredTax: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const toFils = (n: number) => Math.round(n * 100);

/**
 * Temporary differences (IAS 12.5): carrying amount - tax base. For an asset a positive
 * difference is taxable (DTL); for a liability a positive difference is deductible (DTA).
 * Unused tax losses and disallowed interest carried forward are deductible (DTA, IAS 12.34).
 */
export function deferredTaxSchedule(
  items: DeferredTaxScheduleItem[],
  rate: number = CT_STANDARD_RATE
): { rows: DeferredTaxScheduleRow[]; assetFils: number; liabilityFils: number } {
  let assetFils = 0;
  let liabilityFils = 0;
  const rows = items.map((it) => {
    let diff: number;
    let nature: DeferredTaxScheduleRow["nature"];
    if (it.kind === "tax_loss" || it.kind === "interest") {
      diff = Math.max(0, it.amount ?? 0);
      nature = diff > 0 ? "deductible" : "none";
    } else {
      diff = r2((it.carryingAmount ?? 0) - (it.taxBase ?? 0));
      const taxable = it.kind === "asset" ? diff > 0 : diff < 0;
      nature = diff === 0 ? "none" : taxable ? "taxable" : "deductible";
    }
    const dtFils = Math.round(Math.abs(diff) * rate * 100);
    if (nature === "deductible") assetFils += dtFils;
    if (nature === "taxable") liabilityFils += dtFils;
    return { ...it, temporaryDifference: diff, nature, deferredTax: dtFils / 100 };
  });
  return { rows, assetFils, liabilityFils };
}

async function ledgerBalances(companyId: string, asOf: string) {
  // The current-tax accounts first, so the provision keeps using 5200 (the tag's first account).
  await ensureCtTagAccounts(companyId, ["corporate_tax_expense", "corporate_tax_payable"]);
  const [dta, dtl] = await Promise.all([
    ensureAccount(companyId, DEFERRED_TAX_ACCOUNTS.asset),
    ensureAccount(companyId, DEFERRED_TAX_ACCOUNTS.liability),
  ]);
  const expense = await ensureAccount(companyId, DEFERRED_TAX_ACCOUNTS.expense);
  const totals = await accountTotals(companyId, { to: asOf });
  const a = totals.get(dta);
  const l = totals.get(dtl);
  return {
    accounts: { dta, dtl, expense },
    assetFils: a ? a.debit - a.credit : 0,
    liabilityFils: l ? l.credit - l.debit : 0,
  };
}

export interface DeferredTaxInput {
  asOf: string;
  taxRate?: number;
  closingAsset?: number;
  closingLiability?: number;
  schedule?: DeferredTaxScheduleItem[];
  fromReturnId?: string;
  note?: string | null;
}

/** Schedule items from a CT return's deferred-tax note (shared/ct workpaper, R08-19). */
async function scheduleFromReturn(
  companyId: string,
  returnId: string
): Promise<DeferredTaxScheduleItem[]> {
  const ret = await storage.getCorporateTaxReturn(returnId);
  if (!ret || ret.companyId !== companyId) throw new DomainError("CT_RETURN_NOT_FOUND", 404);
  const note = (ret.workpaper as { deferredTax?: { items?: Array<Record<string, unknown>> } })
    ?.deferredTax;
  return (note?.items ?? []).map((i) => {
    const amount = Number(i.amount) || 0;
    if (i.key === "tax_losses") return { description: String(i.label), kind: "tax_loss", amount };
    if (i.key === "interest_carried_forward")
      return { description: String(i.label), kind: "interest", amount };
    // Unrealised gains deferred under the realisation basis: carrying amount above tax base.
    return {
      description: String(i.label),
      kind: i.kind === "asset" ? "liability" : "asset",
      carryingAmount: amount,
      taxBase: 0,
    };
  });
}

export async function previewDeferredTax(companyId: string, input: DeferredTaxInput) {
  const rate = input.taxRate ?? CT_STANDARD_RATE;
  const items =
    input.schedule ??
    (input.fromReturnId ? await scheduleFromReturn(companyId, input.fromReturnId) : undefined);
  const sched = items ? deferredTaxSchedule(items, rate) : null;
  const closingAssetFils = sched ? sched.assetFils : toFils(input.closingAsset ?? 0);
  const closingLiabilityFils = sched ? sched.liabilityFils : toFils(input.closingLiability ?? 0);
  const ledger = await ledgerBalances(companyId, input.asOf);
  const movementAssetFils = closingAssetFils - ledger.assetFils;
  const movementLiabilityFils = closingLiabilityFils - ledger.liabilityFils;
  return {
    asOf: input.asOf,
    taxRate: rate,
    schedule: sched?.rows ?? [],
    openingAsset: ledger.assetFils / 100,
    openingLiability: ledger.liabilityFils / 100,
    closingAsset: closingAssetFils / 100,
    closingLiability: closingLiabilityFils / 100,
    movementAsset: movementAssetFils / 100,
    movementLiability: movementLiabilityFils / 100,
    /** + = deferred tax expense, - = deferred tax income. */
    deferredTaxExpense: (movementLiabilityFils - movementAssetFils) / 100,
    accounts: ledger.accounts,
    fils: { movementAssetFils, movementLiabilityFils, closingAssetFils, closingLiabilityFils },
  };
}

export async function postDeferredTax(
  companyId: string,
  userId: string,
  input: DeferredTaxInput,
  req?: Request
) {
  const p = await previewDeferredTax(companyId, input);
  const { movementAssetFils: da, movementLiabilityFils: dl } = p.fils;
  if (da === 0 && dl === 0) {
    throw new DomainError(
      "DEFERRED_TAX_NO_CHANGE",
      409,
      { closingAsset: p.closingAsset, closingLiability: p.closingLiability },
      "The ledger already carries these deferred tax balances"
    );
  }
  await assertPeriodNotLocked(companyId, input.asOf);
  const ins = await pool.query(
    `INSERT INTO deferred_tax_adjustments
       (company_id, as_of, tax_rate, closing_asset, closing_liability, movement_asset,
        movement_liability, schedule, note, created_by)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8::jsonb, $9, $10) RETURNING id`,
    [
      companyId,
      input.asOf,
      p.taxRate,
      p.closingAsset.toFixed(2),
      p.closingLiability.toFixed(2),
      p.movementAsset.toFixed(2),
      p.movementLiability.toFixed(2),
      JSON.stringify(p.schedule),
      input.note ?? null,
      userId,
    ]
  );
  const id = ins.rows[0].id as string;
  const lines = [];
  const expenseFils = dl - da;
  if (da > 0)
    lines.push({
      accountId: p.accounts.dta,
      debitFils: da,
      description: "Deferred tax asset increase",
    });
  if (da < 0)
    lines.push({
      accountId: p.accounts.dta,
      creditFils: -da,
      description: "Deferred tax asset decrease",
    });
  if (dl > 0)
    lines.push({
      accountId: p.accounts.dtl,
      creditFils: dl,
      description: "Deferred tax liability increase",
    });
  if (dl < 0)
    lines.push({
      accountId: p.accounts.dtl,
      debitFils: -dl,
      description: "Deferred tax liability decrease",
    });
  if (expenseFils > 0)
    lines.push({
      accountId: p.accounts.expense,
      debitFils: expenseFils,
      description: "Deferred tax expense",
    });
  if (expenseFils < 0)
    lines.push({
      accountId: p.accounts.expense,
      creditFils: -expenseFils,
      description: "Deferred tax income",
    });
  try {
    const posted = await postJournal(
      {
        companyId,
        date: input.asOf,
        memo: `Deferred tax adjustment at ${input.asOf}${input.note ? ` - ${input.note}` : ""}`,
        source: DEFERRED_TAX_SOURCE,
        sourceId: id,
        idempotencyKey: `deferred-tax:${id}`,
        status: "posted",
        allowSameAccount: false,
        lines,
      },
      { actorId: userId, req, audit: true }
    );
    await pool.query(`UPDATE deferred_tax_adjustments SET journal_entry_id = $2 WHERE id = $1`, [
      id,
      posted.entry.id,
    ]);
    await recordAudit({
      userId,
      companyId,
      action: "corporate_tax.deferred_tax_posted",
      entityType: "deferred_tax_adjustment",
      entityId: id,
      before: null,
      after: {
        closingAsset: p.closingAsset,
        closingLiability: p.closingLiability,
        journalEntryId: posted.entry.id,
      },
      req,
    });
    const { fils: _f, accounts: _a, ...rest } = p;
    return { id, journalEntryId: posted.entry.id, entryNumber: posted.entry.entryNumber, ...rest };
  } catch (err) {
    await pool.query(
      `DELETE FROM deferred_tax_adjustments WHERE id = $1 AND journal_entry_id IS NULL`,
      [id]
    );
    throw err;
  }
}

export async function listDeferredTax(companyId: string) {
  const r = await pool.query(
    `SELECT d.*, je.entry_number FROM deferred_tax_adjustments d
       LEFT JOIN journal_entries je ON je.id = d.journal_entry_id
      WHERE d.company_id = $1 ORDER BY d.as_of DESC, d.created_at DESC`,
    [companyId]
  );
  return r.rows;
}

export async function reverseDeferredTax(
  companyId: string,
  id: string,
  userId: string,
  reason: string,
  req?: Request
) {
  const row = await pool.query(
    `SELECT id, status FROM deferred_tax_adjustments WHERE id = $1 AND company_id = $2`,
    [id, companyId]
  );
  if (!row.rows[0]) throw new DomainError("DEFERRED_TAX_NOT_FOUND", 404);
  if (row.rows[0].status !== "posted") throw new DomainError("DEFERRED_TAX_REVERSED", 409);
  await reverseBySource(
    companyId,
    DEFERRED_TAX_SOURCE,
    id,
    { reason: `Deferred tax adjustment reversed: ${reason}` },
    { actorId: userId, req, companyId }
  );
  await pool.query(`UPDATE deferred_tax_adjustments SET status = 'reversed' WHERE id = $1`, [id]);
  await recordAudit({
    userId,
    companyId,
    action: "corporate_tax.deferred_tax_reversed",
    entityType: "deferred_tax_adjustment",
    entityId: id,
    before: { status: "posted" },
    after: { status: "reversed", reason },
    req,
  });
  return { id, status: "reversed" };
}

// ─── Returns filed outside Muhasib (M13) ────────────────────────────────────

export interface ExternalReturnInput {
  taxPeriodStart: string;
  taxPeriodEnd: string;
  totalRevenue?: number;
  lossCarriedForward: number;
  interestCarriedForward?: number;
  filingReference?: string | null;
  note?: string | null;
}

export async function listExternalReturns(companyId: string) {
  const r = await pool.query(
    `SELECT id, tax_period_start::text AS "taxPeriodStart", tax_period_end::text AS "taxPeriodEnd",
            total_revenue::float8 AS "totalRevenue", loss_carried_forward::float8 AS "lossCarriedForward",
            interest_carried_forward::float8 AS "interestCarriedForward",
            filing_reference AS "filingReference", note, created_at AS "createdAt"
       FROM ct_external_returns WHERE company_id = $1 ORDER BY tax_period_end DESC`,
    [companyId]
  );
  return r.rows;
}

async function assertNoLiveReturnFor(companyId: string, start: string, end: string) {
  const r = await pool.query(
    `SELECT id FROM corporate_tax_returns
      WHERE company_id = $1 AND status IN ('draft', 'computed', 'reviewed', 'filed', 'paid')
        AND ((tax_period_start + interval '4 hours')::date) <= $3::date
        AND ((tax_period_end + interval '4 hours')::date) >= $2::date
      LIMIT 1`,
    [companyId, start, end]
  );
  if (r.rows[0]) {
    throw new DomainError(
      "CT_EXTERNAL_RETURN_OVERLAPS",
      409,
      { returnId: r.rows[0].id },
      "A return for this period already exists in Muhasib; its figures carry forward on their own"
    );
  }
}

export async function upsertExternalReturn(
  companyId: string,
  userId: string,
  input: ExternalReturnInput,
  id?: string,
  req?: Request
) {
  if (input.taxPeriodEnd < input.taxPeriodStart) {
    throw new DomainError("INVALID_PERIOD", 422, undefined, "The period end is before its start");
  }
  await assertNoLiveReturnFor(companyId, input.taxPeriodStart, input.taxPeriodEnd);
  const values = [
    companyId,
    input.taxPeriodStart,
    input.taxPeriodEnd,
    (input.totalRevenue ?? 0).toFixed(2),
    input.lossCarriedForward.toFixed(2),
    (input.interestCarriedForward ?? 0).toFixed(2),
    input.filingReference ?? null,
    input.note ?? null,
    userId,
  ];
  let row;
  try {
    row = id
      ? await pool.query(
          `UPDATE ct_external_returns SET tax_period_start = $2::date, tax_period_end = $3::date,
                  total_revenue = $4, loss_carried_forward = $5, interest_carried_forward = $6,
                  filing_reference = $7, note = $8, updated_at = now()
            WHERE company_id = $1 AND id = $10 RETURNING id`,
          [...values, id]
        )
      : await pool.query(
          `INSERT INTO ct_external_returns (company_id, tax_period_start, tax_period_end,
                  total_revenue, loss_carried_forward, interest_carried_forward, filing_reference,
                  note, created_by)
           VALUES ($1, $2::date, $3::date, $4, $5, $6, $7, $8, $9) RETURNING id`,
          values
        );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new DomainError(
        "CT_EXTERNAL_RETURN_EXISTS",
        409,
        undefined,
        "A return filed outside Muhasib is already recorded for this period end"
      );
    }
    throw err;
  }
  if (!row.rows[0]) throw new DomainError("CT_EXTERNAL_RETURN_NOT_FOUND", 404);
  await recordAudit({
    userId,
    companyId,
    action: id ? "corporate_tax.external_return_updated" : "corporate_tax.external_return_created",
    entityType: "ct_external_return",
    entityId: row.rows[0].id,
    before: null,
    after: { ...input },
    req,
  });
  return (await listExternalReturns(companyId)).find((r) => r.id === row.rows[0].id);
}

export async function deleteExternalReturn(
  companyId: string,
  userId: string,
  id: string,
  req?: Request
) {
  const r = await pool.query(
    `DELETE FROM ct_external_returns WHERE company_id = $1 AND id = $2 RETURNING id`,
    [companyId, id]
  );
  if (!r.rows[0]) throw new DomainError("CT_EXTERNAL_RETURN_NOT_FOUND", 404);
  await recordAudit({
    userId,
    companyId,
    action: "corporate_tax.external_return_deleted",
    entityType: "ct_external_return",
    entityId: id,
    before: { id },
    after: null,
    req,
  });
}
