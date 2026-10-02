// Default income account for service work: 4020 Service Revenue (not 4010 Product Sales).
// Lines built from time, recharged costs or a quote default to it unless the line is a product line or names
// its own revenue account. The chart is read from the caller's transaction so it works inside a posting lock.

import { and, eq } from "drizzle-orm";
import { accounts } from "../../shared/schema";
import { ACCOUNT_CODES } from "../constants";

/** The company's 4020 Service Revenue account id, or null for a chart that does not have it (the line then keeps the default). */
export async function serviceRevenueAccountId(tx: any, companyId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, ACCOUNT_CODES.REVENUE_ALT), eq(accounts.type, "income")))
    .limit(1);
  return row?.id ?? null;
}
