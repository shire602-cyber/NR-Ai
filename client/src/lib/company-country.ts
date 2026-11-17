/** Saudi Arabia (KSA) companies only: ZATCA e-invoicing settings are hidden for everyone else. */
export function isSaudiCompany(company: { addressCountry?: string | null } | null | undefined) {
  const c = (company?.addressCountry ?? "").trim().toUpperCase();
  return c === "SA" || c === "KSA" || c === "SAUDI ARABIA";
}
