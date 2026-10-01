// How much of a monthly plan cap a company has used: the invoices and receipts it created this
// calendar month (UAE time). Counted from the rows themselves, so there is no counter to drift or
// to reset. Credit notes and opening-balance invoices are not "invoices created" for the cap.

import { and, count, eq, gte, ne } from "drizzle-orm";
import { db } from "../db";
import { invoices, receipts } from "../../shared/schema";
import { uaeCalendarDate } from "../utils/date";

export type CountedResource = "invoices" | "receipts";

/** First instant of the current UAE calendar month, as the UTC instant the database stores. */
export function monthStartUtc(now: Date = new Date()): Date {
  const day = uaeCalendarDate(now);
  const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1) - UAE_OFFSET_MS);
}

export async function countMonthlyUsage(
  companyId: string,
  resource: CountedResource,
  now: Date = new Date()
): Promise<number> {
  const since = monthStartUtc(now);
  if (resource === "receipts") {
    const [row] = await db
      .select({ n: count() })
      .from(receipts)
      .where(and(eq(receipts.companyId, companyId), gte(receipts.createdAt, since)));
    return Number(row?.n ?? 0);
  }
  const [row] = await db
    .select({ n: count() })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, companyId),
        ne(invoices.invoiceType, "credit_note"),
        eq(invoices.isOpeningBalance, false),
        gte(invoices.createdAt, since)
      )
    );
  return Number(row?.n ?? 0);
}
