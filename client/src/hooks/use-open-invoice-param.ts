import { useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";

/**
 * Notification and command-palette links open an invoice with `/invoices?open=<id>`. The param
 * must be honoured on EVERY navigation, not only the first mount: the bell navigates while the
 * invoices page is already mounted, so a mount-only effect did nothing (STEP1 F3). The param is
 * consumed (replace-navigation, so the back button does not re-open it) and `onOpen` runs once
 * per link, including a second click on the same invoice.
 */
export function useOpenInvoiceParam(onOpen: (invoiceId: string) => void) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const handler = useRef(onOpen);
  handler.current = onOpen;
  useEffect(() => {
    const params = new URLSearchParams(search);
    const openId = params.get("open");
    if (!openId) return;
    params.delete("open");
    const query = params.toString();
    const hash = typeof window === "undefined" ? "" : window.location.hash;
    navigate(location + (query ? `?${query}` : "") + hash, { replace: true });
    handler.current(openId);
    // `location` is read only to rebuild the URL; the link is identified by the search string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
}
