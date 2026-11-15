/**
 * Pure input normalisation for the ledger kernel. No database access, so the
 * rules here are unit-testable on their own (tests/unit/ledger-*.test.ts).
 *
 * Every amount becomes integer fils (shared/money.ts). Rules (frozen):
 *   - each line has exactly one strictly positive side (debit XOR credit);
 *   - more than 2 decimal places is an error (no silent rounding), unless the
 *     legacy adapter opts in with amountRounding: "halfUp" (per-line ROUND_HALF_UP,
 *     the same thing numeric(15,2) did on insert);
 *   - total debit must equal total credit exactly (difference 0 fils);
 *   - NaN, Infinity, exponent strings, values outside numeric(15,2) -> 422;
 *   - dates must be real calendar dates in 1900..9999 and, unless allowed,
 *     not after today (UTC).
 */
import { MoneyError, toFils, type Rounding } from "../../shared/money";
import { DomainError } from "../errors";
import type {
  EntryKind,
  LedgerAmount,
  NormalizedEntry,
  NormalizedLine,
  PostJournalInput,
  PostJournalLineInput,
} from "./types";
import { ENTRY_KINDS } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const RATE_RE = /^\d{1,9}(?:\.\d{1,6})?$/;
export const MAX_LINES = 5000;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function fail(code: string, message: string, details?: unknown): never {
  throw new DomainError(code, 422, details, message);
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Parse a journal date. Strings may be "YYYY-MM-DD" or an ISO datetime (the
 * calendar date part is the posting date). Returns the ISO calendar date and
 * the timestamp to store (UTC midnight for strings; the Date itself for Date
 * input, so legacy callers keep their exact stored value).
 */
export function parseLedgerDate(value: unknown, field = "date"): { iso: string; at: Date } {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail("INVALID_DATE", `${field} is not a valid date`);
    const iso = value.toISOString().slice(0, 10);
    assertYear(iso, field);
    return { iso, at: value };
  }
  if (typeof value !== "string") fail("INVALID_DATE", `${field} is required (YYYY-MM-DD)`);
  const s = value.trim();
  const m = ISO_DATE_RE.exec(s);
  if (!m) fail("INVALID_DATE", `${field} must be a date in YYYY-MM-DD format`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (mo < 1 || mo > 12 || d < 1 || d > dim) fail("INVALID_DATE", `${field} is not a real date`);
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  assertYear(iso, field);
  return { iso, at: new Date(`${iso}T00:00:00.000Z`) };
}

function assertYear(iso: string, field: string): void {
  const y = Number(iso.slice(0, 4));
  if (y < 1900 || y > 9999) fail("INVALID_DATE", `${field} must be between 1900 and 9999`);
}

export function assertNotFuture(iso: string, now: Date = new Date()): void {
  if (iso > todayIso(now)) {
    fail(
      "FUTURE_DATE",
      `Cannot post an entry dated in the future (${iso}). Posting dates must be on or before today.`,
      { date: iso }
    );
  }
}

/** Parse one amount field into fils; null/undefined/"" -> 0. */
export function amountToFils(
  value: LedgerAmount | null | undefined,
  field: string,
  rounding: Rounding = "reject"
): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value !== "number" && typeof value !== "string") {
    fail("INVALID_AMOUNT", `${field} must be a number or decimal string`, { field });
  }
  try {
    return toFils(value, { rounding });
  } catch (err) {
    const reason = err instanceof MoneyError ? err.code : "MONEY_INVALID";
    fail("INVALID_AMOUNT", `${field}: ${(err as Error).message}`, { field, reason });
  }
}

function filsField(value: unknown, field: string): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail("INVALID_AMOUNT", `${field} must be an integer number of fils`, { field });
  }
  if (Math.abs(value) > 999_999_999_999_999) {
    fail("INVALID_AMOUNT", `${field} exceeds the numeric(15,2) range`, {
      field,
      reason: "MONEY_OUT_OF_RANGE",
    });
  }
  return value;
}

