import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseCalendarDay } from "@/lib/date-safe";
import { useComplianceText } from "@/lib/i18n-compliance";
import { statusLabelKey, type SettlementView } from "./filing-types";

interface FiledRow {
  id: string;
  status: string;
  isAmendment?: boolean;
  periodStart?: string;
  periodEnd?: string;
  taxPeriodStart?: string;
  taxPeriodEnd?: string;
  filing?: {
    referenceNumber: string;
    filedAt: string;
    evidenceCount?: number;
    settlement?: SettlementView;
  } | null;
}

const day = (value: string) => format(parseCalendarDay(new Date(value)), "dd MMM yyyy");

/** Archive view of the returns recorded as filed (VAT and corporate tax), with a link to each filing. */
export default function FiledReturnsCard({ companyId }: { companyId: string }) {
  const { c } = useComplianceText();
  const { data: vat, isLoading: vatLoading } = useQuery<FiledRow[]>({
    queryKey: ["/api/companies", companyId, "vat-returns"],
    enabled: !!companyId,
  });
  const { data: ct, isLoading: ctLoading } = useQuery<FiledRow[]>({
    queryKey: ["/api/companies", companyId, "corporate-tax", "returns"],
    enabled: !!companyId,
  });

  const rows = [
    ...(vat ?? []).filter((r) => r.filing).map((r) => ({ kind: "vat" as const, r })),
    ...(ct ?? []).filter((r) => r.filing).map((r) => ({ kind: "corporate_tax" as const, r })),
  ].sort((a, b) => b.r.filing!.filedAt.localeCompare(a.r.filing!.filedAt));

  return (
    <Card data-testid="card-filed-returns">
      <CardHeader>
        <CardTitle>{c.filedReturnsTitle}</CardTitle>
        <CardDescription>{c.filedReturnsDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        {vatLoading || ctLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.noFiledReturns}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.colType}</TableHead>
                  <TableHead>{c.colPeriod}</TableHead>
                  <TableHead>{c.colReference}</TableHead>
                  <TableHead>{c.colFiledOn}</TableHead>
                  <TableHead>{c.colEvidence}</TableHead>
                  <TableHead>{c.colSettlement}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ kind, r }) => (
                  <TableRow key={r.id} data-testid={`row-filed-${r.id}`}>
                    <TableCell>
                      {kind === "vat" ? c.typeVat : c.typeCorporateTax}
                      {r.isAmendment && (
                        <Badge variant="outline" className="ms-2">
                          {c.amendmentBadge}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {day((r.periodStart ?? r.taxPeriodStart)!)} – {day((r.periodEnd ?? r.taxPeriodEnd)!)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.filing!.referenceNumber}</TableCell>
                    <TableCell>{day(r.filing!.filedAt)}</TableCell>
                    <TableCell>{r.filing!.evidenceCount ?? "—"}</TableCell>
                    <TableCell>
                      {r.filing!.settlement ? c[statusLabelKey(r.filing!.settlement.status as SettlementView["status"])] : "—"}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button asChild size="sm" variant="outline">
                        <Link href={kind === "vat" ? "/vat-filing" : "/corporate-tax"}>{c.open}</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
