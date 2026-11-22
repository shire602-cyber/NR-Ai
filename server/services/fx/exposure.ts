/**
 * Unrealised FX exposure (R14-04): remeasure OUTSTANDING balances of POSTED
 * foreign-currency documents at the as-of rate.
 *
 * - Receivables: invoices (not drafts, voids, cancellations or credit notes) that have a posted
 *   `invoice` journal entry; outstanding = total - settlements dated on/before as-of (payments,
 *   issued credit notes and applied customer credits: the one rule in
 *   server/reporting/settlement.ts, D5c).
 * - Payables: vendor bills with a posted `bill` journal entry; outstanding = A/P amount
 *   (subtotal for reverse-charge bills, else total) - bill payments (incl. debit-note and
 *   prepayment applications) dated on/before as-of.
 * - Bank: active foreign-currency bank accounts with a GL link; the foreign balance and book
 *   value come from posted journal lines tagged with that currency on the linked GL account.
 *
 * Book value uses the document's own rate (the rate its journal was posted at). Gains are
 * positive: a receivable or bank balance gains when its base-currency value rises, a payable
 * gains when its base-currency cost falls. All amounts are integer fils.
 */
import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import type { LedgerTx } from "../../ledger/types";
import { mulRate, RATE_DECIMALS, sumFils, toFils, filsToNumber } from "../../../shared/money";
import { DomainError } from "../../errors";
import { addDaysIso, getCompanyBaseCurrency, getRate, isoToDate, type RateResult } from "./rates";
import type { ExchangeRateType } from "../../../shared/schema";
import { payableSettledSql, receivableSettledSql } from "../../reporting/settlement";

export type ExposureKind = "receivable" | "payable" | "bank";

export interface ExposureItem {
  kind: ExposureKind;
  entityType: "invoice" | "bill" | "bank_account";
  entityId: string;
  entityNumber: string;
  counterparty: string;
  currency: string;
  /** Outstanding foreign amount (fils of the foreign currency). */
  foreignFils: number;
  /** GL account the adjustment posts to (bank accounts only). */
  accountId: string | null;
  transactionRate: string;
  currentRate: string;
  bookFils: number;
  currentFils: number;
  gainLossFils: number;
  rateDate: string;
  rateSource: string;
  stale: boolean;
}

export interface MissingRate {
  currency: string;
  entityType: ExposureItem["entityType"];
  entityId: string;
}

export interface FxExposure {
  asOf: string;
  baseCurrency: string;
  rateType: ExchangeRateType;
  items: ExposureItem[];
  missingRates: MissingRate[];
  warnings: string[];
  totals: {
    receivableFils: number;
    payableFils: number;
    bankFils: number;
    gainFils: number;
    lossFils: number;
    netFils: number;
  };
}

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => ((r as { rows?: Row[] }).rows ?? (r as Row[])) as Row[];

const fils = (v: unknown): number =>
  v === null || v === undefined ? 0 : toFils(String(v), { rounding: "halfUp" });

const rateText = (v: unknown): string => {
  const d = new Decimal(v === null || v === undefined || v === "" ? 0 : String(v));
  return (d.gt(0) ? d : new Decimal(1)).toDecimalPlaces(RATE_DECIMALS).toFixed(RATE_DECIMALS);
};

export interface ExposureOptions {
  rateType?: ExchangeRateType;
  maxAgeDays?: number;
}

