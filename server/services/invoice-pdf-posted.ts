import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { accounts, journalEntries, journalLines } from "../../shared/schema";
import type { Invoice } from "../../shared/schema";
import { fromFils, sumFils, toFils } from "../../shared/money";
import { SALES_CODES } from "./invoice-posting.service";

/**
 * Output VAT of a sales invoice in the base currency (AED) exactly as POSTED: credits less debits
 * on the output VAT account of the invoice's live standard journal entry. Returns null when the
 * invoice has no posted entry (a draft), so the caller falls back to the stored rate.
 * One invoice's journal lines only; nothing is aggregated in Node beyond that.
 */
export async function postedInvoiceVatBase(
  invoice: Pick<Invoice, "id" | "companyId">
): Promise<number | null> {
  const rows = await db
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalEntries)
    .innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.companyId, invoice.companyId),
        eq(journalEntries.source, "invoice"),
        eq(journalEntries.sourceId, invoice.id),
        eq(journalEntries.status, "posted"),
        eq(journalEntries.entryKind, "standard"),
        eq(accounts.companyId, invoice.companyId),
        eq(accounts.isVatAccount, true),
        eq(accounts.code, SALES_CODES.VAT_OUTPUT),
        sql`${journalEntries.reversedEntryId} IS NULL`,
        sql`${journalEntries.reversedByEntryId} IS NULL`
      )
    );
  if (!rows.length) return null;
  return Number(fromFils(sumFils(rows.map((r) => toFils(r.credit) - toFils(r.debit)))));
}
