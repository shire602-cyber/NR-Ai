import { Landmark, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n";
import { BANK_RECONCILIATION_COPY } from "@shared/bank-reconciliation-copy";

/** Keep old banking links usable through statement import. */
export default function BankFeeds() {
  const { t, locale } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t["shell.nav.banking"]} title={t.bankReconciliation} />
      <Card>
        <EmptyState
          size="md"
          icon={Landmark}
          title={t["banking.importStatementAction"]}
          description={BANK_RECONCILIATION_COPY[locale]}
          action={{
            label: t["banking.recon.importStatement"],
            href: "/bank-reconciliation?import=1",
            icon: Upload,
            testId: "button-feeds-import-statement",
          }}
        />
      </Card>
    </div>
  );
}
