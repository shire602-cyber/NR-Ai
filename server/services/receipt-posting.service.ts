/**
 * Receipt posting (W2-D: R05-02, R05-19b). Builds the balanced journal for a receipt (single
 * expense account or a multi-account split) in integer fils and posts it through
 * storage.postReceiptAtomic / reviseReceiptAtomic, which claim the receipt with a conditional
 * UPDATE inside the same ledger transaction as the server/ledger kernel post (postJournal) and
 * reversal (reverseBySource).
 */
import { type JournalLineKey, journalLine, journalMemo } from "@shared/journal-memo";
import { storage } from "../storage";
import {
  accounts as accountTable,
  receipts,
  type Account,
  type InsertJournalLine,
  type Receipt,
} from "../../shared/schema";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { DomainError } from "../errors";
import { filsToNumber, mulRate, sumFils, toFils } from "../../shared/money";
import {
  loadRecoveryRules,
  resolveRecovery,
  saveReceiptVatTreatment,
  type ReceiptVatTreatment,
} from "../tax/vat-recovery";
import { recoverableShare } from "../tax/vat-boxes";
import { SUPPLY_TYPES } from "../../shared/validators/primitives";
import { documentCurrency, loadBaseCurrency, withLedgerTx } from "../ledger";
import { has, resolve } from "../platform/service-registry";
import type { FxGetRate } from "./fx";
import { companyIsVatRegistered } from "../tax/vat-registration";

/** systemVat (B1: NC1): the VAT line this service derives; the kernel lets it sit on 1050 / 2020. */
type JournalLineInsert = Omit<InsertJournalLine, "entryId"> & { systemVat?: boolean };

interface Component {
  accountId: string;
  netFils: number;
  vatFils: number;
  costCenterId: string | null;
  description: string | null;
}

export interface ReceiptJournalPlan {
  entryDate: Date;
  memo: string;
  memoKey?: string;
  memoParams?: Record<string, string>;
  lines: JournalLineInsert[];
  expenseAccountId: string | null;
  exchangeRate: number;
  exchangeRateSource: "manual" | "lookup" | null;
  baseCurrencyAmount: number;
  /** W4-E: recoverable / blocked input-VAT split, persisted for the VAT engine. */
  vatTreatment: Omit<ReceiptVatTreatment, "receiptId" | "companyId">;
}

/** W4-E (R05-28): supply type of the receipt (or of each split line) chosen at posting. */
export interface ReceiptVatOptions {
  vatSupplyType?: string | null;
  lineSupplyTypes?: Array<string | null> | null;
}

const ZERO_VAT_TYPES = new Set(["zero_rated", "exempt", "out_of_scope"]);

function assertSupplyType(type: string, vatFils: number, index?: number): string {
  if (!(SUPPLY_TYPES as readonly string[]).includes(type)) {
    throw new DomainError("INVALID_SUPPLY_TYPE", 400, { index, type });
  }
  if (ZERO_VAT_TYPES.has(type) && vatFils > 0) {
    throw new DomainError(
      "SUPPLY_TYPE_RATE_MISMATCH",
      422,
      { index, type },
      `A ${type.replace(/_/g, "-")} purchase cannot carry VAT`
    );
  }
  return type;
}

