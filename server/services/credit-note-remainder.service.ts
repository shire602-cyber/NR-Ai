// Pure helpers for reversing an invoice (void / credit note) exactly.
//
// Two complementary views:
//  * LINE view (document currency): what each revenue account was credited by
//    the original invoice lines, minus what earlier credit notes' lines already
//    took back per account. Used to size the document lines of a capped
//    "remaining balance" credit note and to resolve the account of a credit line.
//  * JOURNAL view (AED): reverseToZero() negates the net standing on the
//    ledger for the invoice (original entry plus earlier credit-note entries),
//    so a void / final credit note reverses the exact AED amounts that were
//    posted - AR, revenue and VAT each land on 0.00 whatever the FX rate or
//    rounding.
//
// No database or framework imports.

import Decimal from "decimal.js";
import type { JournalLine } from "./invoice-lifecycle";
import { deriveVatSupplyType, type VatSupplyType } from "./vat-supply-type";

type Num = number | string;

export interface RevenueCtx {
  defaultAccountId: string;
  zeroRatedAccountId?: string | null;
}

export interface RemainderLine {
  id?: string;
  description?: string | null;
  quantity: Num;
  unitPrice: Num;
  vatRate: Num;
  vatSupplyType?: string | null;
  revenueAccountId?: string | null;
}

const D = (n: Num) => new Decimal(n);
const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * The income account a line was (or will be) posted to: its own choice, else
 * the zero-rated account for 0% lines, else the default. Mirrors
 * allocateRevenueCredits so a reversal hits the same account.
 */
export function effectiveRevenueAccountId(
  line: { vatRate: Num; revenueAccountId?: string | null },
  ctx: RevenueCtx
): string {
  if (line.revenueAccountId) return line.revenueAccountId;
  if (Number(line.vatRate) === 0 && ctx.zeroRatedAccountId) return ctx.zeroRatedAccountId;
  return ctx.defaultAccountId;
}

const netOf = (l: RemainderLine) => D(l.quantity).abs().times(D(l.unitPrice));

export interface RemainingByAccount {
  /** Net (document currency) still standing per revenue account; always > 0. */
  accounts: Array<{ accountId: string; net: number }>;
  /** Output VAT (document currency) still standing; never negative. */
  vat: number;
}

/**
 * remaining = posted (original lines) - already credited (earlier credit-note
 * lines), per revenue account, never negative. VAT likewise.
 */
export function remainingByAccount(args: {
  originalLines: RemainderLine[];
  creditedLines: RemainderLine[];
  ctx: RevenueCtx;
}): RemainingByAccount {
  const { originalLines, creditedLines, ctx } = args;
  const posted = new Map<string, Decimal>();
  const order: string[] = [];
  let vatPosted = new Decimal(0);
  for (const l of originalLines) {
    const id = effectiveRevenueAccountId(l, ctx);
    if (!posted.has(id)) {
      posted.set(id, new Decimal(0));
      order.push(id);
    }
    const net = netOf(l);
    posted.set(id, posted.get(id)!.plus(net));
    vatPosted = vatPosted.plus(net.times(D(l.vatRate)));
  }
  const credited = new Map<string, Decimal>();
  let vatCredited = new Decimal(0);
  for (const l of creditedLines) {
    const id = effectiveRevenueAccountId(l, ctx);
    const net = netOf(l);
    credited.set(id, (credited.get(id) ?? new Decimal(0)).plus(net));
    vatCredited = vatCredited.plus(net.times(D(l.vatRate)));
  }

  const accounts = order
    .map((accountId) => {
      const rest = Decimal.max(0, posted.get(accountId)!.minus(credited.get(accountId) ?? 0));
      return { accountId, net: round2(rest).toNumber() };
    })
    .filter((a) => a.net > 0);
  return { accounts, vat: round2(Decimal.max(0, vatPosted.minus(vatCredited))).toNumber() };
}

export interface RemainingLine {
  originalLineId?: string;
  description: string;
  vatRate: number;
  vatSupplyType?: string | null;
  revenueAccountId: string;
  /** Net (document currency) of this original line still not credited. */
  net: number;
}

/**
 * Per original line, the net that earlier credit notes did not yet take back.
 * Credited amounts are consumed from the original lines that share their
 * (revenue account, VAT rate), in original order - credit-note lines do not
 * record which original line they came from.
 */
