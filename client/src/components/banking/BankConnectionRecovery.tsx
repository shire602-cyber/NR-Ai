import { useQuery } from "@tanstack/react-query";
import { BANK_STATEMENT_IMPORT_HREF } from "@shared/app-links";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useTranslation } from "@/lib/i18n";

interface BankConnection {
  id: string;
  provider: string;
  status: string;
  bankAccountId: string | null;
  bankName: string | null;
  accountName: string | null;
  accountNumberLast4: string | null;
}

export function BankConnectionRecovery() {
  const { companyId } = useDefaultCompany();
  const { known, can } = useCompanyPermission();
  const { t } = useTranslation(["banking"]);
  const canUpload = !!companyId && known && can("documents.write");
  const { data: connections } = useQuery<BankConnection[]>({
    queryKey: ["/api/companies", companyId, "bank-connections"],
    enabled: canUpload,
  });
  if (!canUpload) return null;
  const failedConnections = (connections ?? []).filter(
    (connection) =>
      connection.status === "error" && connection.bankAccountId && connection.provider !== "manual"
  );
  if (failedConnections.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t["banking.recovery.title"]}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {failedConnections.map((connection) => (
            <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3">
              <span id={`bank-recovery-${connection.id}`} dir="auto" translate="no">
                {connection.accountName || connection.bankName || t["banking.recovery.account"]}
                {connection.accountNumberLast4 && ` •••• ${connection.accountNumberLast4}`}
              </span>
              <Button asChild variant="outline">
                <a
                  href={BANK_STATEMENT_IMPORT_HREF}
                  aria-describedby={`bank-recovery-${connection.id}`}
                >
                  {t["banking.statementUpload.cta"]}
                </a>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
