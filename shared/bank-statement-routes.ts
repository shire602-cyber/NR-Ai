export const BANK_STATEMENT_ENTRY = "/bank-reconciliation?import=1";

export function isRetiredBankReturnPath(path: string): boolean {
  const normalized = path.replace(/\/$/, "");
  return normalized === "/bank-feeds/callback" || normalized === "/banking/callback";
}
