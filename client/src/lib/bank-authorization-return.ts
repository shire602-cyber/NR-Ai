import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useSearch } from "wouter/use-browser-location";
import {
  BANK_AUTHORIZATION_RETURN_PATH as callbackPath,
  LEGACY_BANK_AUTHORIZATION_RETURN_PATH as legacyCallbackPath,
  isBankAuthorizationReturnPath,
} from "@shared/bank-authorization-paths";
import { apiRequest } from "@/lib/queryClient";

export function useBankAuthorizationReturn(pathname: string) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const [attempt, setAttempt] = useState(0);
  const [failedAttempt, setFailedAttempt] = useState<number>();
  const staging = useRef<{ search: string; attempt: number; request: Promise<void> }>();
  const isCallback = isBankAuthorizationReturnPath(pathname);
  const cleaning = isCallback && (pathname === legacyCallbackPath || Boolean(search));

  useEffect(() => {
    if (!cleaning) {
      staging.current = undefined;
      return;
    }
    if (!search) {
      navigate(callbackPath, { replace: true });
      return;
    }

    let active = true;
    if (staging.current?.search !== search || staging.current.attempt !== attempt) {
      // Keep the original query only until the server confirms it has recorded the return.
      const request = apiRequest("POST", "/api/bank-connections/handoff", { search }, undefined, {
        queueWhenOffline: false,
      }).then((reply) => {
        if (reply?.staged !== true) throw new Error("Invalid authorization handoff response");
      });
      staging.current = { search, attempt, request };
    }
    void staging.current.request.then(
      () => {
        if (active) {
          setFailedAttempt(undefined);
          navigate(callbackPath, { replace: true });
        }
      },
      () => {
        if (active) setFailedAttempt(attempt);
      }
    );
    return () => {
      active = false;
    };
  }, [attempt, cleaning, navigate, search]);

  return {
    isCallback,
    cleaning,
    failed: failedAttempt === attempt,
    retry: () => setAttempt((previous) => previous + 1),
  };
}
