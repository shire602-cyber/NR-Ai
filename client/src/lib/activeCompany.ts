import { queryClient } from './queryClient';

const ACTIVE_COMPANY_STORAGE_KEY = 'muhasib_active_company_id';

export function getActiveCompanyId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setActiveCompanyIdRaw(companyId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (companyId) {
      window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, companyId);
    } else {
      window.localStorage.removeItem(ACTIVE_COMPANY_STORAGE_KEY);
    }
  } catch {
    /* storage may be disabled — non-fatal */
  }
}

/**
 * Switch the active company and invalidate every query so all panels reflect
 * the new context. Most query keys in this app are either company-scoped
 * (`[/api/companies/:id/...]`) or downstream of `/api/companies` itself, so
 * the safe default is to invalidate the whole cache rather than try to
 * enumerate which keys could carry data from the previous tenant.
 */
export async function switchActiveCompany(companyId: string): Promise<void> {
  const previous = getActiveCompanyId();
  if (previous === companyId) return;

  setActiveCompanyIdRaw(companyId);

  // Cancel any in-flight queries from the previous tenant first so their
  // late responses don't overwrite cache entries for the new tenant.
  await queryClient.cancelQueries();
  // Drop everything — coarse but correct. Queries refetch on next mount.
  queryClient.removeQueries();
  await queryClient.invalidateQueries();

  // Notify any in-app listeners (some components key UI state off the active
  // company without holding a React Query subscription).
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('muhasib:active-company-changed', { detail: { companyId } }),
    );
  }
}

/** Clear the active company (e.g. on logout). */
export function clearActiveCompany(): void {
  setActiveCompanyIdRaw(null);
}
