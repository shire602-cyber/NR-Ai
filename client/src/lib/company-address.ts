/** The company's address as one line: the single-line address when set, otherwise street, city and country. */
export function companyAddressLine(company: {
  businessAddress?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressCountry?: string | null;
} | null | undefined): string {
  if (!company) return "";
  const single = company.businessAddress?.trim();
  if (single) return single;
  return [company.addressStreet, company.addressCity, company.addressCountry]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}
