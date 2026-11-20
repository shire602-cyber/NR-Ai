/**
 * Compatibility facade over server/services/bank-feeds (W3-C, R06-14/R06-19).
 *
 * The old Wio/Lean classes built auth URLs with empty credentials and arbitrary redirect URIs and
 * never verified OAuth state. All provider logic now lives in bank-feeds/adapters.ts behind the
 * adapter contract; this module only answers "which providers are configured".
 */
import { BANK_FEED_ADAPTERS, providerStatuses } from "./bank-feeds";

export { providerStatuses };

/** Providers that have credentials in this deployment. */
export function getAvailableProviders(): string[] {
  return Object.values(BANK_FEED_ADAPTERS)
    .filter((a) => a.isConfigured())
    .map((a) => a.id);
}

export function isOpenBankingConfigured(): boolean {
  return getAvailableProviders().length > 0;
}

/** Check if a token needs refresh (expires within 5 minutes). */
export function tokenNeedsRefresh(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return new Date() >= new Date(expiresAt.getTime() - 5 * 60 * 1000);
}