export async function computeFxExposure(
  companyId: string,
  asOfIso: string,
  opts: ExposureOptions = {},
  tx: LedgerTx = db
): Promise<FxExposure> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfIso) || Number.isNaN(isoToDate(asOfIso).getTime())) {
    throw new DomainError("INVALID_DATE", 400, { asOf: asOfIso });
  }
  const base = await getCompanyBaseCurrency(companyId, tx);
  const rateType: ExchangeRateType = opts.rateType ?? "closing";
  const end = isoToDate(addDaysIso(asOfIso, 1));
  // The one settlement rule (D5c): payments, credit notes and applied credits up to asOf.
  // asOfIso is validated above as YYYY-MM-DD, so it is safe as a literal.
  const asOfSql = { asOf: `'${asOfIso}'::date` };

  const invoiceRows = rowsOf(
    await tx.execute(sql`
      SELECT i.id, i.number, i.customer_name, i.currency, i.total, i.exchange_rate,
             ${sql.raw(receivableSettledSql("i", asOfSql))} AS paid
        FROM invoices i
       WHERE i.company_id = ${companyId}
         AND UPPER(i.currency) <> ${base}
         AND i.status NOT IN ('draft', 'void', 'cancelled')
         AND COALESCE(i.invoice_type, 'invoice') <> 'credit_note'
         AND i.date < ${end}
         AND EXISTS (SELECT 1 FROM journal_entries je
                      WHERE je.company_id = i.company_id AND je.source = 'invoice'
                        AND je.source_id = i.id AND je.status = 'posted')
       ORDER BY i.date, i.number`)
  );

  const billRows = rowsOf(
    await tx.execute(sql`
      SELECT b.id, b.bill_number, b.vendor_name, b.currency, b.total_amount, b.subtotal,
             b.reverse_charge, b.exchange_rate,
             ${sql.raw(payableSettledSql("b", asOfSql))} AS paid
        FROM vendor_bills b
       WHERE b.company_id = ${companyId}
         AND UPPER(COALESCE(b.currency, ${base})) <> ${base}
         AND COALESCE(b.status, 'pending') NOT IN ('draft', 'void', 'cancelled', 'rejected')
         AND b.bill_date < ${end}
         AND EXISTS (SELECT 1 FROM journal_entries je
                      WHERE je.company_id = b.company_id AND je.source = 'bill'
                        AND je.source_id = b.id AND je.status = 'posted')
       ORDER BY b.bill_date, b.id`)
  );

  const bankRows = rowsOf(
    await tx.execute(sql`
      SELECT ba.id, ba.name_en, ba.bank_name, ba.currency, ba.gl_account_id,
             COALESCE(SUM(COALESCE(jl.foreign_debit, 0) - COALESCE(jl.foreign_credit, 0)), 0) AS foreign_balance,
             COALESCE(SUM(jl.debit - jl.credit), 0) AS book_balance
        FROM bank_accounts ba
        JOIN accounts a ON a.id = ba.gl_account_id AND a.company_id = ba.company_id
        JOIN journal_lines jl ON jl.account_id = ba.gl_account_id
                             AND UPPER(jl.foreign_currency) = UPPER(ba.currency)
        JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted'
                               AND je.company_id = ba.company_id AND je.date < ${end}
       WHERE ba.company_id = ${companyId}
         AND ba.is_active = true
         AND UPPER(ba.currency) <> ${base}
       GROUP BY ba.id, ba.name_en, ba.bank_name, ba.currency, ba.gl_account_id
       ORDER BY ba.name_en`)
  );

  const rateCache = new Map<string, RateResult | null>();
  const warnings = new Set<string>();
  const rateFor = async (currency: string): Promise<RateResult | null> => {
    const cur = currency.toUpperCase();
    if (rateCache.has(cur)) return rateCache.get(cur) ?? null;
    let r: RateResult | null = null;
    try {
      r = await getRate(
        companyId,
        cur,
        base,
        asOfIso,
        {
          rateType,
          maxAgeDays: opts.maxAgeDays,
        },
        tx
      );
      if (r.warning) warnings.add(r.warning);
    } catch (err) {
      if (!(err instanceof DomainError) || err.code !== "NO_EXCHANGE_RATE") throw err;
      warnings.add(`No ${cur}→${base} rate on or before ${asOfIso}; ${cur} balances were skipped.`);
    }
    rateCache.set(cur, r);
    return r;
  };

  const items: ExposureItem[] = [];
  const missingRates: MissingRate[] = [];

  const push = async (
    kind: ExposureKind,
    entityType: ExposureItem["entityType"],
    id: string,
    number: string,
    counterparty: string,
    currency: string,
    foreignFils: number,
    txRate: string,
    accountId: string | null,
    bookOverride?: number
  ) => {
    if (foreignFils === 0) return;
    const r = await rateFor(currency);
    if (!r) {
      missingRates.push({ currency: currency.toUpperCase(), entityType, entityId: id });
      return;
    }
    const sign = foreignFils < 0 ? -1 : 1;
    const bookFils = bookOverride ?? sign * mulRate(Math.abs(foreignFils), txRate);
    const currentFils = sign * mulRate(Math.abs(foreignFils), r.rateText);
    const gainLossFils = kind === "payable" ? bookFils - currentFils : currentFils - bookFils;
    items.push({
      kind,
      entityType,
      entityId: id,
      entityNumber: number,
      counterparty,
      currency: currency.toUpperCase(),
      foreignFils,
      accountId,
      transactionRate: txRate,
      currentRate: r.rateText,
      bookFils,
      currentFils,
      gainLossFils,
      rateDate: r.date,
      rateSource: r.source,
      stale: r.stale,
    });
  };

  for (const inv of invoiceRows) {
    const outstanding = fils(inv.total) - fils(inv.paid);
    if (outstanding <= 0) continue;
    await push(
      "receivable",
      "invoice",
      String(inv.id),
      String(inv.number ?? ""),
      String(inv.customer_name ?? ""),
      String(inv.currency),
      outstanding,
      rateText(inv.exchange_rate),
      null
    );
  }

  for (const bill of billRows) {
    const apAmount = bill.reverse_charge === true ? fils(bill.subtotal) : fils(bill.total_amount);
    const outstanding = apAmount - fils(bill.paid);
    if (outstanding <= 0) continue;
    await push(
      "payable",
      "bill",
      String(bill.id),
      String(bill.bill_number ?? String(bill.id).slice(0, 8)),
      String(bill.vendor_name ?? ""),
      String(bill.currency),
      outstanding,
      rateText(bill.exchange_rate),
      null
    );
  }

  for (const bank of bankRows) {
    const foreignFils = fils(bank.foreign_balance);
    const bookFils = fils(bank.book_balance);
    if (foreignFils === 0) continue;
    const txRate = new Decimal(bookFils)
      .dividedBy(foreignFils)
      .abs()
      .toDecimalPlaces(RATE_DECIMALS)
      .toFixed(RATE_DECIMALS);
    await push(
      "bank",
      "bank_account",
      String(bank.id),
      String(bank.bank_name ?? ""),
      String(bank.name_en ?? ""),
      String(bank.currency),
      foreignFils,
      txRate,
      String(bank.gl_account_id),
      bookFils
    );
  }

  const sumKind = (k: ExposureKind) =>
    sumFils(items.filter((i) => i.kind === k).map((i) => i.gainLossFils));
  const gainFils = sumFils(items.filter((i) => i.gainLossFils > 0).map((i) => i.gainLossFils));
  const lossFils = sumFils(items.filter((i) => i.gainLossFils < 0).map((i) => i.gainLossFils));

  return {
    asOf: asOfIso,
    baseCurrency: base,
    rateType,
    items,
    missingRates,
    warnings: [...warnings],
    totals: {
      receivableFils: sumKind("receivable"),
      payableFils: sumKind("payable"),
      bankFils: sumKind("bank"),
      gainFils,
      lossFils,
      netFils: gainFils + lossFils,
    },
  };
}

