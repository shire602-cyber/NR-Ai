// Pure scorer: how well does one bank line fit one candidate (an open invoice or bill, an unlinked journal entry,
// a posted receipt)? 0-100 with reason codes the UI translates.
//
//   amount vs the open balance   exact 60 | within 1% 40 | within 5% 20 | else reject
//   days to the nearer of issue/due date   0 -> 30 | <=3 -> 20 | <=7 -> 10 | <=30 -> 5
//   the document number appears in the bank text   +25
//   name similarity   >=0.5 +15 | >=0.25 +8
//
// An exact amount two days from the due date scores 80, which is the bar for "confident" (bulk accept).

export type ReasonCode =
  | "AMOUNT_EXACT"
  | "AMOUNT_WITHIN_1_PCT"
  | "AMOUNT_WITHIN_5_PCT"
  | "DATE_SAME_DAY"
  | "DATE_WITHIN_3_DAYS"
  | "DATE_WITHIN_7_DAYS"
  | "DATE_WITHIN_30_DAYS"
  | "DOCUMENT_NUMBER_IN_TEXT"
  | "NAME_STRONG"
  | "NAME_PARTIAL"
  | "RULE_MATCH"
  | "CLEARING_BALANCE_EQUALS_AMOUNT"
  | "COMBINATION_OF_INVOICES"
  | "TRANSFER_BETWEEN_OWN_ACCOUNTS";

export interface ScoreCandidate {
  /** Open balance, positive, in the bank account's currency. */
  openAmount: number;
  /** Issue date and/or due date; the nearer one counts. */
  dates: Date[];
  documentNumber?: string | null;
  /** Customer / vendor / merchant name, or a journal memo. */
  name?: string | null;
}

export interface ScoreInput {
  /** Absolute bank amount. */
  amount: number;
  date: Date;
  /** Description and reference of the bank line. */
  text: string;
  candidate: ScoreCandidate;
}

export interface Score {
  score: number;
  reasons: ReasonCode[];
}

export const CONFIDENT_SCORE = 80;

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "at", "by", "from", "with", "ltd", "llc", "fze", "pjsc", "llp", "inc", "co",
  "payment", "transfer", "bank", "charge", "fee", "aed", "invoice", "bill", "ref", "dubai", "uae",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

/** Dice similarity of the word sets, 0-1. */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap++;
  return (2 * overlap) / (ta.size + tb.size);
}

const alnum = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Does the bank text mention the document number (INV-2001 matches "inv2001" and "INV 2001")? */
export function mentionsDocumentNumber(text: string, documentNumber: string | null | undefined): boolean {
  const num = alnum(documentNumber ?? "");
  if (num.length < 4) return false;
  return alnum(text).includes(num);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(a: Date, b: Date): number {
  const da = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const db = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.abs(da - db) / DAY_MS;
}

/** null when the amount is not close enough: such a candidate is never suggested. */
export function scoreCandidate(input: ScoreInput): Score | null {
  const { amount, candidate } = input;
  if (!(amount > 0) || !(candidate.openAmount > 0)) return null;
  const reasons: ReasonCode[] = [];
  let score = 0;

  const diff = Math.abs(amount - candidate.openAmount);
  const rel = diff / candidate.openAmount;
  if (diff < 0.01) {
    score += 60;
    reasons.push("AMOUNT_EXACT");
  } else if (rel <= 0.01) {
    score += 40;
    reasons.push("AMOUNT_WITHIN_1_PCT");
  } else if (rel <= 0.05) {
    score += 20;
    reasons.push("AMOUNT_WITHIN_5_PCT");
  } else {
    return null;
  }

  if (candidate.dates.length) {
    const nearest = Math.min(...candidate.dates.map((d) => daysBetween(input.date, d)));
    if (nearest < 0.5) {
      score += 30;
      reasons.push("DATE_SAME_DAY");
    } else if (nearest <= 3) {
      score += 20;
      reasons.push("DATE_WITHIN_3_DAYS");
    } else if (nearest <= 7) {
      score += 10;
      reasons.push("DATE_WITHIN_7_DAYS");
    } else if (nearest <= 30) {
      score += 5;
      reasons.push("DATE_WITHIN_30_DAYS");
    }
  }

  if (mentionsDocumentNumber(input.text, candidate.documentNumber)) {
    score += 25;
    reasons.push("DOCUMENT_NUMBER_IN_TEXT");
  }

  if (candidate.name) {
    const sim = nameSimilarity(input.text, candidate.name);
    if (sim >= 0.5) {
      score += 15;
      reasons.push("NAME_STRONG");
    } else if (sim >= 0.25) {
      score += 8;
      reasons.push("NAME_PARTIAL");
    }
  }

  return { score: Math.min(100, score), reasons };
}

export interface Pairing<T> {
  transactionId: string;
  candidate: T;
  score: number;
}

/**
 * Greedy one-to-one assignment for a batch: best scores first, each transaction and each candidate used once.
 * `options` are the scored candidates per transaction; `key` identifies a candidate target.
 */
export function assignGreedy<T>(
  options: Array<{ transactionId: string; scored: Array<{ candidate: T; score: number }> }>,
  key: (candidate: T) => string
): Array<Pairing<T>> {
  const all: Array<Pairing<T>> = [];
  for (const o of options) for (const s of o.scored) all.push({ transactionId: o.transactionId, candidate: s.candidate, score: s.score });
  all.sort((a, b) => b.score - a.score);
  const usedTx = new Set<string>();
  const usedTarget = new Set<string>();
  const out: Array<Pairing<T>> = [];
  for (const p of all) {
    const k = key(p.candidate);
    if (usedTx.has(p.transactionId) || usedTarget.has(k)) continue;
    usedTx.add(p.transactionId);
    usedTarget.add(k);
    out.push(p);
  }
  return out;
}
