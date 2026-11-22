import { useQuery } from "@tanstack/react-query";
import { FileDown, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { T } from "@/components/layout/T";
import {
  StatementOfAccount,
  type StatementSectionView,
} from "@/components/documents/StatementOfAccount";
import { portalQuery } from "@/lib/queryClient";
import { downloadPortalFile } from "@/lib/portal-files";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format-date";
import { formatMessage, useTranslation } from "@/lib/i18n";

/**
 * W4-D (R16-15): the customer's statement of account — opening balance, invoices, credit
 * notes and payments with a running balance, closing balance and ageing — not the supplier's
 * profit and loss or balance sheet. WP-F: formatted dates, ageing as one row, amounts carry
 * their currency (no separate currency heading for a single-currency statement).
 */
interface Statement {
  asOf: string;
  party: { name: string };
  company: { name: string };
  sections: StatementSectionView[];
}

export default function PortalStatements() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Statement>({
    ...portalQuery("/api/client-portal/statements"),
  });

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const sections = data?.sections ?? [];
  return (
    <div className="mx-auto max-w-[960px] space-y-6">
      <PageHeader
        title={t["portal.doc.statementOfAccount"]}
        description={
          data?.asOf
            ? formatMessage(t["portal.doc.asOfDate"], { date: formatDate(data.asOf, locale) })
            : t["portal.doc.statementsHint"]
        }
        primaryAction={
          sections.length > 0 ? (
            <Button
              variant="outline"
              onClick={() => {
                void downloadPortalFile(
                  "/api/client-portal/statements?format=pdf",
                  data?.asOf ? `statement-${data.asOf}.pdf` : "statement.pdf"
                ).catch(() =>
                  toast({ title: t["portal.doc.downloadFailed"], variant: "destructive" })
                );
              }}
            >
              <FileDown className="h-4 w-4 me-2" aria-hidden />
              <T k="portal.doc.downloadPdf" />
            </Button>
          ) : undefined
        }
      />
      {sections.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              headingLevel="h2"
              title={t["portal.doc.noStatementTitle"]}
              description={t["portal.doc.noStatementBody"]}
            />
          </CardContent>
        </Card>
      ) : (
        sections.map((s) => (
          <Card key={s.currency}>
            {sections.length > 1 && (
              <CardHeader className="pb-2">
                <CardTitle className="text-h3">{s.currency}</CardTitle>
              </CardHeader>
            )}
            <CardContent className={sections.length > 1 ? undefined : "pt-5"}>
              <StatementOfAccount section={s} />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
