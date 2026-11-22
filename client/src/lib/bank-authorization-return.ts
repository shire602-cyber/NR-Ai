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
type Capture = { reference: Reference; search: string };
declare global {
  interface Window {
    __statementReturn?: Capture;
  }
}

const storageKey = "muhasib:statement-authorization";

function readStoredReturn() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    const value = bankAuthorizationReference.safeParse(saved?.reference ?? saved);
    if (value.success) return { reference: value.data, startedAt: saved.startedAt as unknown };
  } catch {
    return undefined;
  }
}

export function readBankReturnReference(): Reference | undefined {
  return readStoredReturn()?.reference;
}

export function isBankReturnStaging(reference: Reference): boolean {
  const saved = readStoredReturn();
  return (
    saved?.reference.returnId === reference.returnId &&
    typeof saved.startedAt === "number" &&
    Date.now() - saved.startedAt < 10_000
  );
}

function saveBankReturn(reference: Reference, startedAt?: number): void {
  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify(startedAt === undefined ? reference : { reference, startedAt })
    );
  } catch {
    // Until reload the current return can still be attempted from memory.
  }
}

export function clearBankReturnReference(reference: Reference): void {
  if (readBankReturnReference()?.returnId === reference.returnId)
    sessionStorage.removeItem(storageKey);
}

export function useBankAuthorizationReturn(pathname: string) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const [capture, setCapture] = useState<Capture | undefined>(() => window.__statementReturn);
  const [attempt, setAttempt] = useState(0);
  const [failedAttempt, setFailedAttempt] = useState<number>();
  const staging = useRef<{ capture: Capture; attempt: number; request: Promise<unknown> }>();
  const isCallback = isBankAuthorizationReturnPath(pathname);

  if (isCallback && search && window.location.search !== capture?.search) {
    setCapture({
      reference: { returnId: crypto.randomUUID(), tabKey: crypto.randomUUID() },
      search: window.location.search,
    });
  }

  useLayoutEffect(() => {
    delete window.__statementReturn;
    if (!isCallback || !(window.location.search || window.location.pathname === legacyCallbackPath))
      return;
    if (window.location.search && capture) {
      saveBankReturn(capture.reference, Date.now());
    }
    // The draft lives only in this tab's memory, even while the request is offline.
    navigate(callbackPath, { replace: true });
  }, [capture, isCallback, navigate, pathname, search]);

  useEffect(() => {
    if (!isCallback || !capture) {
      staging.current = undefined;
      return;
    }

    let active = true;
    if (staging.current?.capture !== capture || staging.current.attempt !== attempt) {
      saveBankReturn(capture.reference, Date.now());
      const request = apiRequest(
        "POST",
        "/api/bank-connections/handoff",
        { ...capture.reference, search: capture.search },
        undefined,
        {
          queueWhenOffline: false,
          keepalive: true,
        }
      );
      staging.current = { capture, attempt, request };
    }
    void staging.current.request.then(
      () => {
        if (active) {
          saveBankReturn(capture.reference);
          setFailedAttempt(undefined);
          setCapture(undefined);
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
