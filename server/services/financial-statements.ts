// Pure, side-effect-free helpers for financial-statement construction so the
// logic can be unit tested without a database.
//
// Fixes:
//   A-2  — balance-sheet sign reclassification (net-credit asset -> liability,
//          net-debit liability -> asset).
//   A-3  — cash-flow statement built from actual cash-account movements
//          (direct method) instead of summing every account's delta, so the
//          net cash change ties to the change in bank/cash balances.

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * A-B17: decimal-safe money summation. Accumulating many `money` floats with
 * `+=` then rounding once lets sub-cent binary-float error creep in (then gets
 * papered over by 0.01 tolerances). Summing in fixed-point integer fils and
 * dividing once is exact for 2dp money values.
 */
export function sumMoney(values: number[]): number {
  let fils = 0;
  for (const v of values) fils += Math.round((v + Number.EPSILON) * 100);
  return fils / 100;
}

export type CFAccount = {
  id: string;
  type: string;
  subType?: string | null;
  code?: string | null;
  nameEn: string;
};

export type CFLine = { accountId: string; debit?: number | null; credit?: number | null };

/** Cash/bank account predicate (mirrors reports.routes / dashboard). */
export function isCashOrBankAccount(a: {
  code?: string | null;
  nameEn?: string | null;
  subType?: string | null;
}): boolean {
  if (a.subType === "cash" || a.subType === "bank") return true;
  const code = a.code ?? "";
  if (code >= "1010" && code <= "1039") return true;
  const name = (a.nameEn ?? "").toLowerCase();
  return name.includes("cash") || name.includes("bank") || name.includes("petty");
}

export type CashFlowCategory = "operating" | "investing" | "financing";

/** Classify a non-cash counterpart account into a cash-flow activity. */
export function classifyCounterpart(acct: CFAccount | undefined): CashFlowCategory {
  if (!acct) return "operating";
  if (acct.type === "income" || acct.type === "expense") return "operating";
  if (acct.type === "asset" && acct.subType === "fixed_asset") return "investing";
  if (acct.type === "asset") return "operating"; // AR, VAT, prepaid, inventory = working capital
  if (acct.type === "liability" && acct.subType === "long_term_liability") return "financing";
  if (acct.type === "liability") return "operating";
  if (acct.type === "equity") return "financing";
  return "operating";
}

/**
 * A-2: Decide which balance-sheet section an account balance belongs in,
 * reclassifying abnormal balances. Returns the normal-signed magnitude and the
 * destination section. Income/expense are returned so the caller can roll them
 * into retained earnings (amount = creditTotal - debitTotal).
 */
/**
 * Contra-asset accounts NORMALLY carry a credit balance — that is their whole
 * purpose. They reduce the carrying value of the asset they relate to and must
 * be presented inside the asset section as a negative, never reclassified as a
 * liability.
 *
 * Accumulated Depreciation (1240) reclassified as a liability made a company
 * with a 36,000 asset and 1,000 of depreciation report assets 36,000 /
 * liabilities 37,000 — overstating both sides and hiding the 35,000 net book
 * value an accountant actually needs.
 */
const CONTRA_ASSET_CODES = new Set(["1240"]); // Accumulated Depreciation

export function classifyBalanceSheetAccount(args: {
  type: string;
  debitTotal: number;
  creditTotal: number;
  /** Account code — used to detect contra accounts. */
  code?: string;
}): { section: "asset" | "liability" | "equity" | "income" | "expense"; amount: number } {
  const { type } = args;
  const debit = args.debitTotal || 0;
  const credit = args.creditTotal || 0;
  if (type === "asset") {
    const net = round2(debit - credit); // positive = normal debit balance
    // Contra-asset: stay in assets and carry the (usually negative) net so the
    // section total reports net book value.
    if (args.code && CONTRA_ASSET_CODES.has(args.code)) {
      return { section: "asset", amount: net };
    }
    if (net >= 0) return { section: "asset", amount: net };
    return { section: "liability", amount: round2(-net) }; // credit-balance asset -> liability
  }
  if (type === "liability") {
    const net = round2(credit - debit); // positive = normal credit balance
    if (net >= 0) return { section: "liability", amount: net };
    return { section: "asset", amount: round2(-net) }; // debit-balance liability -> asset
  }
  if (type === "equity") return { section: "equity", amount: round2(credit - debit) };
  if (type === "income") return { section: "income", amount: round2(credit - debit) };
  return { section: "expense", amount: round2(credit - debit) };
}

