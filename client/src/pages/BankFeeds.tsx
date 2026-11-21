import { useEffect, useRef, useState } from "react";
import { Landmark, Upload } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n";
import { ApiRequestNotSentError, apiRequest } from "@/lib/queryClient";
import type { AuthorizationReturn } from "@/lib/bank-authorization-return";
import { BANK_AUTHORIZATION_RETURN_PATH as callbackPath } from "@shared/bank-authorization-paths";

type ReturnStatus =
  | AuthorizationReturn
  | { kind: "retry"; code: string; state: string }
  | { kind: "submitting" }
  | null;

interface BankFeedsProps {
  initialReturn?: AuthorizationReturn | null;
  onReturnClaimed?: () => void;
}

/** Keep existing banking links and callback bookmarks pointed at statement import. */
export default function BankFeeds({ initialReturn = null, onReturnClaimed }: BankFeedsProps) {
  const { t } = useTranslation();
  const [path, navigate] = useLocation();
  const [returned, setReturned] = useState<ReturnStatus>(initialReturn);
  const submitted = useRef(false);

  useEffect(() => {
    if (initialReturn) onReturnClaimed?.();
  }, [initialReturn, onReturnClaimed]);

  useEffect(() => {
    if (path !== callbackPath || returned?.kind !== "pending" || submitted.current) return;
    submitted.current = true;
    const { code, state } = returned;
    setReturned({ kind: "submitting" });
    void apiRequest("POST", "/api/bank-connections/callback", { code, state }, undefined, {
      queueWhenOffline: false,
    }).then(
      () => {
        if (window.location.pathname === callbackPath) navigate("/bank-feeds", { replace: true });
      },
      (error: unknown) => {
        if (error instanceof ApiRequestNotSentError) {
          submitted.current = false;
          setReturned({ kind: "retry", code, state });
        } else {
          setReturned({ kind: "failed" });
        }
      }
    );
  }, [path, returned, navigate]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t["shell.nav.banking"]} title={t["banking.statementUpload.title"]} />
      {path === callbackPath && returned && (
        <div className="flex flex-wrap items-center gap-3 text-small text-muted-foreground">
          <p role="status">
            {returned.kind === "cancelled"
              ? t["banking.feeds.returnCancelled"]
              : returned.kind === "failed"
                ? t["banking.feeds.returnError"]
                : returned.kind === "retry"
                  ? t["banking.feeds.returnOffline"]
                  : t["banking.feeds.returnPending"]}
          </p>
          {returned.kind === "retry" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReturned({ ...returned, kind: "pending" })}
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
