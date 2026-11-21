import { Upload } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useDocumentTitle } from "@/lib/customer-link";
import { useTranslation } from "@/lib/i18n";

/** The historical banking and callback paths lead to the supported statement workflow. */
export default function BankFeeds() {
  const { t } = useTranslation();
  const title = t["banking.feeds.statementImportTitle"];
  useDocumentTitle(title);

  return (
    <PageHeader
      eyebrow={t["shell.nav.banking"]}
      title={title}
      description={t["banking.feeds.manualImportBody"]}
      primaryAction={
        <Button asChild>
          <Link href="/bank-reconciliation?import=1" data-testid="button-feeds-import-statement">
            <Upload aria-hidden />
            {t["banking.feeds.importStatement"]}
          </Link>
        </Button>
      }
    />
  );
}
