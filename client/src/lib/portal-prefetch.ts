import type { QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/**
 * Warm the customer portal's first screens as soon as a portal user signs in: the dashboard, the
 * invoice list, the supplier header and the switcher load in parallel with the redirect, so the
 * landing page paints from cache instead of waiting for four round trips. The keys and freshness
 * match what the pages read (`PortalDashboard`, `PortalInvoices`, `PortalLayout`), so a prefetched
 * result is reused, never fetched twice. Failures are ignored: the page fetches again itself.
 */
export function prefetchPortalData(queryClient: QueryClient): void {
  const jobs: Array<{ key: string; path: string; staleTime: number }> = [
    { key: "portal-company", path: "/api/client-portal/company", staleTime: 5 * 60_000 },
    { key: "portal-accounts", path: "/api/client-portal/accounts", staleTime: 5 * 60_000 },
    { key: "portal-dashboard", path: "/api/client-portal/dashboard", staleTime: 60_000 },
    { key: "portal-invoices", path: "/api/client-portal/invoices", staleTime: 60_000 },
    { key: "portal-documents", path: "/api/client-portal/documents", staleTime: 60_000 },
  ];
  for (const { key, path, staleTime } of jobs) {
    void queryClient
      .prefetchQuery({ queryKey: [key], queryFn: () => apiRequest("GET", path), staleTime })
      .catch(() => undefined);
  }
}
