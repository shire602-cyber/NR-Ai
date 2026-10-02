// Issuing a credit note against an invoice (full reversal, partial credit, or the remainder).
//
// EXTRACTED from POST /api/companies/:companyId/invoices/:invoiceId/credit-note (invoices.routes.ts) in Phase 8 D1
// WITHOUT logic changes, so that other callers (advance refunds, gateway refunds) issue credit notes through the
// very same code: the only edits are `res.status(n).json(x)` -> `fail(n, x)` and the request body being a parameter.
// The route keeps authorisation, the original-invoice lookup and the audit entry.

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { storage } from "../storage";
import { db } from "../db";
import {
  invoices as invoicesTable,
  invoiceLines as invoiceLinesTable,
  journalEntries as journalEntriesTable,
  journalLines as journalLinesTable,
  type Invoice,
  type JournalEntry,
  type JournalLine,
} from "../../shared/schema";
import { withDocumentLock, LOCK_NS } from "./document-lock";
import { assertPeriodNotLocked } from "./period-lock.service";
import { evaluateCreditNoteRequest, buildReversalLines, selectVoidableEntries } from "./invoice-lifecycle";
import { checkRevenueAccountsForCompany } from "./revenue-account-guard.service";
import { checkProductsForCompany, creditNoteRestockTag, restockInvoiceInTx, restockRequestFromCreditLines } from "./inventory-costing.service";
import { allocateRevenueCredits } from "./revenue-allocation.service";
import { splitRevenueLegsByProject } from "./project-revenue-split";
import { deriveVatSupplyType } from "./vat-supply-type";
import { resolveInvoiceFx, toBaseCurrencyAmount } from "./invoice-fx";
import { normalizeUnitPrice } from "./document-line-limits";
import { syncInvoiceStatusFromBalance } from "./invoice-credit-status";
import { allocateInvoiceNumber } from "./invoice-numbering.service";
import {
  bucketLines,
  compareBuckets,
  effectiveRevenueAccountId,
  findBucketExcess,
  remainderBuckets,
  remainingByAccount,
  remainingLines,
  remainingVatBuckets,
  resolveCreditLineAccount,
  reverseToZero,
  type RevenueCtx,
} from "./credit-note-remainder.service";
import { ACCOUNT_CODES } from "../constants";
import { reverseApplicationsForInvoice } from "./advance-ledger.service";
import {
  MAX_DOCUMENT_TOTAL,
  calculateInvoiceTotals,
  creditNoteLineInputSchema,
  round2Num,
  type CreditNoteLineInput,
} from "./invoice-line-schemas";

export type JournalLineLike = Record<string, any> & {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
};

// Default / zero-rated income accounts of a chart: what a line with no revenue
// account of its own posts to (see invoice-posting.service). Undefined when the
// chart has no default revenue account.
export function revenueContextOf(
  accounts: Array<{ id: string; type: string; code: string; isSystemAccount?: boolean | null }>
): RevenueCtx | undefined {
  const defaultAccount = accounts.find(
    (a) =>
      a.isSystemAccount &&
      a.type === "income" &&
      (a.code === ACCOUNT_CODES.REVENUE || a.code === ACCOUNT_CODES.REVENUE_ALT)
  );
  if (!defaultAccount) return undefined;
  const zeroRated = accounts.find(
    (a) => a.type === "income" && a.code === ACCOUNT_CODES.ZERO_RATED_SALES
  );
  return { defaultAccountId: defaultAccount.id, zeroRatedAccountId: zeroRated?.id ?? null };
}

// Foreign-currency invoices keep the document-currency amount on the AR leg of
// a reversal, like the original posting did (the ledger amounts stay AED).
export function withForeignReceivable(
  lines: JournalLineLike[],
  receivableId: string,
  fx: { currency: string; rate: number; isForeign: boolean },
  docAmount: number
): JournalLineLike[] {
  if (!fx.isForeign) return lines;
  return lines.map((l) =>
    l.accountId === receivableId && l.credit > 0
      ? { ...l, foreignCurrency: fx.currency, exchangeRate: fx.rate, foreignCredit: docAmount }
      : l
  );
}


