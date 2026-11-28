/**
 * X5 (J1 L2): the company's postal address as one line, from the structured fields the
 * profile and onboarding save (street, city, country) with the legacy one-line address as the
 * fallback. Used where a form shows the taxpayer address (VAT 201 view).
 */
export interface CompanyAddressLike {
  businessAddress?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressCountry?: string | null;
  emirate?: string | null;
}

const COUNTRY_NAMES: Record<string, string> = { AE: "United Arab Emirates" };

export function companyAddressLine(
  c: CompanyAddressLike | null | undefined,
  countryName = (code: string) => COUNTRY_NAMES[code.toUpperCase()] ?? code
): string {
  if (!c) return "";
  const street = (c.addressStreet ?? "").trim();
  const city = (c.addressCity ?? "").trim();
  const legacy = (c.businessAddress ?? "").trim();
  const country = (c.addressCountry ?? "").trim();
  const parts = [street || legacy, city].filter(Boolean);
  if (parts.length === 0) return "";
  // Avoid repeating the city when the one-line address already ends with it.
  const unique = parts.filter(
    (p, i) => i === 0 || !parts[0].toLowerCase().includes(p.toLowerCase())
  );
  if (country) unique.push(countryName(country));
  return unique.join(", ");
}

/** "Quarterly (periods start Jan, Apr, Jul, Oct)" style description of the VAT stagger. */
export function vatStaggerLabel(
  frequency: string | null | undefined,
  startMonth: number | null | undefined,
  monthName: (m: number) => string,
  formatLabel = (frequency: string, months: string[]) =>
    months.length ? `${frequency} (${months.join(", ")})` : frequency
): string {
  const freq = (frequency ?? "").trim();
  const start = Number(startMonth) >= 1 && Number(startMonth) <= 12 ? Number(startMonth) : 1;
  if (!/^quarter/i.test(freq)) return formatLabel(freq, []);
  const months = [0, 3, 6, 9].map((o) => monthName(((start - 1 + o) % 12) + 1));
  return formatLabel(freq, months);
}
