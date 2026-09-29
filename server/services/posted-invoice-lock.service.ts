// Editing an invoice whose journal entry is already posted.
//
// The route already refuses a change of the document totals. That is not
// enough: amounts can move between revenue accounts (A 100 -> 4020 and B 900 ->
// default, edited to A 900 and B 100, has the same totals and the same set of
// accounts), and net can move between a 5% and a 0% line. The journal was
// posted from the original per-account allocation, so a later void or credit
// note - and the VAT return, which reads the lines - would disagree with the
// ledger. This guard compares what the ledger and the VAT return derive from
// the lines, before and after, and refuses any difference. Pure module.

import Decimal from "decimal.js";
import { allocateRevenueCredits } from "./revenue-allocation.service";

type Num = number | string;

export interface LockLine {
  quantity: Num;
  unitPrice: Num;
  vatRate: Num;
  vatSupplyType?: string | null;
  revenueAccountId?: string | null;
}

export interface LockSide {
  lines: LockLine[];
  /** Document-currency subtotal of this side. */
  subtotal: number;
  /** AED per unit of document currency (1 for AED). */
  rate: number;
}

export type PostedEditVerdict =
  | { ok: true }
  | { ok: false; code: string; message: string };

const NO_DEFAULT = "__no-default-account__";

function allocationByAccount(side: LockSide, defaultId: string, zeroId: string | null) {
  const result = new Map<string, number>();
  for (const a of allocateRevenueCredits({
    lines: side.lines,
    rate: side.rate,
    subtotal: side.subtotal,
    defaultAccountId: defaultId,
    zeroRatedAccountId: zeroId,
  })) {
    result.set(a.accountId, Math.round(a.amount * 100) / 100);
  }
  return result;
}

/**
 * VAT-return profile: net (AED) per VAT bucket. Taxed lines are one bucket per
 * rate; 0% lines are split by their supply type (zero-rated vs exempt vs
 * out-of-scope land in different boxes). A taxed line's stored type is ignored
 * - the rate decides - so re-saving legacy rows that stored a taxed line as
 * exempt is a correction, not a change.
 */
function vatProfile(side: LockSide) {
  const m = new Map<string, Decimal>();
  for (const l of side.lines) {
    const rate = Number(l.vatRate);
    const bucket = rate > 0 ? `rate:${rate}` : `zero:${l.vatSupplyType || "zero_rated"}`;
    const net = new Decimal(l.quantity).times(l.unitPrice).times(side.rate);
    m.set(bucket, (m.get(bucket) ?? new Decimal(0)).plus(net));
  }
  return m;
}

export function checkPostedInvoiceEdit(args: {
  before: LockSide;
  after: LockSide;
  defaultAccountId?: string | null;
  zeroRatedAccountId?: string | null;
}): PostedEditVerdict {
  const defaultId = args.defaultAccountId ?? NO_DEFAULT;
  const zeroId = args.zeroRatedAccountId ?? null;

  if (Math.abs(args.before.rate - args.after.rate) > 1e-9) {
    return {
      ok: false,
      code: "INVOICE_POSTED_AMOUNT_LOCKED",
      message:
        "The exchange rate cannot be changed while a posted journal entry exists. Void this invoice and issue a new one instead.",
    };
  }

  const before = allocationByAccount(args.before, defaultId, zeroId);
  const after = allocationByAccount(args.after, defaultId, zeroId);
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (Math.abs((before.get(id) ?? 0) - (after.get(id) ?? 0)) > 0.005) {
      return {
        ok: false,
        code: "INVOICE_POSTED_REVENUE_ACCOUNT_LOCKED",
        message:
          "Revenue accounts and the amount posted to each cannot be changed while a posted journal entry exists. Void this invoice and issue a credit note or new invoice instead.",
      };
    }
  }

  const vb = vatProfile(args.before);
  const va = vatProfile(args.after);
  for (const bucket of new Set([...vb.keys(), ...va.keys()])) {
    const diff = (vb.get(bucket) ?? new Decimal(0)).minus(va.get(bucket) ?? 0).abs();
    if (diff.gt(0.005)) {
      return {
        ok: false,
        code: "INVOICE_POSTED_VAT_LOCKED",
        message:
          "The VAT treatment of the lines cannot be changed while a posted journal entry exists. Void this invoice and issue a credit note or new invoice instead.",
      };
    }
  }
  return { ok: true };
}
