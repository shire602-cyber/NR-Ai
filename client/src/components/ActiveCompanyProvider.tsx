import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Company } from "@shared/schema";
import { ReceiptQueueProvider } from "@/components/receipts/ReceiptQueueProvider";
import {
  getActiveCompanyId,
  resolveActiveCompany,
  switchActiveCompany,
  clearActiveCompany,
} from "@/lib/activeCompany";

type WorkspaceCompany = Company & { hasPostedDocuments?: boolean };

/**
 * What is known about the company list. "empty" means a successful response listed no company;
 * "waiting" is a paused request and "error" a failed one, neither of which says there is none.
 */
export type CompanyListState = "ready" | "empty" | "loading" | "waiting" | "error";

interface ActiveCompanyContextValue {
  /** The currently active company (firm-managed client if switched, else first owned company). */
  company: WorkspaceCompany | undefined;
  /** Convenience accessor for the company id. */
  companyId: string | undefined;
  /** Full list of companies the user can access (owned + firm-accessible). */
  companies: WorkspaceCompany[];
  /** True while the underlying company list is loading. */
  isLoading: boolean;
  /** Error from the underlying company query, if any. */
  error: unknown;
  /** True only when a successful response listed no accessible company. */
  hasNoCompanies: boolean;
  /** State of the company-list query, for screens that must tell "none" from "not known". */
  companyListState: CompanyListState;
  /** Fetch the company list again (that query only). */
  retryCompanyList: () => void;
  /** True when the user has explicitly switched into a firm-managed client. */
  isFirmContext: boolean;
  /** True from the moment a client switch is committed until the company list has caught up. */
  isSwitchingClient: boolean;
  /** Switch into a firm-managed client's company workspace. Resolves once the query cache is reset. */
  setActiveClientCompany(companyId: string): Promise<void>;
  /** Drop firm-client override and return to the user's own company. */
  clearActiveClientCompany: () => void;
}

const ActiveCompanyContext = createContext<ActiveCompanyContextValue | null>(null);

export function ActiveCompanyProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(() => getActiveCompanyId());

  // Stay in sync with `switchActiveCompany`/`clearActiveCompany` from
  // `lib/activeCompany.ts` (CustomEvent) and with cross-tab storage updates.
  // Also listen for same-tab `auth:logout` so the in-memory active-client id
  // does not leak into the next user's session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setActiveId(getActiveCompanyId());
    const onLogout = () => setActiveId(null);
    window.addEventListener("muhasib:active-company-changed", handler);
    window.addEventListener("storage", handler);
    window.addEventListener("auth:logout", onLogout);
    return () => {
      window.removeEventListener("muhasib:active-company-changed", handler);
      window.removeEventListener("storage", handler);
      window.removeEventListener("auth:logout", onLogout);
    };
  }, []);

  // /api/companies returns a merged list (direct + firm-accessible) for firm
  // staff, so we can resolve the active company id locally.
  const {
    data: companies,
    isLoading,
    error,
    fetchStatus,
    isSuccess,
    isError,
    isLoadingError,
    refetch,
  } = useQuery<WorkspaceCompany[]>({
    queryKey: ["/api/companies"],
  });
  const companyListState: CompanyListState = companies?.length
    ? "ready"
    : isSuccess
      ? "empty"
      : isLoadingError
        ? "error"
        : fetchStatus === "paused"
          ? "waiting"
          : isError
            ? "error"
            : "loading";
  const retryCompanyList = useCallback(() => void refetch(), [refetch]);

  const [switchingClient, setSwitchingClient] = useState(false);
  const setActiveClientCompany = useCallback(async (id: string) => {
    // Commit the id synchronously so the shell never renders the open-books click against the staffer's
    // own company (and bounces them to their own onboarding wizard) before the switch lands.
    setSwitchingClient(true);
    setActiveId(id);
    try {
      await switchActiveCompany(id);
      setActiveId(id);
    } finally {
      setSwitchingClient(false);
    }
  }, []);

  const clearActiveClientCompany = useCallback(() => {
    clearActiveCompany();
    // Mirror switchActiveCompany: drop the previous client's tenant-scoped data
    // so the firm workspace re-renders fresh instead of showing stale panels.
    void queryClient.cancelQueries().then(() => {
      queryClient.removeQueries();
      void queryClient.invalidateQueries();
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("muhasib:active-company-changed", { detail: { companyId: null } })
      );
    }
    setActiveId(null);
  }, [queryClient]);

  const value = useMemo<ActiveCompanyContextValue>(() => {
    const list = companies ?? [];
    const activeMatch = activeId ? list.find((c) => c.id === activeId) : undefined;
    const company = resolveActiveCompany(list, activeId);
    return {
      company,
      companyId: company?.id,
      companies: list,
      isLoading,
      error,
      hasNoCompanies: companyListState === "empty",
      companyListState,
      retryCompanyList,
      isFirmContext: !!activeMatch && activeMatch.companyType === "client",
      isSwitchingClient: switchingClient,
      setActiveClientCompany,
      clearActiveClientCompany,
    };
  }, [
    companies,
    activeId,
    isLoading,
    error,
    companyListState,
    retryCompanyList,
    switchingClient,
    setActiveClientCompany,
    clearActiveClientCompany,
  ]);

  return (
    <ActiveCompanyContext.Provider value={value}>
      <ReceiptQueueProvider>{children}</ReceiptQueueProvider>
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
    throw new Error("useActiveCompany must be used within ActiveCompanyProvider");
  }
  return ctx;
}
