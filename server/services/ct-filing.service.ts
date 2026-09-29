/**
 * Corporate tax "filed with evidence" (Phase 4.2): the same pattern as VAT
 * (snapshot + hash, reference number, evidence, immutability, amendment as a
 * linked new record, payments) on top of the generic tax-filing service.
 *
 * Accounting: nothing accrues corporate tax before filing, so filing posts
 * Dr Corporate Tax Expense / Cr Corporate Tax Payable for the computed tax, dated
 * the LAST DAY OF THE TAX PERIOD it relates to (so it lands in the right year's
 * profit and loss, whenever the return is filed). Payments are Dr Corporate Tax
 * Payable / Cr Bank, dated the payment day. An amendment accrues (or reverses)
 * only the difference.
 *
 * Creating, computing and filing a return for a locked or closed year is normal
 * (months are locked by VAT filing and by the year-end close), so the accrual is
 * posted into the tax year even when its month is locked, through the narrow,
 * audited `allowLockedPeriod` bypass that only this service constructs. If that
 * year was already closed to retained earnings, the accrual is accompanied by a
 * closing line (Dr Retained Earnings / Cr Corporate Tax Expense, same date, source
 * year_end_close, same return) in the same transaction, so the closed year's income
 * and expense accounts still net to zero and the balance sheet still balances.
 * Missing 5150 / 2060 are created from the default chart. Filing does not lock months.
 */

