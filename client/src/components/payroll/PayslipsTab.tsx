import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { downloadPdf } from "@/lib/download-pdf";
import { apiRequest } from "@/lib/queryClient";
import { periodLabel } from "@/lib/purchasing-hr";
import { messages } from "./PayslipsTab.i18n";

interface RunLite {
  id: string;
  period_month: number;
  period_year: number;
  status: string;
}

interface ItemLite {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_name_ar?: string | null;
  net_salary: string;
}

interface Props {
  runs: RunLite[];
  /** True for an employee login: the server already narrows every item list to that person's own record. */
  ownOnly: boolean;
}

/** Payslips of approved and paid runs. An employee sees only their own; accountants see every employee. */
export function PayslipsTab({ runs, ownOnly }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const issued = runs.filter((r) => r.status === "approved" || r.status === "paid");

  const results = useQueries({
    queries: issued.map((run) => ({
      queryKey: [`/api/payroll-runs/${run.id}/items`],
      queryFn: () => apiRequest("GET", `/api/payroll-runs/${run.id}/items`) as Promise<ItemLite[]>,
    })),
  });
  const loading = results.some((r) => r.isLoading);
  const failed = results.some((r) => r.isError);
  const rows = issued.flatMap((run, i) => (results[i]?.data ?? []).map((item) => ({ run, item })));

  const download = async (runId: string, itemId: string) => {
    setBusy(itemId);
    try {
      await downloadPdf(`/api/payroll-runs/${runId}/payslips/${itemId}/pdf`, "payslip.pdf");
    } catch (error: any) {
      toast({ variant: "destructive", title: tr("downloadFailed"), description: error?.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="tab-payslips">
      <p className="text-sm text-muted-foreground">{ownOnly ? tr("intro") : tr("introAll")}</p>
      {loading ? (
        <Skeleton className="h-32 w-full" aria-label={tr("loading")} />
      ) : failed ? (
        <p className="text-sm text-destructive" role="alert">{tr("loadFailed")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-payslips-empty">{tr("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("colPeriod")}</TableHead>
                <TableHead>{tr("colEmployee")}</TableHead>
                <TableHead className="text-end">{tr("colNet")}</TableHead>
                <TableHead>{tr("colStatus")}</TableHead>
                <TableHead className="text-end">{tr("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ run, item }) => (
                <TableRow key={item.id} data-testid={`row-payslip-${item.id}`}>
                  <TableCell dir="ltr" className="text-start whitespace-nowrap">{periodLabel(run.period_year, run.period_month)}</TableCell>
                  <TableCell className="font-medium">{locale === "ar" && item.employee_name_ar ? item.employee_name_ar : item.employee_name}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(parseFloat(item.net_salary) || 0, "AED", locale)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={run.status === "paid" ? "success" : "info"}>{run.status === "paid" ? tr("statusPaid") : tr("statusApproved")}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-end">
                    <Button size="sm" variant="outline" onClick={() => download(run.id, item.id)} disabled={busy === item.id} data-testid={`button-download-payslip-${item.id}`}>
                      {busy === item.id ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Download className="h-4 w-4 me-1" />}
                      {tr("download")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