export interface CreditNoteFailure {
  ok: false;
  status: number;
  /** The JSON body the route answers with (message, code, and any detail fields). */
  body: Record<string, any>;
}
export interface CreditNoteCreated {
  ok: true;
  cnNumber: string;
  creditNote: Invoice;
}
export type CreditNoteResult = CreditNoteFailure | CreditNoteCreated;

const fail = (status: number, body: Record<string, any>): CreditNoteFailure => ({ ok: false, status, body });

/**
 * Issue a credit note for `original` (already loaded and authorised by the caller). `body` is the request
 * payload: optional `lines` (partial credit), `date`, `restock`.
 */
export async function issueCreditNote(args: {
  companyId: string;
  invoiceId: string;
  original: Invoice;
  userId: string;
  body: any;
  /** Only refundAdvance sets this: an advance tax invoice is credited through the advance refund, never directly. */
  viaAdvanceRefund?: boolean;
}): Promise<CreditNoteResult> {
  const { companyId, invoiceId, original, userId, body } = args;

  // An advance is paid back through POST /customer-advances/:id/refund, which reserves the amount against the advance
  // sub-ledger. A bare credit note would reverse 2055 and VAT without it, so 2055 would no longer tie to the advances.
  if (original.invoiceType === "advance" && !args.viaAdvanceRefund) {
    return fail(409, {
      message: "An advance tax invoice cannot be credited directly. Refund the advance instead.",
      code: "ADVANCE_USE_REFUND",
    });
  }

  // An opening-balance invoice recognised no revenue or VAT (it is inside the opening
  // balances), so a credit note would reverse amounts that never posted.
  if ((original as any).isOpeningBalance) {
    return fail(409, {
      message:
        "This invoice was entered as an opening balance and has no revenue or VAT posting to reverse. Record a customer credit or reverse the opening balances instead.",
      code: "OPENING_BALANCE_INVOICE",
    });
  }

  // A credit note reverses revenue that was RECOGNISED. A draft was never
  // posted, and a void / cancelled invoice was already reversed in full:
  // crediting either would debit revenue and VAT that never stood on the
  // ledger. (A credit note of a credit note keeps its own CN_OF_CN error.)
  if (
    original.invoiceType !== "credit_note" &&
    (original.status === "draft" || original.status === "void" || original.status === "cancelled")
  ) {
    return fail(409, {
      message: `Cannot issue a credit note for a ${original.status} invoice: it has no posted journal entry to reverse.`,
      code: "INVOICE_NOT_POSTED",
    });
  }

  // PARTIAL CREDIT NOTES.
  //
  // Previously this endpoint accepted a `lines` payload and silently threw
  // it away, always crediting the FULL original. Asking to credit 400 of a
  // 1,050 invoice returned 201 with a credit note for 1,050 — reversing all
  // the output VAT when only part of the supply was returned, which
  // UNDER-DECLARES VAT to the FTA.
  //
  // Now: supply `lines` to credit exactly those lines; omit them for a full
  // reversal (the UI sends `{}` and keeps that behaviour). The amount is
  // capped against the remaining uncredited balance below.
  const requestedLines = body?.lines;
  // Phase 8 D1: an invoice that deducted a customer advance can only be credited in full (or voided): a partial
  // credit would have to split the deduction, and the advance sub-ledger must tie to account 2055.
  const carriesAdvance =
    (
      await db
        .select({ id: invoiceLinesTable.id })
        .from(invoiceLinesTable)
        .where(and(eq(invoiceLinesTable.invoiceId, invoiceId), eq(invoiceLinesTable.lineKind, "advance")))
        .limit(1)
    ).length > 0;
  if (carriesAdvance && requestedLines !== undefined && requestedLines !== null) {
    return fail(422, {
      message:
        "This invoice deducted a customer advance, so it can only be credited in full. Omit `lines` to credit it entirely, or void it.",
      code: "ADVANCE_APPLIED_PARTIAL_CREDIT",
    });
  }
  let creditLines: CreditNoteLineInput[] | null = null;
  let creditAmounts: { subtotal: number; vatAmount: number; total: number } | null = null;
  if (requestedLines !== undefined && requestedLines !== null) {
    if (!Array.isArray(requestedLines) || requestedLines.length === 0) {
      return fail(422, {
        message: "Credit note `lines` must be a non-empty array. Omit it entirely to credit the full invoice.",
        code: "INVALID_CREDIT_LINES",
      });
    }
    creditLines = z.array(creditNoteLineInputSchema).parse(requestedLines);
    const creditRevenueCheck = await checkRevenueAccountsForCompany(
      companyId,
      creditLines.map((l) => l.revenueAccountId)
    );
    if (!creditRevenueCheck.ok) {
      return fail(creditRevenueCheck.status, { message: creditRevenueCheck.message, code: creditRevenueCheck.code });
    }
    const creditProductCheck = await checkProductsForCompany(companyId, creditLines.map((l) => l.productId));
    if (!creditProductCheck.ok) {
      return fail(creditProductCheck.status, { message: creditProductCheck.message, code: creditProductCheck.code });
    }
    creditAmounts = calculateInvoiceTotals(creditLines);
    if (!Number.isFinite(creditAmounts.total) || Math.abs(creditAmounts.total) > MAX_DOCUMENT_TOTAL) {
      return fail(422, {
        message: `Credit note total is too large to record (limit ${MAX_DOCUMENT_TOTAL.toLocaleString()}).`,
        code: "AMOUNT_OUT_OF_RANGE",
      });
    }
  }

  // The invoice's own currency and rate: the credit note is stored in the
  // same currency at the SAME rate, and the reversing journal is posted in
  // AED at that rate (never in document currency).
  const fx = resolveInvoiceFx(original);

  // A-B3: de-duplicate and cap credit notes. Without this, issuing two full
  // credit notes double-reverses AR and drives it negative. We sum the
  // absolute totals of any existing credit notes for this invoice and
  // refuse to credit beyond the original total.
  // Concurrency: the cap below is a check-then-write. Five parallel credit
  // notes each read "nothing credited yet" and all five posted, crediting
  // one invoice 5x and driving A/R negative. Serialise per invoice so the
  // cap is evaluated against committed state.
  // Everything below that does NOT depend on the locked state is read BEFORE
  // the transaction opens (same pattern as invoice-void.service). Inside the
  // lock every read goes through the transaction's own connection: with
  // DB_POOL_MAX connections, N waiting requests each hold one for their
  // transaction, so a lock holder that reached for a second pool connection
  // to read starved the pool and deadlocked the whole app.
  // TD5: honour a caller-supplied credit-note date (previously silently
  // ignored — CNs were always stamped "today", so a CN belonging to the
  // period being filed could never enter that period's VAT 201 or P&L).
  // Future dates are refused like invoices; the period lock is checked
  // against the ACTUAL document date.
  let cnDate = new Date();
  const requestedCnDate = body?.date;
  if (requestedCnDate !== undefined && requestedCnDate !== null) {
    const parsed = new Date(requestedCnDate);
    if (isNaN(parsed.getTime())) {
      return fail(422, {
        message: "Credit note `date` is not a valid date.",
        code: "INVALID_CREDIT_NOTE_DATE",
      });
    }
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (parsed > tomorrow) {
      return fail(422, {
        message: "Credit note `date` cannot be in the future.",
        code: "CREDIT_NOTE_DATE_IN_FUTURE",
      });
    }
    cnDate = parsed;
  }
  await assertPeriodNotLocked(companyId, cnDate);

  // A-B2 / defect 9: EVERYTHING that can reject the credit note (accounts,
  // revenue split, balance) is computed here, BEFORE any row is written.
  // The document and its journal entry are then inserted in one
  // transaction, so a failure can no longer leave an orphan credit note
  // (with a consumed number) and no journal entry.
  const cnAccounts = await storage.getAccountsByCompanyId(companyId);
  const cnReceivable = cnAccounts.find(
    (a) => a.code === ACCOUNT_CODES.AR && a.isSystemAccount
  );
  const cnVatPayable = cnAccounts.find(
    (a) => a.isVatAccount && a.vatType === "output" && a.code === ACCOUNT_CODES.VAT_OUTPUT
  );
  const revenueCtx = revenueContextOf(cnAccounts);
  if (!revenueCtx || !cnReceivable) {
    return fail(422, {
      message:
        "Cannot post reversal: Accounts Receivable or Revenue account is missing. Seed the default chart of accounts first.",
      code: "CHART_OF_ACCOUNTS_MISSING",
    });
  }

  const originalLines = await storage.getInvoiceLinesByInvoiceId(invoiceId);

  const outcome = await withDocumentLock(invoiceId, LOCK_NS.CREDIT_NOTE, async (lockTx: typeof db) => {
  const creditNotesOfInvoice: Invoice[] = await lockTx
    .select()
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.companyId, companyId),
        eq(invoicesTable.originalInvoiceId, invoiceId),
        eq(invoicesTable.invoiceType, "credit_note")
      )
    );
  const existingCreditNotes = creditNotesOfInvoice.filter(
    (i) => i.status !== "void" && i.status !== "cancelled"
  );
  const alreadyCreditedTotal = existingCreditNotes.reduce(
    (sum, i) => sum + Math.abs(Number(i.total)),
    0
  );
  const cnDecision = evaluateCreditNoteRequest({
    invoiceType: original.invoiceType ?? "invoice",
    originalTotal: Number(original.total),
    alreadyCreditedTotal,
    // Cap a partial credit at what is still uncreditable. Omitted (full
    // reversal) defaults to the whole remaining balance.
    requestedAmount: creditAmounts ? creditAmounts.total : undefined,
  });
  if (!cnDecision.ok) {
    return fail(cnDecision.status, { message: cnDecision.message, code: cnDecision.code });
  }



  // What is already on the ledger for this invoice (AED, as posted): its
  // own entry plus the entries of the credit notes issued so far.
  const originalEntries: JournalEntry[] = await lockTx
    .select()
    .from(journalEntriesTable)
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.source, "invoice"),
        eq(journalEntriesTable.sourceId, invoiceId)
      )
    );
  const originalEntry = selectVoidableEntries(originalEntries).original;
  if (!originalEntry) {
    // e.g. an invoice created before drafts stopped auto-posting, or one whose
    // entry was voided: there is nothing on the ledger to reverse.
    return fail(409, {
      message: "Cannot issue a credit note: this invoice has no posted journal entry to reverse.",
      code: "INVOICE_NOT_POSTED",
    });
  }
  const priorCreditNoteIds = existingCreditNotes.map((c) => c.id);
  const priorEntries: JournalEntry[] =
    priorCreditNoteIds.length > 0
      ? await lockTx
          .select()
          .from(journalEntriesTable)
          .where(
            and(
              eq(journalEntriesTable.companyId, companyId),
              eq(journalEntriesTable.source, "invoice"),
              inArray(journalEntriesTable.sourceId, priorCreditNoteIds)
            )
          )
      : [];
  const priorEntryIds: string[] = priorEntries.filter((e) => e.status === "posted").map((e) => e.id);
  const entryIdsForLedger = [originalEntry.id, ...priorEntryIds];
  const ledgerSourceLines: JournalLine[] = originalEntry
    ? await lockTx
        .select()
        .from(journalLinesTable)
        .where(inArray(journalLinesTable.entryId, entryIdsForLedger))
    : [];
  const ledgerLines = originalEntry
    ? ledgerSourceLines.map((l) => ({
        accountId: l.accountId,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        projectId: (l as any).projectId ?? null,
      }))
    : [];
  const existingCreditLines =
    priorCreditNoteIds.length > 0
      ? await lockTx
          .select()
          .from(invoiceLinesTable)
          .where(inArray(invoiceLinesTable.invoiceId, priorCreditNoteIds))
      : [];

  // The credit note lines, each carrying the revenue account it reverses.
  //
  // INVARIANT: the document lines must always agree with what the journal
  // reverses, per VAT rate / supply type and per revenue account, because
  // the VAT engines read the document lines while the ledger is reversed
  // from the journal. So:
  //  * a credit note that brings the invoice to fully credited (explicit
  //    full credit, omitted lines, or a final partial) gets its lines BUILT
  //    from what is left of each original line; lines the client sent must
  //    match that remainder bucket for bucket (else 422);
  //  * a partial one is capped per VAT bucket, not only per account.
  let creditSubtotal: number;
  let creditVat: number;
  let creditTotal: number;
  let docLines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    vatSupplyType: string;
    revenueAccountId: string;
    lineKind?: string;
    /** Phase 8 D2: the project of the original line(s) this credit takes back (project revenue falls with it). */
    projectId?: string | null;
  }>;
  let bringsToFullyCredited: boolean;
  const creditWasCapped = !creditLines && existingCreditNotes.length > 0;

  let resolvedCreditLines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    vatRate: number;
    vatSupplyType: string;
    revenueAccountId: string;
    projectId?: string | null;
  }> | null = null;
  if (creditLines) {
    const resolved: Array<{ accountId: string }> = [];
    for (const l of creditLines) {
      const r = resolveCreditLineAccount(l, originalLines as any[], revenueCtx);
      if (!r.ok) return fail(400, { message: r.message, code: r.code });
      resolved.push({ accountId: r.accountId });
    }
    creditSubtotal = creditAmounts!.subtotal;
    creditVat = creditAmounts!.vatAmount;
    creditTotal = creditAmounts!.total;
    resolvedCreditLines = creditLines.map((l, i) => {
      // A line that names the original line it credits takes that line's
      // supply type (a 0% exempt sale is credited as exempt, not zero-rated).
      const named = l.originalLineId
        ? (originalLines as any[]).find((o) => o.id === l.originalLineId)
        : undefined;
      const supply =
        named && Number(named.vatRate) === Number(l.vatRate)
          ? deriveVatSupplyType(Number(named.vatRate), named.vatSupplyType)
          : l.vatSupplyType;
      return {
        description: `[Credit] ${l.description}`,
        quantity: -l.quantity,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
        vatSupplyType: supply,
        revenueAccountId: resolved[i].accountId,
        projectId: (named as any)?.projectId ?? null,
      };
    });
    bringsToFullyCredited =
      round2Num(alreadyCreditedTotal + creditTotal) >= round2Num(Math.abs(Number(original.total))) - 0.005;
  } else {
    bringsToFullyCredited = true;
  }

  if (bringsToFullyCredited) {
    if (resolvedCreditLines) {
      const expected = remainderBuckets({
        originalLines: originalLines as any[],
        creditedLines: existingCreditLines as any[],
        ctx: revenueCtx,
      });
      const supplied = bucketLines(resolvedCreditLines as any[], revenueCtx, { byAccount: true });
      const match = compareBuckets(expected, supplied);
      if (!match.ok) {
        return fail(422, {
          message:
            "This credit note takes the invoice to fully credited, but its lines do not match what is left of the invoice per VAT rate, supply type and revenue account. Credit exactly the remaining lines, or omit `lines` to credit the remainder.",
          code: "CREDIT_NOTE_LINES_MISMATCH",
          expectedBuckets: match.expected,
          suppliedBuckets: match.supplied,
        });
      }
    }
    const originalAbs = Math.abs(Number(original.total));
    if (existingCreditNotes.length === 0) {
      // Nothing credited yet: mirror every original line.
      creditSubtotal = Number(original.subtotal);
      creditVat = Number(original.vatAmount);
      creditTotal = Number(original.total);
      docLines = originalLines.map((l) => ({
        description: `[Credit] ${l.description}`,
        quantity: -Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        vatRate: Number(l.vatRate),
        vatSupplyType: deriveVatSupplyType(Number(l.vatRate), l.vatSupplyType),
        revenueAccountId: effectiveRevenueAccountId(l as any, revenueCtx),
        // Phase 8 D1: a discount / shipping / advance line is credited as the same kind of line.
        lineKind: l.lineKind || "item",
        projectId: (l as any).projectId ?? null,
      }));
    } else {
      // TD4 / defect 3: credit exactly what is LEFT, per line and per
      // account - not the original scaled by one factor, which reversed
      // the wrong accounts whenever an earlier partial credit note had
      // touched only some of them.
      const left = remainingLines({
        originalLines: originalLines as any[],
        creditedLines: existingCreditLines as any[],
        ctx: revenueCtx,
      });
      creditTotal = round2Num(originalAbs - round2Num(alreadyCreditedTotal));
      const leftAccounts = remainingByAccount({
        originalLines: originalLines as any[],
        creditedLines: existingCreditLines as any[],
        ctx: revenueCtx,
      });
      creditSubtotal = round2Num(leftAccounts.accounts.reduce((s, a) => s + a.net, 0));
      // Derive VAT from the difference so subtotal + VAT = total exactly.
      creditVat = round2Num(creditTotal - creditSubtotal);
      docLines = left.map((l) => ({
        description: `[Credit] ${l.description} (remaining balance)`,
        quantity: -1,
        unitPrice: normalizeUnitPrice(l.net),
        vatRate: l.vatRate,
        vatSupplyType: deriveVatSupplyType(l.vatRate, l.vatSupplyType),
        revenueAccountId: l.revenueAccountId,
        lineKind: ((originalLines as any[]).find((o) => o.id === l.originalLineId)?.lineKind as string | undefined) || "item",
        projectId: ((originalLines as any[]).find((o) => o.id === l.originalLineId)?.projectId as string | null | undefined) ?? null,
      }));
    }
  } else {
    // Partial: cap per VAT bucket (rate + supply type) - "no more at 5%
    // than remains at 5%" - on top of the per-account cap on the ledger.
    docLines = resolvedCreditLines!;
    const excess = findBucketExcess(
      remainingVatBuckets({
        originalLines: originalLines as any[],
        creditedLines: existingCreditLines as any[],
        ctx: revenueCtx,
      }),
      bucketLines(docLines as any[], revenueCtx)
    );
    if (excess) {
      return fail(409, {
        message: `This credit note takes back more at ${Math.round(excess.vatRate * 10000) / 100}% (${excess.supplyType.replace("_", " ")}) than remains on the invoice at that VAT rate after the earlier credit notes.`,
        code: "CREDIT_EXCEEDS_VAT_BUCKET",
        bucket: excess,
      });
    }
  }

  // Phase 8 D2: each credit line takes the project of the original line(s) feeding its revenue account (when they
  // all share one), so the reversing legs and the credit note's own lines keep the project.
  {
    const projectByAccount = new Map<string, string | null>();
    const ambiguous = new Set<string>();
    for (const o of originalLines as any[]) {
      const account = effectiveRevenueAccountId(o, revenueCtx);
      const project: string | null = o.projectId ?? null;
      if (projectByAccount.has(account) && projectByAccount.get(account) !== project) ambiguous.add(account);
      else projectByAccount.set(account, project);
    }
    docLines = docLines.map((l) => ({
      ...l,
      projectId: l.projectId ?? (ambiguous.has(l.revenueAccountId) ? null : projectByAccount.get(l.revenueAccountId) ?? null),
    }));
  }

  // The reversing legs, in AED. The final credit note reverses what is
  // actually standing on the ledger (posted minus already reversed), so
  // AR, revenue and VAT each land on exactly 0.00 whatever the FX rate and
  // rounding. A partial one converts its own amounts at the invoice rate.
  const reversalLabels = (cnNumber: string) => ({
    revenue: `Reverse revenue - ${cnNumber}`,
    vat: `Reverse VAT - ${cnNumber}`,
    ar: `Reduce A/R - ${cnNumber}`,
  });
  const buildLegs = (
    cnNumber: string
  ):
    | { ok: true; lines: JournalLineLike[]; baseSubtotal: number; baseVat: number; baseTotal: number }
    | { ok: false; status: number; code: string; message: string } => {
    const labels = reversalLabels(cnNumber);
    if (bringsToFullyCredited && ledgerLines.length > 0) {
      const legs = reverseToZero(ledgerLines, {
        arAccountId: cnReceivable.id,
        vatAccountId: cnVatPayable?.id ?? null,
        labels,
      });
      if (legs.length === 0) {
        return {
          ok: false,
          status: 409,
          code: "FULLY_CREDITED",
          message: "This invoice has already been fully credited.",
        };
      }
      const baseTotal = legs.filter((l) => l.accountId === cnReceivable.id).reduce((s, l) => s + l.credit, 0);
      const baseVat = legs.filter((l) => l.accountId === cnVatPayable?.id).reduce((s, l) => s + l.debit, 0);
      return {
        ok: true,
        lines: withForeignReceivable(legs, cnReceivable.id, fx, creditTotal),
        baseTotal: round2Num(baseTotal),
        baseVat: round2Num(baseVat),
        baseSubtotal: round2Num(baseTotal - baseVat),
      };
    }

    const baseSubtotal = toBaseCurrencyAmount(creditSubtotal, fx.rate);
    const baseVat = toBaseCurrencyAmount(creditVat, fx.rate);
    const built = buildReversalLines({
      amounts: { subtotal: baseSubtotal, vatAmount: baseVat, total: round2Num(baseSubtotal + baseVat) },
      accounts: {
        accountsReceivableId: cnReceivable.id,
        salesRevenueId: revenueCtx.defaultAccountId,
        vatPayableId: cnVatPayable?.id,
      },
      revenueSplit: allocateRevenueCredits({
        lines: docLines.map((l) => ({
          quantity: Math.abs(l.quantity),
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
          revenueAccountId: l.revenueAccountId,
        })),
        rate: fx.rate,
        subtotal: baseSubtotal,
        defaultAccountId: revenueCtx.defaultAccountId,
        zeroRatedAccountId: revenueCtx.zeroRatedAccountId ?? null,
      }),
      labels,
    });
    if (!built.ok) return built;
    // The revenue legs are split by project, in proportion to the credit lines' nets.
    const projectLegs = splitRevenueLegsByProject(
      built.lines as any[],
      docLines.map((l) => ({ quantity: Math.abs(l.quantity), unitPrice: l.unitPrice, vatRate: l.vatRate, revenueAccountId: l.revenueAccountId, projectId: l.projectId ?? null })),
      { defaultAccountId: revenueCtx.defaultAccountId, zeroRatedAccountId: revenueCtx.zeroRatedAccountId ?? null }
    );
    built.lines = projectLegs as typeof built.lines;

    // A partial credit note cannot take back more from an account (or from
    // VAT) than is still standing on it.
    if (ledgerLines.length > 0) {
      const standing = new Map<string, number>();
      for (const l of reverseToZero(ledgerLines, { arAccountId: cnReceivable.id, vatAccountId: cnVatPayable?.id ?? null, labels })) {
        standing.set(l.accountId, (standing.get(l.accountId) ?? 0) + l.debit);
      }
      const takenBack = new Map<string, number>();
      for (const leg of built.lines) takenBack.set(leg.accountId, (takenBack.get(leg.accountId) ?? 0) + leg.debit);
      for (const leg of built.lines) {
        if (leg.debit > 0 && (takenBack.get(leg.accountId) ?? 0) > (standing.get(leg.accountId) ?? 0) + 0.01) {
          return {
            ok: false,
            status: 409,
            code: "CREDIT_EXCEEDS_ACCOUNT_BALANCE",
            message:
              "This credit note would credit more to a revenue account (or to VAT) than is still standing on it after the earlier credit notes.",
          };
        }
      }
    }
    return {
      ok: true,
      lines: withForeignReceivable(built.lines, cnReceivable.id, fx, creditTotal),
      baseSubtotal,
      baseVat,
      baseTotal: round2Num(baseSubtotal + baseVat),
    };
  };

  const preflight = buildLegs("(pending)");
  if (!preflight.ok) {
    return fail(preflight.status, { message: preflight.message, code: preflight.code });
  }

  // Allocate the credit-note number, insert the credit note + its lines
  // AND post its reversing journal entry in ONE transaction: gap-free
  // numbering (FTA) and a document that can never exist without its entry.
  const insertCreditNote = async (tx: typeof db) => {
    const number = await allocateInvoiceNumber(companyId, "credit_note", new Date(), tx);
    const legs = buildLegs(number);
    if (!legs.ok) {
      const e: any = new Error(legs.message);
      e.code = legs.code;
      throw e;
    }

    const [insertedCreditNote] = await tx
      .insert(invoicesTable)
      .values({
        companyId,
        number,
        customerName: original.customerName,
        // The credit note belongs to the same customer contact, so statements and refunds find it.
        contactId: original.contactId ?? null,
        customerTrn: original.customerTrn || undefined,
        date: cnDate,
        currency: original.currency,
        // VAT 201 converts every invoice row (credit notes included) with
        // its own stored rate: a foreign-currency credit note must carry
        // the original invoice's rate or it is counted as if it were AED.
        exchangeRate: fx.rate,
        baseCurrencyAmount: -legs.baseTotal,
        subtotal: -creditSubtotal,
        vatAmount: -creditVat,
        total: -creditTotal,
        status: "sent",
        invoiceType: "credit_note",
        originalInvoiceId: invoiceId,
      } as any)
      .returning();

    for (const line of docLines) {
      await tx.insert(invoiceLinesTable).values({
        invoiceId: insertedCreditNote.id,
        ...line,
      } as any);
    }

    await storage.createJournalEntry(
      {
        companyId,
        date: cnDate,
        memo:
          creditLines || creditWasCapped
            ? `Credit Note ${number} - partial credit of Invoice ${original.number}`
            : `Credit Note ${number} - reversal of Invoice ${original.number}`,
        entryNumber: "PENDING", // assigned inside the transaction
        status: "posted",
        source: "invoice",
        sourceId: insertedCreditNote.id,
        reversedEntryId: originalEntry?.id || null,
        reversalReason: "Credit note issued",
        createdBy: userId,
        postedBy: userId,
        postedAt: cnDate,
      } as any,
      legs.lines as any,
      { tx }
    );

    // The credit note reduces what the customer owes: a fully credited,
    // unpaid invoice becomes 'credited'; credit + payments that settle it
    // make it 'paid'.
    await syncInvoiceStatusFromBalance(tx, companyId, invoiceId);
    // The credit note re-credited 2055: the advances it had deducted are available again.
    if (carriesAdvance) await reverseApplicationsForInvoice(tx, companyId, invoiceId);

    // Restocking credit note: only with `restock: true` does the stock come back (and COGS
    // reverse) - the goods are not assumed to be returned otherwise. Explicit credit lines
    // restock the products of the original lines they name (`originalLineId`), whole or
    // part quantities up to what was sold and not yet returned; a full credit note
    // (no `lines`) restocks everything still out.
    if (body?.restock === true) {
      await restockInvoiceInTx(tx, {
        invoice: original as any,
        userId,
        requested: restockRequestFromCreditLines(creditLines, originalLines as any[]),
        reversalDate: cnDate,
        postedAt: cnDate,
        source: { id: insertedCreditNote.id, label: `Credit Note ${number}` },
        reason: "Credit note restock",
        movementNotes: creditNoteRestockTag(insertedCreditNote.id),
      });
    }

    return { cnNumber: number, creditNote: insertedCreditNote };
  };
  const { cnNumber, creditNote } = await insertCreditNote(lockTx);

  return { created: { cnNumber, creditNote } };
  }); // end withDocumentLock

  // Non-success paths returned their failure from inside the lock.
  if (!outcome || !("created" in outcome)) return outcome as CreditNoteFailure;
  return { ok: true, cnNumber: outcome.created.cnNumber, creditNote: outcome.created.creditNote };
}
