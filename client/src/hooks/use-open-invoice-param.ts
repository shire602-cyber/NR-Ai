import { useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";

/**
 * Notification and command-palette links open a record with `?open=<id>` (`/invoices?open=`,
 * `/receipts?open=`). The param must be honoured on EVERY navigation, not only the first mount:
 * the bell navigates while the page is already mounted, so a mount-only effect did nothing
 * (STEP1 F3). `onOpen` runs once per link, including a second click on the same record.
 *
 * The param is stripped shortly AFTER `onOpen` ran (history.replaceState, no router navigation):
 * the page may be re-mounted while the route transition settles, and a re-mounted instance must
 * still find the param to act on it. Stripping also keeps the back button from re-opening it.
 *
 * `path` is the page this instance belongs to (while a lazy page loads, the previous page is
 * still mounted and sees the new URL); `ready` (default true) delays acting until the page can,
 * e.g. until the list the record lives in has loaded.
 */
export function useOpenInvoiceParam(onOpen: (id: string) => void, path: string, ready = true) {
  const [location] = useLocation();
  const search = useSearch();
  const handler = useRef(onOpen);
  useEffect(() => {
    handler.current = onOpen;
  });
  useEffect(() => {
    if (!ready || (location !== path && !location.startsWith(`${path}/`))) return;
    const params = new URLSearchParams(search);
    const openId = params.get("open");
    if (!openId) return;
    handler.current(openId);
    window.setTimeout(() => {
      const current = new URLSearchParams(window.location.search);
      if (current.get("open") !== openId) return;
      current.delete("open");
      const query = current.toString();
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + (query ? `?${query}` : "") + window.location.hash
      );
    }, 400);
  }, [search, ready, location, path]);
}
