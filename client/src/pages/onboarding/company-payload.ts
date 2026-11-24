// Body of POST /api/companies from the onboarding wizard. Pure so a unit test pins it.

/**
 * A new company starts in AED with the language the owner is using while signing up: an Arabic
 * signup gets Arabic invoices, PDFs and e-mails by default instead of a silent English company
 * (the company locale was previously hard-coded to "en").
 */
export function newCompanyPayload(
  data: Record<string, unknown>,
  uiLocale: string
): Record<string, unknown> {
  return {
    ...data,
    baseCurrency: "AED",
    locale: uiLocale === "ar" ? "ar" : "en",
    companyType: "customer",
  };
}
