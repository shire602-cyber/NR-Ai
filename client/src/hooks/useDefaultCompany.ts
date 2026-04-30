import { useActiveCompany } from '@/components/ActiveCompanyProvider';

/**
 * Returns the user's currently-active company. For NRA firm staff this honours
 * an explicitly-switched client workspace; for everyone else it returns the
 * user's first company (or the company they last switched to via the
 * CompanySwitcher).
 *
 * Kept as a thin wrapper around `useActiveCompany` so the dozens of existing
 * call sites continue to work without changes.
 */
export function useDefaultCompany() {
  const { company, companyId, companies, isLoading, error, hasNoCompanies } =
    useActiveCompany();
  return {
    company,
    companyId,
    companies,
    hasNoCompanies,
    isLoading,
    error,
  };
}
