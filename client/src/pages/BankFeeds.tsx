import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useLocation } from "wouter";
import { BankConnectionRecovery } from "@/components/banking/BankConnectionRecovery";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";

function readCallback() {
  if (typeof window === "undefined" || window.location.pathname !== "/bank-feeds/callback") {
    return null;
  }
  const query = new URLSearchParams(window.location.search);
  const code = query.get("code") ?? query.get("entity_id");
  const state = query.get("state");
  const provider = query.get("provider") ?? sessionStorage.getItem("bankFeedProvider");
  return code && state && provider ? { provider, code, state } : null;
}

/** Complete previously initiated callbacks at the existing redirect URI. */
function CompleteLegacyCallback({
  callback,
}: {
  callback: NonNullable<ReturnType<typeof readCallback>>;
}) {
  const { companyId } = useDefaultCompany();
  const { t } = useTranslation(["banking"]);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const started = useRef(false);

  useEffect(() => {
    if (!companyId || started.current) return;
    started.current = true;
    void apiRequest("POST", `/api/companies/${companyId}/bank-connections/callback`, callback)
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: ["/api/companies", companyId, "bank-connections"],
        })
      )
      .catch(() => toast({ variant: "destructive", title: t["banking.common.error"] }))
      .finally(() => navigate("/bank-feeds", { replace: true }));
  }, [callback, companyId, navigate, t, toast]);

  return null;
}

export default function BankFeeds() {
  const { t } = useTranslation(["banking", "shell"]);
  const [callback] = useState(readCallback);

  return (
    <div className="space-y-6">
      {callback && <CompleteLegacyCallback callback={callback} />}
      <PageHeader eyebrow={t["shell.nav.banking"]} title={t["banking.statementUpload.title"]} />
      <BankConnectionRecovery />
      <Card>
        <EmptyState
          size="md"
          icon={Upload}
          title={t["banking.statementUpload.reconcileTitle"]}
          description={t["banking.statementUpload.description"]}
          action={{
            label: t["banking.statementUpload.cta"],
            href: "/bank-reconciliation?import=1",
            icon: Upload,
            testId: "button-feeds-import-statement",
          }}
        />
      </Card>
    </div>
  );
}
