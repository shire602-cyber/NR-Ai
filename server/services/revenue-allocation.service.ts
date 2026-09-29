// Per-line revenue-account allocation for sales invoices.
//
// Until now every invoice line credited one income account (4010 Product
// Sales, or 4060 Zero-Rated Sales for 0% lines). An invoice line may now carry
// an optional `revenueAccountId`; this module groups the net amounts per
// account so the journal stays balanced, and validates the chosen accounts.
//
// Pure module: no database or framework imports.

import type { JournalLine } from "./invoice-lifecycle";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface RevenueLine {
  quantity: number | string;
  unitPrice: number | string;
  vatRate: number | string;
  revenueAccountId?: string | null;
}

export interface RevenueCredit {
  accountId: string;
  /** Positive AED net amount credited to (or, on reversal, debited from) the account. */
  amount: number;
}

/**
 * Group line net amounts per revenue account.
 *  - a line with its own `revenueAccountId` goes to that account;
 *  - otherwise a 0% line goes to `zeroRatedAccountId` (when the chart has one);
 *  - otherwise the line goes to `defaultAccountId`.
 * Amounts are converted to AED at `rate`. The groups always sum to `subtotal`
 * exactly: any rounding residual is added to the default group (or, when no
 * line uses the default, to the largest group).
 */
export function allocateRevenueCredits(args: {
  lines: RevenueLine[];
  rate: number;
  subtotal: number;
  defaultAccountId: string;
  zeroRatedAccountId?: string | null;
}): RevenueCredit[] {
  const { lines, rate, defaultAccountId, zeroRatedAccountId } = args;
  const subtotal = round2(args.subtotal);

  const raw = new Map<string, number>();
  const order: string[] = [];
  const add = (accountId: string, net: number) => {
    if (!raw.has(accountId)) {
      raw.set(accountId, 0);
      order.push(accountId);
    }
    raw.set(accountId, (raw.get(accountId) ?? 0) + net);
  };

  let usesDefault = false;
  for (const l of lines) {
    const net = Number(l.quantity) * Number(l.unitPrice);
    if (l.revenueAccountId) {
      add(l.revenueAccountId, net);
    } else if (Number(l.vatRate) === 0 && zeroRatedAccountId) {
      add(zeroRatedAccountId, net);
    } else {
      usesDefault = true;
      add(defaultAccountId, net);
    }
  }

  // A document with a subtotal but no lines (legacy data) still credits the
  // default account, exactly as before.
  if (order.length === 0) {
    return subtotal !== 0 ? [{ accountId: defaultAccountId, amount: subtotal }] : [];
  }

  const groups = new Map<string, number>();
  for (const id of order) groups.set(id, round2((raw.get(id) ?? 0) * rate));

  const residual = round2(subtotal - [...groups.values()].reduce((s, v) => s + v, 0));
  if (Math.abs(residual) >= 0.005 && groups.size > 0) {
    let target = defaultAccountId;
    if (!usesDefault || !groups.has(defaultAccountId)) {
      target = [...groups.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    groups.set(target, round2((groups.get(target) ?? 0) + residual));
  }

  // Stable order: default group first, then the rest in first-seen order.
  const ids = order.filter((id) => (groups.get(id) ?? 0) !== 0);
  ids.sort((a, b) => (a === defaultAccountId ? -1 : b === defaultAccountId ? 1 : 0));
  return ids.map((accountId) => ({ accountId, amount: groups.get(accountId) ?? 0 }));
}

/** Journal credit legs for an allocation, described like today's legs. */
export function buildRevenueCreditLines(
  allocation: RevenueCredit[],
  ctx: { defaultAccountId: string; zeroRatedAccountId?: string | null; invoiceNumber: string }
): JournalLine[] {
  return allocation
    .filter((a) => a.amount > 0)
    .map((a) => ({
      accountId: a.accountId,
      debit: 0,
      credit: a.amount,
      description:
        a.accountId === ctx.zeroRatedAccountId
          ? `Zero-rated sales - Invoice ${ctx.invoiceNumber}`
          : `Sales revenue - Invoice ${ctx.invoiceNumber}`,
    }));
}

export interface AccountLike {
  id: string;
  type: string;
  isActive?: boolean | null;
}

export type RevenueAccountCheck =
  | { ok: true }
  | { ok: false; status: 400; code: "INVALID_REVENUE_ACCOUNT"; message: string };

/**
 * Every chosen revenue account must be in the company's own chart (pass the
 * company-scoped account list, so a foreign id is simply absent), be an income
 * account, and be active. Blank / null ids mean "use the default" and pass.
 */
export function validateRevenueAccounts(
  companyAccounts: AccountLike[],
  ids: Array<string | null | undefined>
): RevenueAccountCheck {
  const byId = new Map(companyAccounts.map((a) => [a.id, a]));
  for (const id of ids) {
    if (!id) continue;
    const account = byId.get(id);
    if (!account) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_REVENUE_ACCOUNT",
        message: `Revenue account ${id} not found in this company's chart of accounts`,
      };
    }
    if (account.type !== "income") {
      return {
        ok: false,
        status: 400,
        code: "INVALID_REVENUE_ACCOUNT",
        message: "Revenue account must be an income account",
      };
    }
    if (account.isActive === false) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_REVENUE_ACCOUNT",
        message: "Revenue account is inactive",
      };
    }
  }
  return { ok: true };
}
