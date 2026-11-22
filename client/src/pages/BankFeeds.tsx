import { useEffect, useRef, useState } from "react";
import { Landmark, Upload } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n";
import { ApiRequestNotSentError, apiRequest } from "@/lib/queryClient";
import { BANK_AUTHORIZATION_RETURN_PATH as callbackPath } from "@shared/bank-authorization-paths";

type ReturnStatus = "pending" | "retry" | "cancelled" | "failed" | null;

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
  const [returned, setReturned] = useState<ReturnStatus>(resumeAuthorization ? "pending" : null);
  const status = retryCapture ? "retry" : returned;
  const submitted = useRef(false);

  useEffect(() => {
    if (path !== callbackPath || returned !== "pending" || submitted.current) return;
    submitted.current = true;
    void apiRequest("POST", "/api/bank-connections/callback/resume", { resume: true }, undefined, {
      queueWhenOffline: false,
    }).then(
      (result: { connections?: unknown[]; outcome?: "cancelled" | "failed" } | null) => {
        if (result === null) setReturned(null);
        else if (result.outcome) setReturned(result.outcome);
        else if (Array.isArray(result.connections)) {
          if (window.location.pathname === callbackPath) navigate("/bank-feeds", { replace: true });
        } else {
          setReturned("failed");
        }
      },
      (error: unknown) => {
        if (error instanceof ApiRequestNotSentError) {
          submitted.current = false;
          setReturned("retry");
        } else {
          setReturned("failed");
        }
      }
    );
  }, [path, returned, navigate]);

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