export function normalizeRate(
  value: LedgerAmount | null | undefined,
  field: string
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = typeof value === "number" ? value.toString() : String(value).trim();
  if (!RATE_RE.test(s) || Number(s) <= 0) {
    fail("INVALID_EXCHANGE_RATE", `${field} must be a positive rate with at most 6 decimals`, {
      field,
    });
  }
  return s;
}

/** Legacy rates (floats) are rounded half-up to 6dp, as numeric(15,6) did. */
function legacyRate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return Number(s) > 0 ? s : null;
}

export function normalizeLine(
  line: PostJournalLineInput,
  index: number,
  rounding: Rounding
): NormalizedLine {
  const p = `lines[${index}]`;
  if (!line || typeof line !== "object") fail("INVALID_LINE", `${p} must be an object`);
  if (!isUuid(line.accountId)) {
    fail("ACCOUNT_NOT_FOUND", `${p}.accountId must be an account id of this company`, {
      line: index,
    });
  }
  const debit =
    amountToFils(line.debit, `${p}.debit`, rounding) + filsField(line.debitFils, `${p}.debitFils`);
  const credit =
    amountToFils(line.credit, `${p}.credit`, rounding) +
    filsField(line.creditFils, `${p}.creditFils`);
  if (debit < 0 || credit < 0) {
    fail(
      "NEGATIVE_JOURNAL_AMOUNT",
      "Journal line amounts cannot be negative. Put the amount in the opposite column.",
      { line: index }
    );
  }
  if (debit > 0 && credit > 0) {
    fail("LINE_HAS_BOTH_SIDES", "A journal line is a debit or a credit, never both.", {
      line: index,
    });
  }
  if (debit === 0 && credit === 0) {
    fail("ZERO_AMOUNT_LINE", `${p} has no amount. Remove empty lines.`, { line: index });
  }

  const foreignDebit = amountToFils(line.foreignDebit, `${p}.foreignDebit`, rounding);
  const foreignCredit = amountToFils(line.foreignCredit, `${p}.foreignCredit`, rounding);
  if (foreignDebit < 0 || foreignCredit < 0) {
    fail("NEGATIVE_JOURNAL_AMOUNT", `${p} foreign amounts cannot be negative`, { line: index });
  }
  if ((foreignDebit > 0 && debit === 0) || (foreignCredit > 0 && credit === 0)) {
    fail(
      "FOREIGN_SIDE_MISMATCH",
      `${p} foreign amount must be on the same side as the base amount`,
      {
        line: index,
      }
    );
  }
  let foreignCurrency: string | null = null;
  if (
    line.foreignCurrency !== undefined &&
    line.foreignCurrency !== null &&
    line.foreignCurrency !== ""
  ) {
    const c = String(line.foreignCurrency).trim().toUpperCase();
    if (!CURRENCY_RE.test(c)) {
      fail("INVALID_CURRENCY", `${p}.foreignCurrency must be an ISO 4217 code`, { line: index });
    }
    foreignCurrency = c;
  }
  const exchangeRate =
    rounding === "halfUp"
      ? legacyRate(line.exchangeRate)
      : normalizeRate(line.exchangeRate, `${p}.exchangeRate`);

  let costCenterId: string | null = null;
  if (line.costCenterId !== undefined && line.costCenterId !== null && line.costCenterId !== "") {
    if (!isUuid(line.costCenterId)) {
      fail("COST_CENTER_NOT_FOUND", `${p}.costCenterId is not a cost centre of this company`, {
        line: index,
      });
    }
    costCenterId = line.costCenterId.toLowerCase();
  }

  return {
    accountId: line.accountId.toLowerCase(),
    debitFils: debit,
    creditFils: credit,
    description: line.description == null ? null : String(line.description),
    costCenterId,
    foreignCurrency,
    foreignDebitFils: foreignDebit,
    foreignCreditFils: foreignCredit,
    exchangeRate,
  };
}

