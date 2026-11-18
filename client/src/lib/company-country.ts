/** Saudi Arabia (KSA) companies only: ZATCA e-invoicing settings are hidden for everyone else. */
export function isSaudiCompany(company: { addressCountry?: string | null } | null | undefined) {
  const c = (company?.addressCountry ?? "").trim().toUpperCase();
  return c === "SA" || c === "KSA" || c === "SAUDI ARABIA";
}

/**
 * WQ3 (12.10): the default VAT rates a company may choose: 0% and its own jurisdiction's
 * standard rate. 15% is offered only to a Saudi (ZATCA) company while the server's ZATCA flag is
 * on (hidden at launch), never to a UAE company; the server refuses the mismatch too
 * (VAT_RATE_NOT_FOR_COUNTRY).
 */
export function vatRateOptionsFor<T extends { value: string }>(
  country: string | null | undefined,
  options: readonly T[],
  zatcaEnabled = false
): T[] {
  const standard = zatcaEnabled && isSaudiCompany({ addressCountry: country }) ? "0.15" : "0.05";
  return options.filter((o) => o.value === "0" || o.value === standard);
}
