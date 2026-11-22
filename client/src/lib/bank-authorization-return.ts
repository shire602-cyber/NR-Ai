import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useSearch } from "wouter/use-browser-location";
import {
  BANK_AUTHORIZATION_RETURN_PATH as callbackPath,
  LEGACY_BANK_AUTHORIZATION_RETURN_PATH as legacyCallbackPath,
  isBankAuthorizationReturnPath,
} from "@shared/bank-authorization-paths";
import { bankAuthorizationReference } from "@shared/validators/banking";
import { apiRequest } from "@/lib/queryClient";

type Reference = { returnId: string; tabKey: string };
const storageKey = "muhasib:statement-authorization";

export function readBankReturnReference(): Reference | undefined {
  try {
    const value = bankAuthorizationReference.safeParse(
      JSON.parse(sessionStorage.getItem(storageKey) ?? "null")
    );
    return value.success ? value.data : undefined;
  } catch {
    return undefined;
  }
}

export function clearBankReturnReference(reference: Reference): void {
  if (readBankReturnReference()?.returnId === reference.returnId)
    sessionStorage.removeItem(storageKey);
}

export function useBankAuthorizationReturn(pathname: string) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const [capture, setCapture] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [failedAttempt, setFailedAttempt] = useState<number>();
  const staging = useRef<{
    search: string;
    tabKey: string;
    attempt: number;
    request: Promise<Reference>;
  }>();
  const isCallback = isBankAuthorizationReturnPath(pathname);

  if (isCallback && search && search !== capture) setCapture(search);

  useLayoutEffect(() => {
    if (!isCallback || !(window.location.search || window.location.pathname === legacyCallbackPath))
      return;
    if (window.location.search) {
      const previous = readBankReturnReference();
      if (previous) clearBankReturnReference(previous);
    }
    // The draft lives only in this tab's memory, even while the request is offline.
    navigate(callbackPath, { replace: true });
  }, [isCallback, navigate, pathname, search]);

  useEffect(() => {
    if (!isCallback || !capture) {
      staging.current = undefined;
      return;
    }

    let active = true;
    if (staging.current?.search !== capture || staging.current.attempt !== attempt) {
      const tabKey =
        staging.current?.search === capture ? staging.current.tabKey : crypto.randomUUID();
      const request = apiRequest(
        "POST",
        "/api/bank-connections/handoff",
        { search: capture, tabKey },
        undefined,
        {
          queueWhenOffline: false,
        }
      ).then((reply) => bankAuthorizationReference.parse({ returnId: reply?.returnId, tabKey }));
      staging.current = { search: capture, tabKey, attempt, request };
    }
    void staging.current.request.then(
      (reference) => {
        if (active) {
          try {
            sessionStorage.setItem(storageKey, JSON.stringify(reference));
            setFailedAttempt(undefined);
            setCapture(undefined);
          } catch {
            setFailedAttempt(attempt);
          }
        }
      },
      () => {
        if (active) setFailedAttempt(attempt);
      }
    );
    return () => {
      active = false;
    };
  }, [attempt, capture, isCallback]);

  return {
    isCallback,
    cleaning: isCallback && Boolean(capture || search || pathname === legacyCallbackPath),
    failed: failedAttempt === attempt,
    retry: () => setAttempt((previous) => previous + 1),
  };
}
