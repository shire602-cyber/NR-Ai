import { Upload } from "lucide-react";
import { BankConnectionRecovery } from "@/components/banking/BankConnectionRecovery";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n";

/** Keep existing banking links useful by pointing customers to statement import. */
export default function BankFeeds() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
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
