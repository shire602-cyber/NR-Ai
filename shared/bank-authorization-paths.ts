export const BANK_AUTHORIZATION_RETURN_PATH = "/bank-feeds/callback";
export const LEGACY_BANK_AUTHORIZATION_RETURN_PATH = "/banking/callback";

export function isBankAuthorizationReturnPath(pathname: string): boolean {
  return (
    pathname === BANK_AUTHORIZATION_RETURN_PATH ||
    pathname === LEGACY_BANK_AUTHORIZATION_RETURN_PATH
  );
}
