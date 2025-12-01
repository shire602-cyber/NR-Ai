import { useQuery } from '@tanstack/react-query';
import type { Company } from '@shared/schema';

/**
 * Hook to automatically get the user's default company (first company)
 * Since we only support one company per user, this returns the first company
 */
export function useDefaultCompany() {
  const { data: companies, isLoading, error } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });

  const defaultCompany = companies?.[0];

  return {
    company: defaultCompany,
    companyId: defaultCompany?.id,
    isLoading,
    error,
  };
}