/** Totals + the exact-balance and same-account rules over normalised lines. */
export function assertLinesBalanced(
  lines: NormalizedLine[],
  opts: { allowSameAccount?: boolean } = {}
): { debitFils: number; creditFils: number } {
  let debitFils = 0;
  let creditFils = 0;
  for (const l of lines) {
    debitFils += l.debitFils;
    creditFils += l.creditFils;
  }
  if (lines.length < 2) {
    fail("TOO_FEW_LINES", "A journal entry needs at least one debit and one credit line");
  }
  if (debitFils !== creditFils) {
    fail(
      "ENTRY_UNBALANCED",
      `Debits (${(debitFils / 100).toFixed(2)}) must equal credits (${(creditFils / 100).toFixed(2)}) exactly`,
      { debitFils, creditFils, differenceFils: debitFils - creditFils }
    );
  }
  if (!opts.allowSameAccount) {
    const net = new Map<string, number>();
    for (const l of lines)
      net.set(l.accountId, (net.get(l.accountId) ?? 0) + l.debitFils - l.creditFils);
    if ([...net.values()].every((n) => n === 0)) {
      fail(
        "SAME_ACCOUNT_ENTRY",
        "Every account in this entry nets to zero, so it would not change the books",
        { accounts: [...net.keys()] }
      );
    }
  }
  return { debitFils, creditFils };
}

export function normalizeEntry(
  input: PostJournalInput,
  opts: { now?: Date } = {}
): NormalizedEntry {
  if (!input || typeof input !== "object") fail("INVALID_ENTRY", "Journal input is required");
  if (!isUuid(input.companyId)) fail("INVALID_COMPANY", "companyId must be a UUID");
  const status = input.status;
  if (status !== "draft" && status !== "posted") {
    fail("INVALID_STATUS", "status must be 'draft' or 'posted'");
  }
  const kind: EntryKind = input.kind ?? "standard";
  if (!ENTRY_KINDS.includes(kind))
    fail("INVALID_KIND", `kind must be one of ${ENTRY_KINDS.join(", ")}`);
  const { iso, at } = parseLedgerDate(input.date);
  if (!input.allowFutureDate) assertNotFuture(iso, opts.now);

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    fail("TOO_FEW_LINES", "A journal entry needs at least one debit and one credit line");
  }
  if (input.lines.length > MAX_LINES) fail("TOO_MANY_LINES", `At most ${MAX_LINES} lines`);
  const rounding: Rounding = input.amountRounding === "halfUp" ? "halfUp" : "reject";
  const lines = input.lines.map((l, i) => normalizeLine(l, i, rounding));
  const totals = assertLinesBalanced(lines, { allowSameAccount: input.allowSameAccount });

  let autoReverseOn: string | null = null;
  if (input.autoReverseOn) {
    autoReverseOn = parseLedgerDate(input.autoReverseOn, "autoReverseOn").iso;
    if (autoReverseOn <= iso) {
      fail("INVALID_AUTO_REVERSE_DATE", "autoReverseOn must be after the entry date");
    }
  }
  if (input.sourceId != null && input.sourceId !== "" && !isUuid(input.sourceId)) {
    fail("INVALID_SOURCE_ID", "sourceId must be a UUID");
  }
  const idempotencyKey =
    input.idempotencyKey == null || input.idempotencyKey === ""
      ? null
      : String(input.idempotencyKey);
  if (idempotencyKey && idempotencyKey.length > 200) {
    fail("INVALID_IDEMPOTENCY_KEY", "idempotencyKey must be at most 200 characters");
  }

  return {
    companyId: input.companyId.toLowerCase(),
    dateIso: iso,
    dateAt: at,
    memo: input.memo == null ? null : String(input.memo),
    reference: input.reference == null || input.reference === "" ? null : String(input.reference),
    source: input.source || "manual",
    sourceId: input.sourceId ? input.sourceId.toLowerCase() : null,
    idempotencyKey,
    status,
    kind,
    autoReverseOn,
    lines,
    totalDebitFils: totals.debitFils,
    totalCreditFils: totals.creditFils,
  };
}
