import { useEffect, useRef } from "react";
import { Landmark, Upload } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";

/** Keep existing banking links and callback bookmarks pointed at statement import. */
export default function BankFeeds() {
  const { t } = useTranslation();
  const [path, navigate] = useLocation();
  const search = useSearch();
  const { companyId, isLoading } = useDefaultCompany();
  const { toast } = useToast();
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (path !== "/bank-feeds/callback" || isLoading || attempted.current === search) return;
    attempted.current = search;
    const params = new URLSearchParams(search);
    const code = params.get("code") || params.get("entity_id");
    const state = params.get("state");

    async function finishReturn() {
      try {
        if (companyId && code && state) {
          await apiRequest(
            "POST",
            `/api/companies/${companyId}/bank-connections/callback`,
            { code, state },
            undefined,
            { queueWhenOffline: false }
          );
        }
      } catch {
        toast({ title: t["banking.feeds.returnError"], variant: "destructive" });
      } finally {
        // Avoid retaining the authorization parameters in browser history.
        if (window.location.pathname === path) navigate("/bank-feeds", { replace: true });
      }
    }
    void finishReturn();
  }, [path, search, companyId, isLoading, navigate, t, toast]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t["shell.nav.banking"]} title={t["banking.statementUpload.title"]} />
      {path === "/bank-feeds/callback" && search && (
        <p role="status" className="text-small text-muted-foreground">
          {t["banking.feeds.returnPending"]}
        </p>
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
