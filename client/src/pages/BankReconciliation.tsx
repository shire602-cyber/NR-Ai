import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import type { BankAccount, ProvidersResponse } from "@/lib/banking-api-types";
import { BankTransactionsTab } from "@/components/banking/BankTransactionsTab";
import { StatementImportsPanel } from "@/components/banking/StatementImportsPanel";
import { StatementImportDialog } from "@/components/banking/StatementImportDialog";
import { BankFeedsPanel } from "@/components/banking/BankFeedsPanel";
import { ReconciliationTab } from "@/components/banking/ReconciliationTab";
import { messages as pageMessages } from "./BankReconciliation.i18n";

type TabKey = "transactions" | "import" | "feeds" | "reconciliation";

export default function BankReconciliation() {
  const tr = pageMessages.useT();
  const { t } = useTranslation();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [tab, setTab] = useState<TabKey>("transactions");
  const [importOpen, setImportOpen] = useState(false);
  const [resumeId, setResumeId] = useState<string | null>(null);

  const { data: bankAccounts = [], isLoading: isLoadingAccounts } = useQuery<BankAccount[]>({
    queryKey: ["/api/companies", companyId, "bank-accounts"],
    enabled: !!companyId,
  });
  // [] unless a feed provider is configured on the server: the Feeds tab and every "live" wording depend on it.
  const { data: providers } = useQuery<ProvidersResponse>({ queryKey: ["/api/bank/providers"], enabled: !!companyId });
  const feedsAvailable = (providers?.providers.length ?? 0) > 0;

  const openImport = (importId: string | null = null) => {
    setResumeId(importId);
    setImportOpen(true);
  };

  if (isLoadingCompany || isLoadingAccounts || !companyId) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  const activeTab: TabKey = tab === "feeds" && !feedsAvailable ? "transactions" : tab;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("accounting")}
        title={t.bankReconciliation}
        description={t.bankReconciliationDescription}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/auto-reconcile" data-testid="link-review-suggestions">
                <Sparkles className="h-4 w-4 me-2" />
                {tr("reviewSuggestions")}
              </Link>
            </Button>
            <Button size="sm" onClick={() => openImport()} data-testid="button-open-import">
              <Upload className="h-4 w-4 me-2" />
              {tr("importStatement")}
            </Button>
          </>
        }
      />

      <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabKey)}>
        <div className="overflow-x-auto">
          <TabsList data-testid="bank-tabs">
            <TabsTrigger value="transactions">{tr("tabTransactions")}</TabsTrigger>
            <TabsTrigger value="import">{tr("tabImport")}</TabsTrigger>
            {feedsAvailable && <TabsTrigger value="feeds">{tr("tabFeeds")}</TabsTrigger>}
            <TabsTrigger value="reconciliation">{tr("tabReconciliation")}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="transactions" className="mt-4">
          <BankTransactionsTab companyId={companyId} bankAccounts={bankAccounts} onImport={() => openImport()} />
        </TabsContent>
        <TabsContent value="import" className="mt-4">
          <StatementImportsPanel companyId={companyId} feedsAvailable={feedsAvailable} onImport={() => openImport()} onReview={(id) => openImport(id)} />
        </TabsContent>
        {feedsAvailable && providers && (
          <TabsContent value="feeds" className="mt-4">
            <BankFeedsPanel companyId={companyId} bankAccounts={bankAccounts} providers={providers} />
          </TabsContent>
        )}
        <TabsContent value="reconciliation" className="mt-4">
          <ReconciliationTab companyId={companyId} bankAccounts={bankAccounts} />
        </TabsContent>
      </Tabs>

      <StatementImportDialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) setResumeId(null);
        }}
        companyId={companyId}
        bankAccounts={bankAccounts}
        resumeImportId={resumeId}
      />
    </div>
  );
}
