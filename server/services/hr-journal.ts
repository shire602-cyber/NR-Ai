// Journal helpers shared by employee loans and final settlements. Everything posts through
// storage.createJournalEntry (month lock and period re-check inside), with assertPeriodNotLocked first so a
// locked month is a clean 403 before anything is written.

import { storage } from "../storage";
import { db } from "../db";
import { AppError } from "../errors";
import { assertPeriodNotLocked } from "./period-lock.service";
import { ensureSystemAccount } from "./inventory-costing.service";
import { ACCOUNT_CODES } from "../constants";
import { isCashOrBankAccount } from "./financial-statements";

export interface HrJournalLine {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

const utcMidnight = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

export async function postHrJournal(args: {
  companyId: string;
  dateYmd: string;
  memo: string;
  source: string;
  sourceId: string;
  userId: string;
  lines: HrJournalLine[];
}): Promise<{ id: string; entryNumber: string }> {
  const date = utcMidnight(args.dateYmd);
  await assertPeriodNotLocked(args.companyId, date);
  const lines = args.lines.filter((l) => l.debit > 0 || l.credit > 0);
  const entryNumber = await storage.generateEntryNumber(args.companyId, date);
  const entry = await storage.createJournalEntry(
    {
      companyId: args.companyId,
      date,
      memo: args.memo,
      entryNumber,
      status: "posted",
      source: args.source,
      sourceId: args.sourceId,
      createdBy: args.userId,
      postedBy: args.userId,
      postedAt: date,
    } as any,
    lines
  );
  return { id: entry.id, entryNumber: entry.entryNumber ?? entryNumber };
}

/** An exact reversal of a posted entry, on the original date (403 when that month is locked). */
export async function reverseHrJournal(args: {
  companyId: string;
  entryId: string;
  source: string;
  sourceId: string;
  userId: string;
  memo: string;
}): Promise<{ id: string }> {
  const original = await storage.getJournalEntryById(args.entryId);
  if (!original || original.companyId !== args.companyId) {
    throw new AppError({ message: "The original journal entry was not found.", statusCode: 404, code: "JOURNAL_NOT_FOUND" });
  }
  const lines = await storage.getJournalLinesByEntryId(args.entryId);
  const date = original.date instanceof Date ? original.date : new Date(original.date);
  await assertPeriodNotLocked(args.companyId, date);
  const entryNumber = await storage.generateEntryNumber(args.companyId, date);
  const entry = await storage.createJournalEntry(
    {
      companyId: args.companyId,
      date,
      memo: args.memo,
      entryNumber,
      status: "posted",
      source: args.source,
      sourceId: args.sourceId,
      createdBy: args.userId,
      postedBy: args.userId,
      postedAt: date,
      reversedEntryId: args.entryId,
    } as any,
    lines.map((l) => ({
      accountId: l.accountId,
      debit: l.credit,
      credit: l.debit,
      description: `Reversal - ${l.description ?? ""}`.slice(0, 255),
      ...((l as any).projectId ? { projectId: (l as any).projectId } : {}),
    }))
  );
  return { id: entry.id };
}

/** 1080 Employee Loans: created from the default chart for a company that predates it. */
export async function ensureEmployeeLoansAccount(companyId: string): Promise<string> {
  try {
    return (await ensureSystemAccount(db as any, companyId, ACCOUNT_CODES.EMPLOYEE_LOANS, "asset")).id;
  } catch (err: any) {
    // two requests creating it at once: the unique (company, code) index refuses the second
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      return (await ensureSystemAccount(db as any, companyId, ACCOUNT_CODES.EMPLOYEE_LOANS, "asset")).id;
    }
    throw err;
  }
}

/** A loan is paid from, and repaid to, a cash or bank account of the company. */
export async function assertCashOrBankAccount(companyId: string, accountId: string): Promise<{ id: string; code: string }> {
  const account = await storage.getAccount(accountId, companyId);
  const bad = !account || account.type !== "asset" || [ACCOUNT_CODES.AR, ACCOUNT_CODES.INVENTORY, ACCOUNT_CODES.EMPLOYEE_LOANS].includes(account.code as any) || !isCashOrBankAccount(account);
  if (bad) {
    throw new AppError({
      message: "The payment account must be a cash or bank account of this company.",
      statusCode: 422,
      code: "INVALID_PAYMENT_ACCOUNT",
    });
  }
  return { id: account!.id, code: account!.code };
}