export function remainingLines(args: {
  originalLines: RemainderLine[];
  creditedLines: RemainderLine[];
  ctx: RevenueCtx;
}): RemainingLine[] {
  const { originalLines, creditedLines, ctx } = args;
  const key = (l: RemainderLine) => `${effectiveRevenueAccountId(l, ctx)}|${Number(l.vatRate)}`;
  const pool = new Map<string, Decimal>();
  for (const c of creditedLines) pool.set(key(c), (pool.get(key(c)) ?? new Decimal(0)).plus(netOf(c)));

  const out: RemainingLine[] = [];
  for (const o of originalLines) {
    let net = netOf(o);
    const k = key(o);
    const available = pool.get(k) ?? new Decimal(0);
    const take = Decimal.min(net, available);
    net = net.minus(take);
    pool.set(k, available.minus(take));
    const rounded = net.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber();
    if (rounded > 0) {
      out.push({
        originalLineId: o.id,
        description: o.description ?? "",
        vatRate: Number(o.vatRate),
        vatSupplyType: o.vatSupplyType,
        revenueAccountId: effectiveRevenueAccountId(o, ctx),
        net: rounded,
      });
    }
  }
  return out;
}

export type CreditLineAccount =
  | { ok: true; accountId: string }
  | { ok: false; code: "INVALID_ORIGINAL_LINE"; message: string };

/**
 * The revenue account a credit-note line reverses. Order:
 *  1. the original invoice line named by `originalLineId`;
 *  2. an account the credit line itself names;
 *  3. the original line with the same description (fragile, last resort);
 *  4. the DEFAULT revenue account, explicitly (never guessed from the rate).
 */
export function resolveCreditLineAccount(
  line: {
    description: string;
    vatRate: Num;
    revenueAccountId?: string | null;
    originalLineId?: string | null;
  },
  originalLines: RemainderLine[],
  ctx: RevenueCtx
): CreditLineAccount {
  if (line.originalLineId) {
    const match = originalLines.find((o) => o.id === line.originalLineId);
    if (!match) {
      return {
        ok: false,
        code: "INVALID_ORIGINAL_LINE",
        message: `originalLineId ${line.originalLineId} is not a line of the invoice being credited`,
      };
    }
    return { ok: true, accountId: effectiveRevenueAccountId(match, ctx) };
  }
  if (line.revenueAccountId) return { ok: true, accountId: line.revenueAccountId };
  const byDescription = originalLines.find((o) => o.description === line.description);
  if (byDescription) return { ok: true, accountId: effectiveRevenueAccountId(byDescription, ctx) };
  return { ok: true, accountId: ctx.defaultAccountId };
}

export interface LedgerLine {
  accountId: string;
  debit: number;
  credit: number;
}

/**
 * Journal legs that bring every account touched by `lines` back to exactly
 * zero: the negation of the net standing per account. For a void, pass the
 * original entry's lines; for a credit note that fully credits the invoice,
 * pass the original entry's lines plus those of the earlier credit notes.
 * Amounts are the AED figures as posted, so nothing is recomputed or re-rounded.
 */
export function reverseToZero(
  lines: LedgerLine[],
  opts: {
    arAccountId?: string | null;
    vatAccountId?: string | null;
    labels: { revenue: string; vat: string; ar: string };
  }
): JournalLine[] {
  const net = new Map<string, Decimal>();
  const order: string[] = [];
  for (const l of lines) {
    if (!net.has(l.accountId)) {
      net.set(l.accountId, new Decimal(0));
      order.push(l.accountId);
    }
    net.set(l.accountId, net.get(l.accountId)!.plus(D(l.debit)).minus(D(l.credit)));
  }
  const out: JournalLine[] = [];
  for (const accountId of order) {
    const bal = round2(net.get(accountId)!);
    if (bal.isZero()) continue;
    const description =
      accountId === opts.arAccountId
        ? opts.labels.ar
        : accountId === opts.vatAccountId
          ? opts.labels.vat
          : opts.labels.revenue;
    // Standing debit balance -> credit it back, and vice versa.
    out.push(
      bal.gt(0)
        ? { accountId, debit: 0, credit: bal.toNumber(), description }
        : { accountId, debit: bal.negated().toNumber(), credit: 0, description }
    );
  }
  return out;
}


// ─── VAT buckets ────────────────────────────────────────────────────────────
//
// The VAT engines read the credit-note DOCUMENT lines while the ledger is
// reversed from the journal, so the two can only agree if the document lines
// never take back more (per VAT rate / supply type / revenue account) than the
// invoice carried. A "bucket" is one (VAT rate, supply type[, revenue account])
// cell with its net and VAT in document currency.

export interface VatBucket {
  vatRate: number;
  supplyType: VatSupplyType;
  /** Set only when bucketed by revenue account. */
  accountId?: string;
  /** Absolute net (document currency), 2dp. */
  net: number;
  /** Absolute VAT (document currency), 2dp. */
  vat: number;
}

const bucketKey = (b: { vatRate: number; supplyType: string; accountId?: string }) =>
  `${b.vatRate}|${b.supplyType}|${b.accountId ?? ""}`;