/** Legacy report shape for /reports/fx-gains-losses (major units; payables include bills). */
export function toGainsLossesReport(exposure: FxExposure) {
  const row = (i: ExposureItem) => ({
    entityType: i.entityType === "invoice" ? "invoice" : i.entityType === "bill" ? "bill" : "bank",
    kind: i.kind,
    entityId: i.entityId,
    entityNumber: i.entityNumber,
    counterparty: i.counterparty,
    currency: i.currency,
    foreignAmount: filsToNumber(i.foreignFils),
    transactionRate: Number(i.transactionRate),
    currentRate: Number(i.currentRate),
    bookValueAed: filsToNumber(i.bookFils),
    currentValueAed: filsToNumber(i.currentFils),
    unrealizedGainLoss: filsToNumber(i.gainLossFils),
    rateDate: i.rateDate,
    stale: i.stale,
  });
  return {
    asOf: exposure.asOf,
    baseCurrency: exposure.baseCurrency,
    rateType: exposure.rateType,
    receivables: exposure.items.filter((i) => i.kind === "receivable").map(row),
    payables: exposure.items.filter((i) => i.kind === "payable").map(row),
    bankAccounts: exposure.items.filter((i) => i.kind === "bank").map(row),
    totalUnrealizedGain: filsToNumber(exposure.totals.gainFils),
    totalUnrealizedLoss: filsToNumber(exposure.totals.lossFils),
    netUnrealizedGainLoss: filsToNumber(exposure.totals.netFils),
    missingRates: exposure.missingRates,
    warnings: exposure.warnings,
  };
}