function receiptEntryDate(receipt: Pick<Receipt, "date">): Date {
  const parsed = new Date(receipt.date ?? new Date());
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function assertAccountUsable(account: Account | undefined, kind: "expense" | "payment"): Account {
  if (!account) throw new DomainError("ACCOUNT_NOT_FOUND", 404, { kind });
  if (account.isArchived || !account.isActive) {
    throw new DomainError("ACCOUNT_INACTIVE", 409, { accountId: account.id });
  }
  if (kind === "expense" && account.type !== "expense") {
    throw new DomainError(
      "EXPENSE_ACCOUNT_REQUIRED",
      400,
      { accountId: account.id },
      "Selected account must be an expense account"
    );
  }
  if (kind === "payment" && account.type !== "asset") {
    throw new DomainError(
      "PAYMENT_ACCOUNT_REQUIRED",
      400,
      { accountId: account.id },
      "Payment account must be a cash or bank account (asset)"
    );
  }
  return account;
}

/** Manual quotes, including parity, override the stored spot rate for this document. */
export async function resolveReceiptRate(
  companyId: string,
  currency: string | null,
  date: Date,
  manual: number | null,
  tx = db,
  allowMissing = false
) {
  const baseCurrency = await loadBaseCurrency(companyId, tx);
  const receiptCurrency = documentCurrency(currency, baseCurrency);
  if (baseCurrency === receiptCurrency)
    return { receiptCurrency, baseCurrency, rate: 1, source: null };
  if (manual !== null)
    return { receiptCurrency, baseCurrency, rate: manual, source: "manual" as const };

  if (has("fx.getRate")) {
    try {
      const found = await resolve<FxGetRate>("fx.getRate")(
        companyId,
        receiptCurrency,
        baseCurrency,
        date.toISOString().slice(0, 10),
        { tx }
      );
      return { receiptCurrency, baseCurrency, rate: found.rate, source: "lookup" as const };
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "NO_EXCHANGE_RATE") throw error;
    }
  }
  if (allowMissing) return { receiptCurrency, baseCurrency, rate: null, source: null };
  throw new DomainError(
    "EXCHANGE_RATE_REQUIRED",
    400,
    undefined,
    "Foreign-currency receipt is missing a valid exchange rate"
  );
}

/**
 * Build the journal lines for `receipt`. Pure apart from account lookups. Lines are computed in
 * fils; the payment credit is the sum of the debits (less self-assessed output VAT), so the
 * entry balances exactly even after FX rounding.
 */