/**
 * A-B4: Revalue a foreign-currency balance using the single canonical FX
 * convention — `rate` is AED per 1 unit of foreign currency (same as stored
 * invoice/receipt exchangeRate and `getLatestRate(foreign, "AED")`). AED value
 * is therefore foreignAmount * rate (never divided).
 */
export function revalueForeignBalance(args: {
  foreignAmount: number;
  bookRateAedPerUnit: number;
  currentRateAedPerUnit: number;
  kind: "receivable" | "payable";
}): { bookValueAed: number; currentValueAed: number; unrealizedGainLoss: number } {
  const bookRate = args.bookRateAedPerUnit > 0 ? args.bookRateAedPerUnit : 1;
  const curRate = args.currentRateAedPerUnit > 0 ? args.currentRateAedPerUnit : 1;
  const bookValueAed = round2(args.foreignAmount * bookRate);
  const currentValueAed = round2(args.foreignAmount * curRate);
  // Receivable: gain when AED value rises. Payable: gain when AED cost falls.
  const unrealizedGainLoss =
    args.kind === "receivable"
      ? round2(currentValueAed - bookValueAed)
      : round2(bookValueAed - currentValueAed);
  return { bookValueAed, currentValueAed, unrealizedGainLoss };
}

/**
 * A-B8: Build the balanced legs for an unrealised FX revaluation of open
 * foreign-currency receivables/payables at period end. Inputs are the NET
 * AED revaluation amounts (positive = gain, negative = loss; payable figures
 * already signed so a gain means the AED cost fell). The offset goes to the
 * AR/AP control accounts and the net to FX gain/loss (P&L). The caller posts
 * these dated period-end and posts the reverse next period.
 */
export function buildFxRevaluationLines(args: {
  receivableRevalAed: number;
  payableRevalAed: number;
  accounts: {
    arId?: string | null;
    apId?: string | null;
    fxGainId?: string | null;
    fxLossId?: string | null;
  };
}):
  | { ok: true; lines: Array<{ accountId: string; debit: number; credit: number; description: string }> }
  | { ok: false; code: string; message: string } {
  const ar = round2(args.receivableRevalAed || 0);
  const ap = round2(args.payableRevalAed || 0);
  const net = round2(ar + ap);
  if (Math.abs(ar) < 0.01 && Math.abs(ap) < 0.01) {
    return { ok: false, code: "NO_REVALUATION", message: "No open foreign-currency balances to revalue." };
  }
  const { accounts } = args;
  const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = [];

  if (Math.abs(ar) >= 0.01) {
    if (!accounts.arId)
      return { ok: false, code: "AR_ACCOUNT_MISSING", message: "Accounts Receivable account is missing." };
    lines.push({
      accountId: accounts.arId,
      debit: ar > 0 ? ar : 0,
      credit: ar < 0 ? -ar : 0,
      description: "Unrealised FX revaluation — A/R",
    });
  }
  if (Math.abs(ap) >= 0.01) {
    if (!accounts.apId)
      return { ok: false, code: "AP_ACCOUNT_MISSING", message: "Accounts Payable account is missing." };
    lines.push({
      accountId: accounts.apId,
      debit: ap > 0 ? ap : 0,
      credit: ap < 0 ? -ap : 0,
      description: "Unrealised FX revaluation — A/P",
    });
  }
  if (Math.abs(net) >= 0.01) {
    if (net > 0) {
      if (!accounts.fxGainId)
        return { ok: false, code: "FX_GAIN_ACCOUNT_MISSING", message: "FX Gain account is missing." };
      lines.push({ accountId: accounts.fxGainId, debit: 0, credit: net, description: "Unrealised FX gain" });
    } else {
      if (!accounts.fxLossId)
        return { ok: false, code: "FX_LOSS_ACCOUNT_MISSING", message: "FX Loss account is missing." };
      lines.push({ accountId: accounts.fxLossId, debit: -net, credit: 0, description: "Unrealised FX loss" });
    }
  }

  const dr = round2(lines.reduce((s, l) => s + l.debit, 0));
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.01) {
    return { ok: false, code: "UNBALANCED_REVALUATION", message: `Revaluation unbalanced (${dr} vs ${cr}).` };
  }
  return { ok: true, lines };
}

