import type { PortalInviteLanguage } from "@shared/validators/portal-invitations";

/** The contact's language preference, else both languages (the customer's language is unknown). */
export function defaultInviteLanguage(pref: string | null | undefined): PortalInviteLanguage {
  return pref === "ar" ? "ar" : pref === "en" ? "en" : "bilingual";
}

export const portalSummaryKey = (companyId: string) =>
  [`/api/companies/${companyId}/portal-access/summary`] as const;

export const portalAccessKey = (companyId: string, contactId: string) =>
  [`/api/companies/${companyId}/customer-contacts/${contactId}/portal-access`] as const;