export async function planReceiptJournal(
  receipt: Receipt,
  opts: { expenseAccountId?: string | null; paymentAccountId: string; vat?: ReceiptVatOptions },
  tx = db
): Promise<ReceiptJournalPlan> {
  const accounts = await tx
    .select()
    .from(accountTable)
    .where(eq(accountTable.companyId, receipt.companyId));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const payment = assertAccountUsable(byId.get(opts.paymentAccountId), "payment");

  const amountFils = toFils(receipt.amount ?? 0);
  const vatTotalFils = toFils(receipt.vatAmount ?? 0);
  if (amountFils + vatTotalFils <= 0) {
    throw new DomainError(
      "RECEIPT_AMOUNT_INVALID",
      400,
      undefined,
      "Receipt amount must be greater than zero"
    );
  }

  let components: Component[];
  const splitLines = Array.isArray(receipt.lines) ? receipt.lines : [];
  if (splitLines.length > 0) {
    components = splitLines.map((l) => ({
      accountId: l.accountId,
      netFils: toFils(l.amount),
      vatFils: toFils(l.vatAmount ?? 0),
      costCenterId: l.costCenterId ?? null,
      description: l.description ?? null,
    }));
    if (
      sumFils(components.map((c) => c.netFils)) !== amountFils ||
      sumFils(components.map((c) => c.vatFils)) !== vatTotalFils
    ) {
      throw new DomainError(
        "RECEIPT_LINES_MISMATCH",
        409,
        undefined,
        "Receipt line amounts do not add up to the receipt total"
      );
    }
  } else {
    const expenseId = opts.expenseAccountId ?? receipt.accountId;
    if (!expenseId) {
      throw new DomainError(
        "EXPENSE_ACCOUNT_REQUIRED",
        400,
        undefined,
        "Expense account and payment account are required"
      );
    }
    components = [
      {
        accountId: expenseId,
        netFils: amountFils,
        vatFils: vatTotalFils,
        costCenterId: null,
        description: null,
      },
    ];
  }
  for (const c of components) assertAccountUsable(byId.get(c.accountId), "expense");

  const existingRate = Number(receipt.exchangeRate);
  const lockedRate = receipt.exchangeRateSource === "manual" || receipt.posted;
  const quoted = await resolveReceiptRate(
    receipt.companyId,
    receipt.currency,
    receiptEntryDate(receipt),
    lockedRate && existingRate > 0 ? existingRate : null,
    tx
  );
  const { receiptCurrency, baseCurrency } = quoted;
  const isForeign = receiptCurrency !== baseCurrency;
  const fxRate = quoted.rate!;
  const fxSource =
    receipt.posted && receipt.exchangeRateSource === "lookup" && quoted.source
      ? "lookup"
      : quoted.source;
  const toBase = (fils: number) => (isForeign ? mulRate(fils, fxRate) : fils);
  const merchant = receipt.merchant || "expense";
  const label = `${receipt.merchant || "Expense"} - ${receipt.category || "General"}`;
  // Line descriptions of the posting as keys (the shapes with no merchant name read "expense").
  const hasMerchant = !!receipt.merchant;
  const labelLine = journalLine(
    hasMerchant
      ? receipt.category
        ? "receiptLabel"
        : "receiptLabelNoCategory"
      : receipt.category
        ? "receiptLabelNoMerchant"
        : "receiptLabelBare",
    { merchant: receipt.merchant ?? "", category: receipt.category ?? "" }
  );
  const merchantLine = (
    key: "receiptInputVat" | "receiptInputVatRc" | "receiptOutputVatRc" | "receiptPayment"
  ) => journalLine(hasMerchant ? key : (`${key}NoMerchant` as JournalLineKey), { merchant });

  // E3 (J2-r3): a company that is not VAT registered recovers no input VAT (it stays in the
  // expense) and does not self-account reverse-charge VAT (there is none to record).
  const vatRegistered = await companyIsVatRegistered(receipt.companyId, tx);
  if (!vatRegistered && receipt.reverseCharge) {
    components = components.map((c) => ({ ...c, vatFils: 0 }));
  }
  const isReverseCharge = !!receipt.reverseCharge && vatRegistered;
  const vatBaseTotal = sumFils(components.map((c) => toBase(c.vatFils)));
  let inputVat: Account | null = null;
  let outputVat: Account | null = null;
  if (vatBaseTotal > 0 && vatRegistered) {
    inputVat = accounts.find((a) => a.isVatAccount && a.vatType === "input" && a.isActive) ?? null;
    if (isReverseCharge) {
      outputVat =
        accounts.find((a) => a.isVatAccount && a.vatType === "output" && a.isActive) ?? null;
      if (!inputVat || !outputVat) {
        throw new DomainError(
          "VAT_ACCOUNTS_MISSING",
          400,
          undefined,
          "Reverse-charge posting requires both Input VAT and Output VAT accounts in the chart of accounts"
        );
      }
    }
  }
  const separateVat = vatBaseTotal > 0 && inputVat !== null;

  // W4-E (R05-28): per-component recoverable share. Blocked VAT (entertainment, personal-use
  // vehicles, company rules) is added to the expense; only the recoverable part is Input VAT.
  const rules = vatBaseTotal > 0 ? await loadRecoveryRules(receipt.companyId, tx) : [];
  const treatmentLines = components.map((c, i) => {
    const supplyType = assertSupplyType(
      opts.vat?.lineSupplyTypes?.[i] || opts.vat?.vatSupplyType || "standard_rated",
      c.vatFils,
      i
    );
    const account = byId.get(c.accountId);
    const vatBase = toBase(c.vatFils);
    const rule = resolveRecovery(
      {
        category: receipt.category,
        accountId: c.accountId,
        accountCode: account?.code ?? null,
        accountName: account?.nameEn ?? null,
      },
      rules
    );
    const recoverable = separateVat ? recoverableShare(vatBase, rule.percent) : 0;
    return {
      accountId: c.accountId,
      supplyType,
      netBaseFils: toBase(c.netFils),
      vatBaseFils: vatBase,
      recoverableFils: recoverable,
      percent: separateVat ? rule.percent : 0,
      rule: rule.label,
    };
  });
  const recoverableTotal = sumFils(treatmentLines.map((t) => t.recoverableFils));

  const withFx = (
    line: JournalLineInsert,
    foreignDebitFils: number,
    foreignCreditFils: number
  ): JournalLineInsert =>
    isForeign
      ? {
          ...line,
          foreignCurrency: receiptCurrency,
          foreignDebit: filsToNumber(foreignDebitFils),
          foreignCredit: filsToNumber(foreignCreditFils),
          exchangeRate: fxRate,
        }
      : line;

  const lines: JournalLineInsert[] = [];
  let debitBase = 0;
  let foreignDebitTotal = 0;
  components.forEach((c, idx) => {
    // When there is no separate Input VAT account (or no VAT) the VAT folds into the expense;
    // the non-recoverable share of VAT always does.
    const netBase = toBase(c.netFils);
    const vatBase = toBase(c.vatFils);
    const blockedBase = vatBase - treatmentLines[idx].recoverableFils;
    const lineBase = separateVat ? netBase + blockedBase : netBase + vatBase;
    const blockedForeign =
      separateVat && blockedBase > 0
        ? c.vatFils - Math.round((c.vatFils * treatmentLines[idx].recoverableFils) / (vatBase || 1))
        : 0;
    const lineForeign = separateVat ? c.netFils + blockedForeign : c.netFils + c.vatFils;
    lines.push(
      withFx(
        {
          accountId: c.accountId,
          costCenterId: c.costCenterId,
          debit: filsToNumber(lineBase),
          credit: 0,
          ...(c.description ? { description: c.description } : labelLine),
        },
        lineForeign,
        0
      )
    );
    debitBase += lineBase;
    foreignDebitTotal += lineForeign;
  });

  let creditBase: number;
  let foreignCreditTotal: number;
  if (separateVat) {
    const vatForeign = sumFils(components.map((c) => c.vatFils));
    const recoverableForeign =
      vatForeign - (foreignDebitTotal - sumFils(components.map((c) => c.netFils)));
    if (recoverableTotal > 0) {
      lines.push(
        withFx(
          {
            accountId: inputVat!.id,
            debit: filsToNumber(recoverableTotal),
            credit: 0,
            ...merchantLine(isReverseCharge ? "receiptInputVatRc" : "receiptInputVat"),
            systemVat: true,
          },
          recoverableForeign,
          0
        )
      );
    }
    debitBase += recoverableTotal;
    foreignDebitTotal += recoverableForeign;
    if (isReverseCharge && outputVat) {
      lines.push(
        withFx(
          {
            accountId: outputVat.id,
            debit: 0,
            credit: filsToNumber(vatBaseTotal),
            ...merchantLine("receiptOutputVatRc"),
            systemVat: true,
          },
          0,
          vatForeign
        )
      );
      // The vendor charged no VAT: cash paid is the net only.
      creditBase = debitBase - vatBaseTotal;
      foreignCreditTotal = foreignDebitTotal - vatForeign;
    } else {
      creditBase = debitBase;
      foreignCreditTotal = foreignDebitTotal;
    }
  } else {
    creditBase = debitBase;
    foreignCreditTotal = foreignDebitTotal;
  }
  lines.push(
    withFx(
      {
        accountId: payment.id,
        debit: 0,
        credit: filsToNumber(creditBase),
        ...merchantLine("receiptPayment"),
      },
      0,
      foreignCreditTotal
    )
  );

  const vatBaseSum = sumFils(treatmentLines.map((t) => t.vatBaseFils));
  const types = new Set(treatmentLines.map((t) => t.supplyType));
  return {
    entryDate: receiptEntryDate(receipt),
    ...journalMemo("receipt", { party: label }),
    lines,
    exchangeRate: fxRate,
    exchangeRateSource: fxSource,
    baseCurrencyAmount: filsToNumber(creditBase),
    expenseAccountId: splitLines.length > 0 ? null : components[0].accountId,
    vatTreatment: {
      supplyType: isReverseCharge
        ? "reverse_charge"
        : types.size === 1
          ? [...types][0]
          : "standard_rated",
      vatBaseFils: vatBaseSum,
      recoverableVatFils: recoverableTotal,
      nonRecoverableVatFils: vatBaseSum - recoverableTotal,
      netBaseFils: sumFils(treatmentLines.map((t) => t.netBaseFils)),
      ruleLabel: treatmentLines.find((t) => t.rule)?.rule ?? null,
      lines: treatmentLines,
    },
  };
}