function accumulate(
  lines: RemainderLine[],
  ctx: RevenueCtx,
  byAccount: boolean
): Map<string, { vatRate: number; supplyType: VatSupplyType; accountId?: string; net: Decimal; vat: Decimal }> {
  const out = new Map<string, { vatRate: number; supplyType: VatSupplyType; accountId?: string; net: Decimal; vat: Decimal }>();
  for (const l of lines) {
    const vatRate = Number(l.vatRate);
    const base = {
      vatRate,
      supplyType: deriveVatSupplyType(vatRate, l.vatSupplyType),
      ...(byAccount ? { accountId: effectiveRevenueAccountId(l, ctx) } : {}),
    };
    const key = bucketKey(base);
    const net = netOf(l);
    const cur = out.get(key) ?? { ...base, net: new Decimal(0), vat: new Decimal(0) };
    cur.net = cur.net.plus(net);
    cur.vat = cur.vat.plus(net.times(D(vatRate)));
    out.set(key, cur);
  }
  return out;
}

const toBuckets = (m: ReturnType<typeof accumulate>): VatBucket[] =>
  [...m.values()].map((b) => ({
    vatRate: b.vatRate,
    supplyType: b.supplyType,
    ...(b.accountId !== undefined ? { accountId: b.accountId } : {}),
    net: round2(b.net).toNumber(),
    vat: round2(b.vat).toNumber(),
  }));

/** Absolute net and VAT of `lines` per (VAT rate, supply type[, revenue account]). */
export function bucketLines(lines: RemainderLine[], ctx: RevenueCtx, opts?: { byAccount?: boolean }): VatBucket[] {
  return toBuckets(accumulate(lines, ctx, opts?.byAccount === true));
}

/**
 * What is still creditable per (VAT rate, supply type): invoice lines minus
 * earlier credit-note lines, never negative, empty buckets dropped. Used to
 * cap a PARTIAL credit note per VAT bucket ("no more at 5% than remains at 5%").
 */
export function remainingVatBuckets(args: {
  originalLines: RemainderLine[];
  creditedLines: RemainderLine[];
  ctx: RevenueCtx;
}): VatBucket[] {
  const orig = accumulate(args.originalLines, args.ctx, false);
  const cred = accumulate(args.creditedLines, args.ctx, false);
  const out: VatBucket[] = [];
  for (const [key, o] of orig) {
    const c = cred.get(key);
    const net = round2(Decimal.max(0, o.net.minus(c?.net ?? 0)));
    const vat = round2(Decimal.max(0, o.vat.minus(c?.vat ?? 0)));
    if (net.gt(0) || vat.gt(0)) out.push({ vatRate: o.vatRate, supplyType: o.supplyType, net: net.toNumber(), vat: vat.toNumber() });
  }
  return out;
}

/**
 * The first requested bucket that takes back more net or VAT than `remaining`
 * has (0.01 tolerance for rounding), or null when the request fits. A bucket
 * absent from `remaining` has nothing left to credit.
 */
export function findBucketExcess(remaining: VatBucket[], requested: VatBucket[], tolerance = 0.01): VatBucket | null {
  const left = new Map(remaining.map((b) => [bucketKey(b), b]));
  for (const r of requested) {
    const l = left.get(bucketKey(r));
    if (!l || r.net > l.net + tolerance || r.vat > l.vat + tolerance) return r;
  }
  return null;
}

/**
 * The document lines a credit note that brings the invoice to fully credited
 * must carry, per (VAT rate, supply type, revenue account): what each original
 * line still has left after earlier credit notes (see remainingLines).
 */
export function remainderBuckets(args: {
  originalLines: RemainderLine[];
  creditedLines: RemainderLine[];
  ctx: RevenueCtx;
}): VatBucket[] {
  const left = remainingLines(args);
  return bucketLines(
    left.map((l) => ({
      quantity: 1,
      unitPrice: l.net,
      vatRate: l.vatRate,
      vatSupplyType: l.vatSupplyType,
      revenueAccountId: l.revenueAccountId,
    })),
    args.ctx,
    { byAccount: true }
  );
}

/** ok when both bucket sets have the same cells with net and VAT within `tolerance`. */
export function compareBuckets(
  expected: VatBucket[],
  supplied: VatBucket[],
  tolerance = 0.01
): { ok: true } | { ok: false; expected: VatBucket[]; supplied: VatBucket[] } {
  const e = new Map(expected.map((b) => [bucketKey(b), b]));
  const s = new Map(supplied.map((b) => [bucketKey(b), b]));
  const keys = new Set([...e.keys(), ...s.keys()]);
  for (const k of keys) {
    const a = e.get(k);
    const b = s.get(k);
    if (Math.abs((a?.net ?? 0) - (b?.net ?? 0)) > tolerance || Math.abs((a?.vat ?? 0) - (b?.vat ?? 0)) > tolerance) {
      return { ok: false, expected, supplied };
    }
  }
  return { ok: true };
}