import { asc, eq, sql } from "drizzle-orm";
import type { Request } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { AppError } from "../errors";
import {
  corporateTaxReturns,
  taxFilingEvidence,
  taxFilings,
  type CorporateTaxReturn,
  type TaxFiling,
} from "../../shared/schema";
import { CT_ACCOUNT_CODES } from "../constants";
import { defaultChartOfAccounts } from "../defaultChartOfAccounts";
import { accounts } from "../../shared/schema";
import { acquirePostingLockShared, assertMonthOpenInTx, type PostingBypass } from "./posting-lock";
import { YEAR_END_SOURCE, resolveRetained } from "./year-end.service";
import { removeStoredFile } from "./document-upload.service";
import { classifyVatPeriod } from "./vat-period-status.service";
import { recordAudit } from "./audit.service";
import {
  buildCtSnapshot,
  diffBoxes,
  fromFils,
  snapshotHash,
  toFils,
  validateFilingInput,
  ymdOf,
  type BoxDifference,
  type CtSnapshot,
} from "./tax-filing-core";
import { buildCtAccrualPosting } from "./tax-settlement";
import {
  assertFilingPermission,
  buildFilingViewBase,
  evidenceRow,
  findAccountByCode,
  findAccountByName,
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

export const CT_JOURNAL_SOURCE_FILING = "corporate_tax_filing";
export const CT_JOURNAL_SOURCE_PAYMENT = "corporate_tax_payment";

const CT_PAYABLE = { name: "Corporate Tax Payable", code: CT_ACCOUNT_CODES.PAYABLE, type: "liability" } as const;
const CT_EXPENSE = { name: "Corporate Tax Expense", code: CT_ACCOUNT_CODES.EXPENSE, type: "expense" } as const;

/**
 * By code first, else by exact English name (a company may have created its own numbering); an
 * older chart that has neither gets the account from the default template instead of a 422.
 */
async function resolveCtAccount(tx: Tx, companyId: string, spec: typeof CT_PAYABLE | typeof CT_EXPENSE): Promise<AccountRef> {
  const byCode = await findAccountByCode(tx, companyId, spec.code, [spec.type]);
  if (byCode) return byCode;
  const byName = await findAccountByName(tx, companyId, spec.name, [spec.type]);
  if (byName) return byName;
  const template = defaultChartOfAccounts.find((a) => a.code === spec.code && a.type === spec.type);
  if (!template) throw missingAccountError(spec.name, spec.code, spec.type);
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

/** Is the financial year that contains `ymd` already closed to retained earnings? */
async function isFinancialYearClosed(tx: Tx, companyId: string, ymd: string): Promise<boolean> {
  const res: any = await tx.execute(sql`
    SELECT 1 FROM year_end_closes
     WHERE company_id = ${companyId} AND status = 'closed'
       AND year_start <= ${ymd}::date AND year_end >= ${ymd}::date
     LIMIT 1`);
  return ((res.rows ?? res) as unknown[]).length > 0;
}

async function loadCtReturn(returnId: string): Promise<CorporateTaxReturn> {
  const ret = await storage.getCorporateTaxReturn(returnId);
  if (!ret) throw new AppError({ message: "Corporate tax return not found", statusCode: 404, code: "CT_RETURN_NOT_FOUND" });
  return ret;
}

async function chainOf(ret: CorporateTaxReturn): Promise<CorporateTaxReturn[]> {
  const rootId = ret.amendsReturnId ?? ret.id;
  return db
    .select()
    .from(corporateTaxReturns)
    .where(sql`${corporateTaxReturns.id} = ${rootId} OR ${corporateTaxReturns.amendsReturnId} = ${rootId}`)
    .orderBy(asc(corporateTaxReturns.createdAt));
}

async function filingsFor(rows: CorporateTaxReturn[]): Promise<Map<string, TaxFiling>> {
  const out = new Map<string, TaxFiling>();
  for (const r of rows) {
    const f = await getFilingByReturn("corporate_tax", r.id);
    if (f) out.set(r.id, f);
  }
  return out;
}

async function baseFilingFor(ret: CorporateTaxReturn) {
  const chain = (await chainOf(ret)).filter((r) => r.id !== ret.id);
  const filings = await filingsFor(chain);
  const filed = chain
    .filter((r) => filings.has(r.id))
    .sort((a, b) => +new Date(filings.get(b.id)!.createdAt) - +new Date(filings.get(a.id)!.createdAt));
  return filed[0] ? { base: filed[0], filing: filings.get(filed[0].id)! } : null;
}

// ─── Record filing ───────────────────────────────────────────────────────────

export async function recordCtFiling(args: {
  user: FilingActor;
  returnId: string;
  input: { ftaReferenceNumber?: unknown; filedAt?: unknown; notes?: unknown; evidence?: EvidenceUploadInput | null };
  req?: Request;
}): Promise<{ filing: TaxFiling }> {
  const ret = await loadCtReturn(args.returnId);
  const { companyId } = ret;
  await assertFilingPermission(args.user, companyId, "write");

  if (ret.status !== "draft" || (await getFilingByReturn("corporate_tax", ret.id))) {
    throw new AppError({ message: "This corporate tax return is already recorded as filed.", statusCode: 409, code: "CT_RETURN_ALREADY_FILED" });
  }
  const startYmd = ymdOf(ret.taxPeriodStart);
  const endYmd = ymdOf(ret.taxPeriodEnd);
  if (classifyVatPeriod(startYmd, endYmd) !== "closed") {
    throw new AppError({
      message: "This tax period has not ended yet. A corporate tax return can only be filed once the period is over.",
      statusCode: 400,
      code: "PERIOD_NOT_ENDED",
    });
  }
  const checked = validateFilingInput({
    referenceNumber: args.input.ftaReferenceNumber,
    filedAt: args.input.filedAt,
    periodEnd: endYmd,
  });
  if (!checked.ok) throw new AppError({ message: checked.message, statusCode: checked.status, code: checked.code });

  const notes = typeof args.input.notes === "string" && args.input.notes.trim() ? args.input.notes.trim().slice(0, 2000) : null;
  const base = ret.isAmendment ? await baseFilingFor(ret) : null;
  if (ret.isAmendment && !base) {
    throw new AppError({ message: "The return this amends has not been recorded as filed.", statusCode: 409, code: "AMENDMENT_BASE_NOT_FILED" });
  }
  const stored = args.input.evidence?.fileData ? await storeEvidenceFile(companyId, args.user.id, args.input.evidence) : null;

  try {
    const outcome = await db.transaction(async (tx: Tx) => {
      const locked = await tx.execute(sql`SELECT status FROM corporate_tax_returns WHERE id = ${ret.id} FOR UPDATE`);
      const lockedRow = ((locked as any).rows ?? locked)[0];
      if (!lockedRow || lockedRow.status !== "draft") {
        throw new AppError({ message: "This corporate tax return is already recorded as filed.", statusCode: 409, code: "CT_RETURN_ALREADY_FILED" });
      }
      const [fresh] = await tx.select().from(corporateTaxReturns).where(eq(corporateTaxReturns.id, ret.id));
      const snap = buildCtSnapshot(fresh as unknown as Record<string, unknown>);

      let snapshot: CtSnapshot & { amendment?: unknown } = snap;
      let netFils = toFils(snap.boxes.taxPayable);
      let baseFilingId: string | null = null;
      if (base) {
        const baseSnap = base.filing.snapshot as CtSnapshot;
        const differences = diffBoxes(baseSnap.boxes, snap.boxes);
        if (differences.length === 0) {
          throw new AppError({ message: "This amendment has the same figures as the return it amends.", statusCode: 422, code: "NO_DIFFERENCE" });
        }
        netFils = toFils(snap.boxes.taxPayable) - toFils(baseSnap.boxes.taxPayable);
        baseFilingId = base.filing.id;
        snapshot = {
          ...snap,
          amendment: {
            baseReturnId: base.base.id,
            baseFilingId,
            baseSnapshotHash: base.filing.snapshotHash,
            differences,
          },
        };
      }
      const net = fromFils(netFils);

      let clearingEntryId: string | null = null;
      let lockedAccrual = false;
      if (netFils !== 0) {
        const expense = await resolveCtAccount(tx, companyId, CT_EXPENSE);
        const payable = await resolveCtAccount(tx, companyId, CT_PAYABLE);
        // The accrual belongs to the tax year: dated its last day. Take the month lock first,
        // and only then look at the year (a concurrent year-end close is either finished, and
        // seen, or waits for this transaction and picks the accrual up).
        await acquirePostingLockShared(tx, companyId, endYmd);
        const yearClosed = await isFinancialYearClosed(tx, companyId, endYmd);
        const retained = yearClosed ? await resolveRetained(tx, companyId) : null;
        const posting = buildCtAccrualPosting(
          net,
          { expenseId: expense.id, payableId: payable.id, retainedId: retained?.id },
          { yearClosed, label: `${startYmd} to ${endYmd}` }
        );
        // A locked month is expected here (VAT filing and the year-end close lock months), so the
        // accrual is posted into it as a system entry through the audited, narrow bypass.
        try {
          await assertMonthOpenInTx(tx, companyId, endYmd);
        } catch {
          lockedAccrual = true;
        }
        const bypass: PostingBypass | undefined = lockedAccrual ? { reason: "corporate_tax_accrual", returnId: ret.id } : undefined;
        clearingEntryId = await postSettlementJournal(tx, {
          companyId,
          ymd: endYmd,
          memo: `Corporate tax ${ret.isAmendment ? "amendment " : ""}${startYmd} to ${endYmd} - FTA ref ${checked.referenceNumber}`,
          source: CT_JOURNAL_SOURCE_FILING,
          sourceId: ret.id,
          userId: args.user.id,
          lines: posting.accrual,
          allowLockedPeriod: bypass,
        });
        if (posting.closing.length > 0) {
          await postSettlementJournal(tx, {
            companyId,
            ymd: endYmd,
            memo: `Corporate tax ${startYmd} to ${endYmd} closed to retained earnings (year ${startYmd.slice(0, 4)} already closed)`,
            source: YEAR_END_SOURCE,
            sourceId: ret.id,
            userId: args.user.id,
            lines: posting.closing,
            allowLockedPeriod: bypass,
          });
        }
      }

      const [row] = await tx
        .insert(taxFilings)
        .values({
          companyId,
          kind: "corporate_tax",
          returnId: ret.id,
          referenceNumber: checked.referenceNumber,
          filedAt: checked.filedAt,
          notes,
          snapshot,
          snapshotHash: snapshotHash(snapshot),
          baseFilingId,
          settlementOutput: 0,
          settlementInput: 0,
          settlementNet: net,
          clearingEntryId,
          filedBy: args.user.id,
        })
        .returning();

      await tx
        .update(corporateTaxReturns)
        .set({ status: "filed", filedAt: new Date(`${checked.filedAt}T00:00:00Z`), notes: notes ?? fresh.notes })
        .where(eq(corporateTaxReturns.id, ret.id));

      if (stored) await tx.insert(taxFilingEvidence).values(evidenceRow(companyId, row.id, args.user.id, stored));
      return { row: row as TaxFiling, lockedAccrual, accrualDate: endYmd };
    });
    const filing = outcome.row;
    if (outcome.lockedAccrual) {
      await recordAudit({
        userId: args.user.id,
        companyId,
        action: "tax_filing.locked_period_accrual",
        entityType: "corporate_tax_return",
        entityId: ret.id,
        after: { filingId: filing.id, accrualDate: outcome.accrualDate, reason: "corporate_tax_accrual", journalEntryId: filing.clearingEntryId },
        req: args.req,
      });
    }

    await recordAudit({
      userId: args.user.id,
      companyId,
      action: "tax_filing.file",
      entityType: "corporate_tax_return",
      entityId: ret.id,
      after: {
        filingId: filing.id,
        referenceNumber: filing.referenceNumber,
        filedAt: filing.filedAt,
        snapshotHash: filing.snapshotHash,
        settlementNet: filing.settlementNet,
        isAmendment: ret.isAmendment,
      },
      req: args.req,
    });
    return { filing };
  } catch (err) {
    if (stored) await removeStoredFile(stored.key);
    throw err;
  }
}

// ─── Payment ─────────────────────────────────────────────────────────────────

export async function recordCtPayment(args: { user: FilingActor; returnId: string; input: PaymentInput; req?: Request }) {
  const ret = await loadCtReturn(args.returnId);
  const filing = await getFilingByReturn("corporate_tax", ret.id);
  if (!filing) {
    throw new AppError({ message: "Record the return as filed before recording a payment.", statusCode: 409, code: "CT_RETURN_NOT_FILED" });
  }
  return recordFilingPayment({
    user: args.user,
    companyId: ret.companyId,
    filing,
    input: args.input,
    req: args.req,
    control: {
      resolve: (tx, companyId) => resolveCtAccount(tx, companyId, CT_PAYABLE),
      journalSource: CT_JOURNAL_SOURCE_PAYMENT,
      label: "Corporate tax",
    },
    onSettled: async (tx, view) => {
      if (view.status === "paid") {
        await tx.update(corporateTaxReturns).set({ status: "paid" }).where(eq(corporateTaxReturns.id, ret.id));
      }
    },
  });
}

// ─── Amendment ───────────────────────────────────────────────────────────────

/**
 * Creates the linked draft. It starts as a copy of the latest filed figures; the
 * accountant re-runs "pull from books" / "compute" on it (the existing draft
 * tools) and files it. Filing settles only the difference.
 */
export async function createCtAmendment(args: { user: FilingActor; returnId: string; req?: Request }) {
  const ret = await loadCtReturn(args.returnId);
  await assertFilingPermission(args.user, ret.companyId, "write");
  const chain = await chainOf(ret);
  const filings = await filingsFor(chain);
  const open = chain.find((r) => r.isAmendment && !filings.has(r.id));
  if (open) {
    throw new AppError({
      message: "An amendment for this period is already in progress.",
      statusCode: 409,
      code: "AMENDMENT_IN_PROGRESS",
      details: { amendmentId: open.id },
    });
  }
  const latest = chain
    .filter((r) => filings.has(r.id))
    .sort((a, b) => +new Date(filings.get(b.id)!.createdAt) - +new Date(filings.get(a.id)!.createdAt))[0];
  if (!latest) {
    throw new AppError({ message: "Only a return recorded as filed can be amended.", statusCode: 409, code: "CT_RETURN_NOT_FILED" });
  }
  const baseFiling = filings.get(latest.id)!;
  const amendment = await storage.createCorporateTaxReturn({
    companyId: latest.companyId,
    taxPeriodStart: latest.taxPeriodStart,
    taxPeriodEnd: latest.taxPeriodEnd,
    totalRevenue: latest.totalRevenue,
    totalExpenses: latest.totalExpenses,
    totalDeductions: latest.totalDeductions,
    taxableIncome: latest.taxableIncome,
    exemptionThreshold: latest.exemptionThreshold,
    taxRate: latest.taxRate,
    taxPayable: latest.taxPayable,
    lossBroughtForward: latest.lossBroughtForward,
    lossCarriedForward: latest.lossCarriedForward,
    smallBusinessRelief: latest.smallBusinessRelief,
    relatedPartyNotes: latest.relatedPartyNotes,
    workpaper: latest.workpaper,
    status: "draft",
    isAmendment: true,
    amendsReturnId: ret.amendsReturnId ?? ret.id,
    notes: `Amendment of the return filed under FTA reference ${baseFiling.referenceNumber}`,
  } as any);
  await recordAudit({
    userId: args.user.id,
    companyId: ret.companyId,
    action: "tax_filing.amend",
    entityType: "corporate_tax_return",
    entityId: amendment.id,
    after: { amends: latest.id },
    req: args.req,
  });
  return { amendment, baseReturnId: latest.id, baseFilingId: baseFiling.id };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export function overlayCtSnapshot<T extends Record<string, unknown>>(row: T, filing: TaxFiling | null | undefined): T {
  if (!filing) return row;
  const snap = filing.snapshot as CtSnapshot;
  return { ...row, ...snap.boxes, smallBusinessRelief: snap.smallBusinessRelief };
}

/** Live books totals for the period (posted journals), as the /calculate endpoint derives them. */
async function liveBookTotals(companyId: string, startYmd: string, endYmd: string) {
  const res: any = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN a.type = 'income' THEN jl.credit - jl.debit ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN a.type = 'expense' THEN jl.debit - jl.credit ELSE 0 END), 0) AS expenses
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id = ${companyId} AND je.status = 'posted'
      AND je.source NOT IN ('year_end_close', 'year_end_close_reversal', 'corporate_tax_filing')
      AND je.date::date >= ${startYmd}::date AND je.date::date <= ${endYmd}::date`);
  const row = ((res.rows ?? res) as Array<{ revenue: string; expenses: string }>)[0];
  return { revenue: Number(row?.revenue ?? 0), expenses: Number(row?.expenses ?? 0) };
}

async function computeCtDrift(ret: CorporateTaxReturn, snapshot: CtSnapshot) {
  const source = (ret.workpaper as { source?: string } | null)?.source;
  if (source !== "journal_calculation") {
    // A manual / imported workpaper is not derived from the books: nothing to compare.
    return { detected: false, differences: [] as BoxDifference[], check: "not_applicable" as const };
  }
  try {
    const live = await liveBookTotals(ret.companyId, snapshot.periodStart, snapshot.periodEnd);
    const differences = diffBoxes(
      { totalRevenue: snapshot.boxes.totalRevenue, totalExpenses: snapshot.boxes.totalExpenses },
      { totalRevenue: Math.max(0, live.revenue), totalExpenses: Math.max(0, live.expenses) }
    );
    return { detected: differences.length > 0, differences, check: "ok" as const };
  } catch (err) {
    return { detected: false, differences: [] as BoxDifference[], check: "unavailable" as const, message: (err as Error).message };
  }
}

export async function getCtReturnView(ret: CorporateTaxReturn) {
  const filing = await getFilingByReturn("corporate_tax", ret.id);
  const drift = filing
    ? await computeCtDrift(ret, filing.snapshot as CtSnapshot)
    : { detected: false, differences: [] as BoxDifference[], check: "not_applicable" as const };
  const base = await buildFilingViewBase(filing, drift);
  const chain = await chainOf(ret);
  const filings = await filingsFor(chain);

  let amendmentDifferences: BoxDifference[] = [];
  let amendsReference: string | null = null;
  if (ret.isAmendment) {
    const baseRef = await baseFilingFor(ret);
    if (baseRef) {
      amendsReference = baseRef.filing.referenceNumber;
      const current = filing ? (filing.snapshot as CtSnapshot) : buildCtSnapshot(ret as unknown as Record<string, unknown>);
      amendmentDifferences = diffBoxes((baseRef.filing.snapshot as CtSnapshot).boxes, current.boxes);
    }
  }
  return {
    ...base,
    return: overlayCtSnapshot(ret as unknown as Record<string, unknown>, filing),
    isAmendment: ret.isAmendment,
    amendsReturnId: ret.amendsReturnId ?? null,
    amendsReference,
    amendmentDifferences,
    amendedBy: (ret.isAmendment ? [] : chain.filter((r) => r.isAmendment)).map((r) => ({
      id: r.id,
      status: r.status,
      filed: filings.has(r.id),
      referenceNumber: filings.get(r.id)?.referenceNumber ?? null,
    })),
  };
}

/** List overlay: filed returns show their snapshot; each row gets a small filing summary. */
export async function overlayCtReturns(rows: CorporateTaxReturn[]) {
  const filings = await filingsFor(rows);
  return rows.map((r) => {
    const filing = filings.get(r.id);
    return {
      ...overlayCtSnapshot(r as unknown as Record<string, unknown>, filing),
      filing: filing
        ? { id: filing.id, referenceNumber: filing.referenceNumber, filedAt: String(filing.filedAt).slice(0, 10), snapshotHash: filing.snapshotHash }
        : null,
    };
  });
}