/** Post a receipt once. Throws DomainError RECEIPT_POSTED (409) if it is already posted. */
export async function postReceipt(
  receipt: Receipt,
  userId: string,
  input: { accountId?: string | null; paymentAccountId: string; vat?: ReceiptVatOptions }
): Promise<{ receipt: Receipt; entryId: string }> {
  return withLedgerTx(async (tx) => {
    const [current] = await tx
      .select()
      .from(receipts)
      .where(and(eq(receipts.id, receipt.id), eq(receipts.companyId, receipt.companyId)))
      .for("update");
    if (!current) throw new DomainError("RECEIPT_NOT_FOUND", 404);
    if (current.posted) {
      throw new DomainError(
        "RECEIPT_POSTED",
        409,
        { receiptId: current.id, journalEntryId: current.journalEntryId },
        "Receipt has already been posted"
      );
    }
    const plan = await planReceiptJournal(
      current,
      {
        expenseAccountId: input.accountId ?? null,
        paymentAccountId: input.paymentAccountId,
        vat: input.vat,
      },
      tx
    );
    const result = await storage.postReceiptAtomic(
      {
        receiptId: current.id,
        companyId: current.companyId,
        userId,
        accountId: plan.expenseAccountId ?? current.accountId ?? null,
        paymentAccountId: input.paymentAccountId,
        exchangeRate: plan.exchangeRate,
        exchangeRateSource: plan.exchangeRateSource,
        baseCurrencyAmount: plan.baseCurrencyAmount,
        entryDate: plan.entryDate,
        memo: plan.memo,
        memoKey: plan.memoKey,
        memoParams: plan.memoParams,
        lines: plan.lines,
      },
      tx
    );
    await saveReceiptVatTreatment(
      {
        receiptId: current.id,
        companyId: current.companyId,
        ...plan.vatTreatment,
      },
      tx
    );
    return { receipt: result.receipt, entryId: result.entry.id };
  });
}

