/**
 * Public types of the ledger kernel (frozen API; see server/ledger/README.md).
 */
import type { Request } from "express";
import type { JournalEntry, JournalLine } from "../../shared/schema";
import type { db } from "../db";
import type { ControlLedger } from "../../shared/control-accounts";

/** A drizzle transaction (or the db handle) the kernel can run statements on. */
export type LedgerTx = typeof db;

/** Major-unit amount: decimal string "1234.50" or a JS number with at most 2 decimals. */
export type LedgerAmount = string | number;

export const ENTRY_KINDS = [
  "standard",
  "reversal",
  "closing",
  "year_end_close",
  "opening",
  "revaluation",
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export interface PostJournalLineInput {
  accountId: string;
  /** Major units ("100.01"). Use debit/credit OR debitFils/creditFils. */
  debit?: LedgerAmount | null;
  credit?: LedgerAmount | null;
  /** Integer fils (10001 = 100.01). */
  debitFils?: number;
  creditFils?: number;
  description?: string | null;
  costCenterId?: string | null;
  /** ISO 4217 code of the original document currency (null = base currency). */
  foreignCurrency?: string | null;
  foreignDebit?: LedgerAmount | null;
  foreignCredit?: LedgerAmount | null;
  /** 1 foreignCurrency = exchangeRate base units; > 0, at most 6 decimals. */
  exchangeRate?: LedgerAmount | null;
  /**
   * B1 (NC1): the posting service derived this line itself from a VAT treatment (the input /
   * output VAT of a bank-line entry or a receipt). Such a line may sit on a VAT control account
   * although the entry's source is not a VAT sub-ledger; every other line is the user's choice
   * and is held to the control-account rule. Never set from request input.
   */
  systemVat?: boolean;
  /**
   * C1 (RH1 / RH2 / RM1): the posting service derived this line's account itself as one of its
   * own control legs (the invoice's receivable, the bill's payable, the stock movement's inventory
   * account, the payroll run's payables, a revaluation of a control balance). It names the control
   * ledger the leg belongs to ("any" only for a flow whose every line is a control balance it
   * computed itself, such as an FX revaluation). The kernel lets such a line sit on a control
   * account of that ledger. Every other line, on every source, carries an account somebody chose
   * and may not touch a control account unless the entry is a reasoned control-account adjustment.
   * Never set from request input.
   */
  controlLeg?: ControlLedger | "any";
  /**
   * WQ3 (9.4 / 9.16): descriptive per-line attributes of a manual journal, stored on the line and
   * copied by a reversal. They never change the amounts or the control-account gate.
   */
  attributes?: JournalLineAttributes | null;
}

/** WQ3: per-line contact, VAT treatment and corporate-tax treatment (shared/journal-line-treatments). */
export interface JournalLineAttributes {
  contactType?: "customer" | "vendor" | null;
  contactId?: string | null;
  vatTreatment?: "standard" | "zero_rated" | "exempt" | "out_of_scope" | null;
  ctTreatment?: "deductible" | "non_deductible" | "exempt_income" | null;
  /** Non-deductible share in percent (0 < pct <= 100, 2 decimals). */
  ctDisallowedPct?: string | null;
}

export interface PostJournalInput {
  companyId: string;
  /** "YYYY-MM-DD" (preferred) or a Date. */
  date: string | Date;
  memo?: string | null;
  /** manual | invoice | receipt | payment | bill | payroll | ... (default "manual"). */
  source?: string;
  sourceId?: string | null;
  /** Unique per company; a repeat returns the original entry (replayed: true). */
  idempotencyKey?: string | null;
  status: "draft" | "posted";
  lines: PostJournalLineInput[];
  kind?: EntryKind;
  reference?: string | null;
  /** Accruals: the auto-reverse job reverses the entry on this date (must be after `date`). */
  autoReverseOn?: string | null;
  /** Allow entries where every account nets to zero (default false -> 422 SAME_ACCOUNT_ENTRY). */
  allowSameAccount?: boolean;
  /** Allow a posting date after today (default false -> 422 FUTURE_DATE). */
  allowFutureDate?: boolean;
  /**
   * LEGACY ADAPTER ONLY. "halfUp" rounds each amount half-up to 2dp (what the
   * numeric(15,2) column did implicitly) before the exact balance check. New
   * callers must leave this unset: >2dp is a 422.
   */
  amountRounding?: "reject" | "halfUp";
  /**
   * B1 (NH1): the VAT return reports this entry from its own document record whatever its lines
   * (a bank-line entry with a VAT treatment, a fixed-asset disposal for consideration), so a
   * filed VAT period refuses it even when it carries no VAT line (exempt / zero-rated amounts).
   */
  reportsVat?: boolean;
}

export interface LedgerContext {
  /** Acting user (created_by / posted_by / audit). */
  actorId: string;
  /** Run inside the caller's transaction instead of opening a new one. */
  tx?: LedgerTx;
  /** Request for audit ip / user agent. */
  req?: Request;
  /** Restrict entry lookups (postDraft/reverse/void) to this company. */
  companyId?: string;
  /** Write a kernel audit row for postJournal (postDraft/reverse/void always audit). */
  audit?: boolean;
  /**
   * A2 (H8) / B1 (NC1): an explicit control-account adjustment for an entry whose source is not a
   * sub-ledger. `role` is the user's company role (null = firm staff through access rules). The
   * kernel checks it and stamps the reason on the entry in the posting transaction.
   */
  controlAdjustment?: { reason: string; role: string | null } | null;
}

export interface NormalizedLine {
  accountId: string;
  debitFils: number;
  creditFils: number;
  description: string | null;
  costCenterId: string | null;
  foreignCurrency: string | null;
  foreignDebitFils: number;
  foreignCreditFils: number;
  exchangeRate: string | null;
  /** See PostJournalLineInput.systemVat. */
  systemVat?: boolean;
  /** See PostJournalLineInput.controlLeg. */
  controlLeg?: ControlLedger | "any";
  /** See PostJournalLineInput.attributes. */
  attributes?: JournalLineAttributes;
}

export interface NormalizedEntry {
  companyId: string;
  dateIso: string;
  dateAt: Date;
  memo: string | null;
  reference: string | null;
  source: string;
  sourceId: string | null;
  idempotencyKey: string | null;
  status: "draft" | "posted";
  kind: EntryKind;
  autoReverseOn: string | null;
  lines: NormalizedLine[];
  totalDebitFils: number;
  totalCreditFils: number;
  /** See PostJournalInput.reportsVat. */
  reportsVat?: boolean;
}

export interface PostJournalResult {
  entry: JournalEntry;
  lines: JournalLine[];
  /** true when idempotencyKey matched an existing entry (nothing was written). */
  replayed: boolean;
}

export interface ReverseOptions {
  /** Reversal date. Default: the original date if its period is open, else today. */
  date?: string | Date | null;
  reason?: string | null;
  /**
   * Scheduled reversals (accrual / revaluation auto-reversal on as-of + 1 day):
   * allow an explicit `date` after today. Default false -> 422 FUTURE_DATE.
   */
  allowFutureDate?: boolean;
  /** Source tag of the reversal entry (default "reversal"). */
  source?: string | null;
  /** source_id of the reversal entry (default: the original entry id). */
  sourceId?: string | null;
  /** Memo of the reversal entry (default "Reversal of <entry number>[: reason]"). */
  memo?: string | null;
}

export interface ReverseResult {
  original: JournalEntry;
  reversal: JournalEntry;
  lines: JournalLine[];
}

export interface PostDraftOptions {
  /**
   * Maker-checker: when the entry's total debit (fils) exceeds this and the
   * entry is not approved, the creator gets 409 APPROVAL_REQUIRED; a different
   * user posting approves and posts in the same statement.
   */
  approvalThresholdFils?: number | null;
}
