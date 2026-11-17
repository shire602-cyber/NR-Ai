import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format-date";
import { useTranslation } from "@/lib/i18n";
import { statusLabel } from "@/lib/status-label";

interface Requirement {
  id: string;
  documentType: string;
  description: string | null;
  dueDate: string;
  status: string;
}

const STATUS_TONE: Record<string, StatusTone> = {
  received: "success",
  pending: "neutral",
  missing: "warning",
  overdue: "danger",
};

/** Client profile > Documents: the documents this client owes the firm. */
export function ClientDocumentsTab({ companyId }: { companyId: string }) {
  const { t, locale } = useTranslation();
  const { data, isLoading } = useQuery<Requirement[]>({
    queryKey: ["/api/companies", companyId, "document-requirements"],
  });
  const rows = data ?? [];

  return (
    <Card data-testid="client-tab-documents">
      <CardHeader>
        <CardTitle className="text-base">{t["firmOps.clientDocumentsTitle"]}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState size="sm" title={t["firmOps.clientDocumentsEmpty"]} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t["firmOps.colDocument"]}</TableHead>
                <TableHead>{t["firmOps.colDue"]}</TableHead>
                <TableHead>{t["firm.status"]}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-medium">
                      {t[`firmOps.docType_${row.documentType}`] ?? row.documentType}
                    </div>
                    {row.description ? (
                      <div className="text-xs text-muted-foreground">{row.description}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(row.dueDate, locale)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>
                      {statusLabel(t, row.status)}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
