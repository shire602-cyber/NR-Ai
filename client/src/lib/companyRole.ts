/** Client-side helpers for the signed-in user's role on a company (`myRole` from /api/companies). */

export interface CompanyWithRole {
  myRole?: string | null;
}

/**
 * Only the company owner runs the initial setup wizard. `myRole` is null for companies the
 * user reaches without a direct membership (firm staff), who keep the previous behaviour.
 */
export function isNonOwnerMember(company: object | undefined | null): boolean {
  const role = (company as CompanyWithRole | undefined | null)?.myRole;
  return !!role && role !== "owner";
}

export function canRunCompanyOnboarding(company: object | undefined | null): boolean {
  return !isNonOwnerMember(company);
}

/**
 * Drop blank strings from an update payload so a form field the user left empty never
 * overwrites a value already stored on the company (the TRN given at registration, J3).
 */
export function withoutBlankValues<T extends Record<string, unknown>>(data: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && value.trim() === "") continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}
