import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Company } from '@shared/schema';
import {
  getActiveCompanyId,
  switchActiveCompany,
  clearActiveCompany,
} from '@/lib/activeCompany';

interface ActiveCompanyContextValue {
  /** The currently active company (firm-managed client if switched, else first owned company). */
  company: Company | undefined;
  /** Convenience accessor for the company id. */
  companyId: string | undefined;
  /** Full list of companies the user can access (owned + firm-accessible). */
  companies: Company[];
  /** True while the underlying company list is loading. */
  isLoading: boolean;
  /** Error from the underlying company query, if any. */
  error: unknown;
  /** True when the user has no accessible companies and the load is complete. */
  hasNoCompanies: boolean;
  /** True when the user has explicitly switched into a firm-managed client. */
  isFirmContext: boolean;
  /** Switch into a firm-managed client's company workspace. */
  setActiveClientCompany: (companyId: string) => void;
  /** Drop firm-client override and return to the user's own company. */
  clearActiveClientCompany: () => void;
}

const ActiveCompanyContext = createContext<ActiveCompanyContextValue | null>(null);

export function ActiveCompanyProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(() => getActiveCompanyId());

  // Stay in sync with `switchActiveCompany`/`clearActiveCompany` from
  // `lib/activeCompany.ts` (CustomEvent) and with cross-tab storage updates.
  // Also listen for same-tab `auth:logout` so the in-memory active-client id
  // does not leak into the next user's session.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setActiveId(getActiveCompanyId());
    const onLogout = () => setActiveId(null);
    window.addEventListener('muhasib:active-company-changed', handler);
    window.addEventListener('storage', handler);
    window.addEventListener('auth:logout', onLogout);
    return () => {
      window.removeEventListener('muhasib:active-company-changed', handler);
      window.removeEventListener('storage', handler);
      window.removeEventListener('auth:logout', onLogout);
    };
  }, []);

  // /api/companies returns a merged list (direct + firm-accessible) for firm
  // staff, so we can resolve the active company id locally.
  const { data: companies, isLoading, error } = useQuery<Company[]>({
    queryKey: ['/api/companies'],
  });

  const setActiveClientCompany = useCallback((id: string) => {
    void switchActiveCompany(id).then(() => setActiveId(id));
  }, []);

  const clearActiveClientCompany = useCallback(() => {
    clearActiveCompany();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('muhasib:active-company-changed', { detail: { companyId: null } }),
      );
    }
    setActiveId(null);
  }, []);

  const value = useMemo<ActiveCompanyContextValue>(() => {
    const list = companies ?? [];
    const activeMatch = activeId ? list.find(c => c.id === activeId) : undefined;
    const fallback = list[0];
    const company = activeMatch ?? fallback;
    return {
      company,
      companyId: company?.id,
      companies: list,
      isLoading,
      error,
      hasNoCompanies: !isLoading && !error && list.length === 0,
      isFirmContext: !!activeMatch && activeMatch.companyType === 'client',
      setActiveClientCompany,
      clearActiveClientCompany,
    };
  }, [companies, activeId, isLoading, error, setActiveClientCompany, clearActiveClientCompany]);

  return (
    <ActiveCompanyContext.Provider value={value}>
      {children}
    </ActiveCompanyContext.Provider>
  );
}

/**
 * Access the active company. For firm staff, this is the explicitly switched
 * client company (if any); otherwise it falls back to the user's own first
 * company.
 */
export function useActiveCompany(): ActiveCompanyContextValue {
  const ctx = useContext(ActiveCompanyContext);
  if (!ctx) {
    throw new Error('useActiveCompany must be used within ActiveCompanyProvider');
  }
  return ctx;
}