export type CashFlowBreakdownLine = {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number; // signed: positive = cash inflow
};

export type CashFlowResult = {
  operating: { total: number; breakdown: CashFlowBreakdownLine[] };
  investing: { total: number; breakdown: CashFlowBreakdownLine[] };
  financing: { total: number; breakdown: CashFlowBreakdownLine[] };
  netCashChange: number;
};

/**
 * A-3: Direct-method cash flow. For each entry that touches a cash/bank
 * account, the net cash movement (cash debits - cash credits) is attributed to
 * the dominant non-cash counterpart account and bucketed by activity. The cash
 * accounts themselves are never listed as line items, and the net cash change
 * equals the total movement across cash/bank accounts for the period.
 */
export function computeCashFlow(args: {
  entries: Array<{ lines: CFLine[] }>;
  accounts: CFAccount[];
}): CashFlowResult {
  const accountById = new Map(args.accounts.map((a) => [a.id, a]));
  const cashAccountIds = new Set(
    args.accounts.filter((a) => a.type === "asset" && isCashOrBankAccount(a)).map((a) => a.id)
  );

  const buckets: Record<CashFlowCategory, Map<string, number>> = {
    operating: new Map(),
    investing: new Map(),
    financing: new Map(),
  };

  for (const entry of args.entries) {
    const lines = entry.lines ?? [];
    const cashLines = lines.filter((l) => cashAccountIds.has(l.accountId));
    if (cashLines.length === 0) continue; // no cash moved
    const nonCashLines = lines.filter((l) => !cashAccountIds.has(l.accountId));

    const netCash = cashLines.reduce(
      (s, l) => s + (l.debit || 0) - (l.credit || 0),
      0
    ); // positive = inflow

    // Pick the dominant counterpart account (largest absolute movement).
    let dominant: CFLine | undefined;
    let dominantWeight = -1;
    for (const l of nonCashLines) {
      const w = Math.abs((l.debit || 0) - (l.credit || 0));
      if (w > dominantWeight) {
        dominantWeight = w;
        dominant = l;
      }
    }
    const counterpart = dominant ? accountById.get(dominant.accountId) : undefined;
    const category = classifyCounterpart(counterpart);
    const key = counterpart?.id ?? "unclassified";
    buckets[category].set(key, round2((buckets[category].get(key) ?? 0) + netCash));
  }

  const build = (cat: CashFlowCategory) => {
    const breakdown: CashFlowBreakdownLine[] = [];
    for (const [accountId, amount] of buckets[cat].entries()) {
      const acct = accountById.get(accountId);
      breakdown.push({
        accountId,
        accountCode: acct?.code ?? "",
        accountName: acct?.nameEn ?? "Unclassified",
        amount: round2(amount),
      });
    }
    breakdown.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    // A-B17: sum exactly in fils so the section total can't drift.
    const total = sumMoney(breakdown.map((b) => b.amount));
    return { total, breakdown };
  };

  const operating = build("operating");
  const investing = build("investing");
  const financing = build("financing");
  return {
    operating,
    investing,
    financing,
    netCashChange: sumMoney([operating.total, investing.total, financing.total]),
  };
}
