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

/**
 * Body of PATCH /api/companies/:id from the wizard's company step. Signup provisions the company
 * in the owner's language, but a company still on the default "en" while the owner is working in
 * Arabic (older signups, English-provisioned rows) is moved to "ar". An owner who is in English
 * never has an existing locale overwritten.
 */
export function existingCompanyPatch(
  data: Record<string, unknown>,
  currentLocale: string | null | undefined,
  uiLocale: string
): Record<string, unknown> {
  return uiLocale === "ar" && currentLocale !== "ar" ? { ...data, locale: "ar" } : data;
}
