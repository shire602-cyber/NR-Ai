export const BANK_STATEMENT_ENTRY = "/bank-feeds";

export function isRetiredBankReturnPath(path: string): boolean {
  const normalized = path.replace(/\/$/, "");
  return normalized === "/bank-feeds/callback" || normalized === "/banking/callback";
}
