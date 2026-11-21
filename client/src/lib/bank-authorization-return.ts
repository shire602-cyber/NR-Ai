import { useCallback, useLayoutEffect, useState } from "react";
import { useLocation } from "wouter";
import { useSearch } from "wouter/use-browser-location";
import {
  BANK_AUTHORIZATION_RETURN_PATH as callbackPath,
  LEGACY_BANK_AUTHORIZATION_RETURN_PATH as legacyCallbackPath,
  isBankAuthorizationReturnPath,
} from "@shared/bank-authorization-paths";

export type AuthorizationReturn =
  | { kind: "pending"; code: string; state: string }
  | { kind: "cancelled" | "failed" };

function readAuthorizationReturn(search: string): AuthorizationReturn {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  const status = params.get("status");
  if (error === "access_denied" || /^(?:cancelled|canceled)$/i.test(status ?? "")) {
    return { kind: "cancelled" };
  }
  const code = params.get("code") || params.get("entity_id");
  const state = params.get("state");
  return !error && code && state ? { kind: "pending", code, state } : { kind: "failed" };
}

/** The app router holds this in memory across the sign-in screen. */
export function useBankAuthorizationReturn(pathname: string) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const [capture, setCapture] = useState<{ search: string; returned: AuthorizationReturn } | null>(
    null
  );
  const clear = useCallback(() => setCapture(null), []);
  const isCallback = isBankAuthorizationReturnPath(pathname);
  const cleaning = isCallback && (pathname === legacyCallbackPath || Boolean(search));

  // Capture the raw browser search before the history entry is replaced or sign-in mounts.
  if (isCallback && search && search !== capture?.search) {
    setCapture({ search, returned: readAuthorizationReturn(search) });
  }

  useLayoutEffect(() => {
    if (cleaning && (window.location.search || window.location.pathname === legacyCallbackPath)) {
      navigate(callbackPath, { replace: true });
    }
  }, [cleaning, navigate]);

  return { isCallback, cleaning, returned: capture?.returned ?? null, clear };
}
