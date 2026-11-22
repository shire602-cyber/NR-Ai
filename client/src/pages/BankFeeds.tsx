import { useEffect, useRef, useState } from "react";
import { Landmark, Upload } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n";
import { ApiError, ApiRequestNotSentError, apiRequest } from "@/lib/queryClient";
import {
  clearBankReturnReference,
  isBankReturnStaging,
  readBankReturnReference,
} from "@/lib/bank-authorization-return";
import { BANK_AUTHORIZATION_RETURN_PATH as callbackPath } from "@shared/bank-authorization-paths";

type ReturnStatus = "pending" | "retry" | "cancelled" | "failed" | "expired" | null;

/** Keep existing banking links and callback bookmarks pointed at statement import. */
export default function BankFeeds({
  resumeAuthorization = false,
  retryCapture,
}: {
  resumeAuthorization?: boolean;
  retryCapture?: () => void;
}) {
  const { t } = useTranslation();
  const [path, navigate] = useLocation();
  const [reference] = useState(() => (resumeAuthorization ? readBankReturnReference() : undefined));
  const [returned, setReturned] = useState<ReturnStatus>(reference ? "pending" : null);
  const status = retryCapture ? "retry" : returned;
  const submitted = useRef(false);
  const [poll, setPoll] = useState(0);

  useEffect(() => {
    if (path !== callbackPath || !reference || returned !== "pending" || submitted.current) return;
    submitted.current = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    void apiRequest("POST", "/api/bank-connections/callback/resume", reference, undefined, {
      queueWhenOffline: false,
    }).then(
      (result: { connections?: unknown[]; outcome?: "cancelled" | "failed" | "expired" }) => {
        if (result?.outcome === "expired" && isBankReturnStaging(reference)) {
          retryTimer = setTimeout(() => {
            submitted.current = false;
            setPoll((previous) => previous + 1);
          }, 500);
          return;
        }
        if (result?.outcome) {
          clearBankReturnReference(reference);
          setReturned(result.outcome);
        } else if (Array.isArray(result?.connections)) {
          const isCurrent = readBankReturnReference()?.returnId === reference.returnId;
          clearBankReturnReference(reference);
          void apiRequest(
            "POST",
            "/api/bank-connections/callback/resume",
            { ...reference, acknowledge: true },
            undefined,
            {
              queueWhenOffline: false,
              keepalive: true,
            }
          ).catch(() => undefined);
          if (isCurrent && window.location.pathname === callbackPath) {
            navigate("/bank-feeds", { replace: true });
          }
        } else {
          setReturned("failed");
        }
      },
      (error: unknown) => {
        const code = error instanceof ApiError ? error.body?.code : undefined;
        if (
          error instanceof ApiRequestNotSentError ||
          error instanceof TypeError ||
          (error instanceof ApiError && error.status >= 500)
        ) {
          submitted.current = false;
          setReturned("retry");
        } else if (code === "AUTHORIZATION_RESTART") {
          clearBankReturnReference(reference);
          setReturned("expired");
        } else {
          setReturned("failed");
        }
      }
    );
    return () => clearTimeout(retryTimer);
  }, [path, poll, reference, returned, navigate]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t["shell.nav.banking"]} title={t["banking.statementUpload.title"]} />
      {(path === callbackPath || retryCapture) && status && (
        <div className="flex flex-wrap items-center gap-3 text-small text-muted-foreground">
          <p role="status">
            {status === "cancelled"
              ? t["banking.feeds.returnCancelled"]
              : status === "failed"
                ? t["banking.feeds.returnError"]
                : status === "expired"
                  ? t["banking.feeds.returnExpired"]
                  : status === "retry"
                    ? t["banking.feeds.returnOffline"]
                    : t["banking.feeds.returnPending"]}
          </p>
          {status === "retry" && (
            <Button
              variant="outline"
              size="sm"
              onClick={retryCapture ?? (() => setReturned("pending"))}
            >
              {t["banking.feeds.returnRetry"]}
            </Button>
          )}
        </div>
      )}
      <Card>
        <EmptyState
          size="md"
          icon={Landmark}
          title={t["banking.feeds.importStatement"]}
          description={t["banking.feeds.unavailableBody"]}
          action={{
            label: t["banking.feeds.importStatement"],
            href: "/bank-reconciliation?import=1",
            icon: Upload,
            testId: "button-feeds-import-statement",
          }}
        />
      </Card>
    </div>
  );
}
