import { useMutation } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { CardListSkeleton } from "@/components/ui/loading-skeletons";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { T } from "@/components/layout/T";
import {
  StatementOfAccount,
  type StatementSectionView,
} from "@/components/documents/StatementOfAccount";
import { usePortalSupplierQuery } from "@/lib/portal-supplier";
import { downloadPortalFile } from "@/lib/portal-download";
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
  accountId: string;
  asOf: string;
  party: { name: string };
  company: { name: string };
  sections: StatementSectionView[];
}

export default function PortalStatements() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = usePortalSupplierQuery<Statement>(
    "portal-statements",
    "statements"
  );

  const download = useMutation({
    mutationFn: async (statement: Statement) => {
      const ok = await downloadPortalFile(
        `/api/client-portal/statements?format=pdf&asOf=${encodeURIComponent(statement.asOf)}`,
        `statement-${statement.asOf}.pdf`,
        statement.accountId
      );
      if (!ok) throw new Error("Statement download failed");
    },
    onError: () => toast({ title: t["portal.doc.downloadFailed"], variant: "destructive" }),
  });

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
          data && sections.length > 0 ? (
            <Button
              variant="outline"
              disabled={download.isPending}
              onClick={() => download.mutate(data)}
            >
              <FileDown className="h-4 w-4 me-2" aria-hidden />
              <T k="portal.doc.downloadPdf" />
            </Button>
          ) : undefined
        }
      />
      {isLoading ? (
        <CardListSkeleton count={3} />
      ) : error && !data ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : sections.length === 0 ? (
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
