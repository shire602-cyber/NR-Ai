import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import { formatCalendarDate } from "@/lib/calendar-date";
import type { StatementImportRecord } from "@/lib/banking-api-types";
import { messages } from "./StatementImportsPanel.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankKey, sourceText } from "./banking-common";
import { PdfAiFallbackSetting } from "./PdfAiFallbackSetting";

interface Props {
  companyId: string;
  /** True when a feed provider is configured; the note about file-only statements shows otherwise. */
  feedsAvailable: boolean;
  onImport: () => void;
  onReview: (importId: string) => void;
}

export function StatementImportsPanel({ companyId, feedsAvailable, onImport, onReview }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { data, isLoading } = useQuery<StatementImportRecord[]>({ queryKey: bankKey(companyId, "imports"), enabled: !!companyId });

  const statusTone = (s: StatementImportRecord["status"]) => (s === "committed" ? "success" : s === "staged" ? "warning" : "neutral");
  const statusText = (s: StatementImportRecord["status"]) => (s === "committed" ? tr("statusCommitted") : s === "staged" ? tr("statusStaged") : tr("statusDiscarded"));

  return (
    <div className="space-y-4" data-testid="imports-panel">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <CardTitle>{tr("title")}</CardTitle>
              <CardDescription>{tr("description")}</CardDescription>
              {!feedsAvailable && <p className="text-xs text-muted-foreground">{tr("noFeedsNote")}</p>}
            </div>
            <Button onClick={onImport} data-testid="button-import-transactions">
              <Upload className="h-4 w-4 me-2" />
              {tr("importBtn")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <PdfAiFallbackSetting companyId={companyId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tr("historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("historyEmpty")}</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("colDate")}</TableHead>
                    <TableHead>{tr("colFile")}</TableHead>
                    <TableHead>{tr("colSource")}</TableHead>
                    <TableHead>{tr("colPeriod")}</TableHead>
                    <TableHead>{tr("colRows")}</TableHead>
                    <TableHead>{tr("colStatus")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row) => (
                    <TableRow key={row.id} data-testid={`import-${row.id}`}>
                      <TableCell className="text-sm whitespace-nowrap">{row.createdAt ? formatCalendarDate(row.createdAt, locale, "short") : ""}</TableCell>
                      <TableCell className="text-sm max-w-[14rem] truncate" dir="auto" title={row.filename ?? undefined}>
                        {row.filename || tr("noFile")}
                      </TableCell>
                      <TableCell className="text-sm">{sourceText(trc, row.source)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {row.statementFrom && row.statementTo ? `${formatCalendarDate(row.statementFrom, locale, "short")} - ${formatCalendarDate(row.statementTo, locale, "short")}` : ""}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{row.status === "committed" ? tr("rowsValue", { imported: row.importedCount ?? 0, duplicates: row.duplicateCount ?? 0 }) : row.rowCount ?? ""}</TableCell>
                      <TableCell>
                        <StatusBadge tone={statusTone(row.status)}>{statusText(row.status)}</StatusBadge>
                      </TableCell>
                      <TableCell className="text-end">
                        {row.status === "staged" && (
                          <Button size="sm" variant="outline" onClick={() => onReview(row.id)} data-testid={`button-review-import-${row.id}`}>
                            {tr("review")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