/**
 * Revise a posted receipt: reverse the original journal entry and post the corrected one in a
 * single transaction. `merged` is the receipt as it will look after `patch`.
 */
export async function reviseReceipt(
  receipt: Receipt,
  userId: string,
  merged: Receipt,
  patch: Partial<Receipt>,
  reason: string | null
) {
  const paymentAccountId = merged.paymentAccountId ?? receipt.paymentAccountId;
  if (!paymentAccountId) {
    throw new DomainError("PAYMENT_ACCOUNT_REQUIRED", 400, undefined, "Payment account required");
  }
  return withLedgerTx(async (tx) => {
    const plan = await planReceiptJournal(
      merged,
      {
        expenseAccountId: merged.accountId,
        paymentAccountId,
      },
      tx
    );
    const result = await storage.reviseReceiptAtomic(
      {
        receiptId: receipt.id,
        companyId: receipt.companyId,
        expectedEntryId: receipt.journalEntryId,
        userId,
        patch: {
          ...patch,
          exchangeRate: plan.exchangeRate,
          exchangeRateSource: plan.exchangeRateSource,
          baseCurrencyAmount: plan.baseCurrencyAmount,
        } as never,
        reversalDate: null,
        reason,
        entryDate: plan.entryDate,
        memo: plan.memo,
        memoKey: plan.memoKey,
        memoParams: plan.memoParams,
        buildLines: () => plan.lines,
      },
      tx
    );
    await saveReceiptVatTreatment(
      {
        receiptId: receipt.id,
        companyId: receipt.companyId,
        ...plan.vatTreatment,
      },
      tx
    );
    return result;
  });
}
