import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Company } from '@shared/schema';
import { getActiveCompanyId } from '@/lib/activeCompany';

/**
 * Returns the user's currently-active company. If the user has explicitly
 * switched to a company (persisted in localStorage), that takes precedence;
 * otherwise we fall back to the first company in the list — matching the
 * historical single-company-per-user behaviour.
 *
 * The hook re-renders when `muhasib:active-company-changed` fires so any
 * consumer reflects the switch without a manual refetch.
 */
export function useDefaultCompany() {
  const { data: companies, isLoading, error } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });

  const [activeId, setActiveId] = useState<string | null>(() => getActiveCompanyId());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setActiveId(getActiveCompanyId());
    window.addEventListener('muhasib:active-company-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('muhasib:active-company-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const matchedById = activeId ? companies?.find((c) => c.id === activeId) : undefined;
  const fallback = companies?.[0];
  const company = matchedById ?? fallback;

  return {
    company,
    companyId: company?.id,
    isLoading,
    error,
  };
}
