import { Landmark, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n";

/** The legacy banking URL opens the CSV statement workflow. */
export default function BankFeeds() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t["shell.nav.banking"]} title={t["banking.feeds.title"]} />
      <Card>
        <EmptyState
          size="md"
          icon={Landmark}
          title={t["banking.recon.importStatement"]}
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
