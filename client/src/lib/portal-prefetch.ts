import type { QueryClient } from "@tanstack/react-query";
import { portalQuery } from "@/lib/queryClient";
import { getPortalAccountSelection, PORTAL_SELECTION_REQUIRED } from "@/lib/portal-state";

/**
 * Warm the customer portal's first screens as soon as a portal user signs in: the supplier list
 * first, then the dashboard, invoice list, documents and supplier header for the supplier the
 * portal will open (the stored choice when it is still one of the customer's suppliers, else the
 * newest, which is what the server picks on a first visit). The keys come from `portalQuery`, the
 * same helper the pages use, so a prefetched result is reused and never fetched twice. A customer
 * who must choose a supplier is not prefetched for. Failures are ignored: the page fetches again.
 */
export async function prefetchPortalData(queryClient: QueryClient): Promise<void> {
  try {
    const selection = getPortalAccountSelection();
    if (selection === PORTAL_SELECTION_REQUIRED) return;
    const accounts = await queryClient.fetchQuery({
      ...portalQuery<Array<{ id: string }>>("/api/client-portal/accounts", selection),
      staleTime: 5 * 60_000,
    });
    const id = accounts.find((a) => a.id === selection)?.id ?? (selection ? null : accounts[0]?.id);
    if (!id) return;
    const pages = [
      { path: "/api/client-portal/company", staleTime: 5 * 60_000 },
      { path: "/api/client-portal/dashboard", staleTime: 60_000 },
      { path: "/api/client-portal/invoices", staleTime: 60_000 },
      { path: "/api/client-portal/documents", staleTime: 60_000 },
    ] as const;
    await Promise.allSettled(
      pages.map(({ path, staleTime }) =>
        queryClient.prefetchQuery({ ...portalQuery(path, id), staleTime })
      )
    );
  } catch {
    /* the portal fetches its own data */
  }
}
