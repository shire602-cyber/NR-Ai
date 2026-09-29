import { storage } from "../storage";
import { validateRevenueAccounts, type RevenueAccountCheck } from "./revenue-allocation.service";

/**
 * Tenant-scoped check of the revenue accounts chosen on document lines.
 * `getAccountsByCompanyId` only returns this company's chart, so an account id
 * belonging to another company is simply "not found" (same approach as the
 * journal routes). Skips the query entirely when no line chose an account.
 */
export async function checkRevenueAccountsForCompany(
  companyId: string,
  ids: Array<string | null | undefined>
): Promise<RevenueAccountCheck> {
  if (!ids.some((id) => !!id)) return { ok: true };
  const accounts = await storage.getAccountsByCompanyId(companyId);
  return validateRevenueAccounts(accounts, ids);
}
