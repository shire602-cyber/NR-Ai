import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { downloadPdf } from "@/lib/download-pdf";
import { periodLabel, type PayrollRegister } from "@/lib/purchasing-hr";
import { messages } from "./PayrollRegisterDialog.i18n";

interface Props {
  runId: string | null;
  onClose: () => void;
}

export function PayrollRegisterDialog({ runId, onClose }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const { data, isLoading, isError } = useQuery<PayrollRegister>({ queryKey: ["/api/payroll-runs", runId, "register"], enabled: !!runId });
  const money = (n: number) => formatCurrency(n, "AED", locale);
  const tieLabel = (account: string, fallback: string) => {
    const key = (`tie${account}`) as "tie2030" | "tie5020" | "tie1080" | "tie2034" | "tie5025" | "tie5028";
    return key in messages.tables.en ? tr(key) : fallback;
  };

  const csv = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      await downloadPdf(`/api/payroll-runs/${runId}/register?format=csv`, "payroll-register.csv");
    } catch (error: any) {
      toast({ variant: "destructive", title: tr("csvFailed"), description: error?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!runId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-6xl max-h-[92vh] overflow-y-auto" data-testid="dialog-payroll-register">
        <DialogHeader>
          <DialogTitle>{tr("title")}</DialogTitle>
          <DialogDescription>{tr("description", { period: data ? periodLabel(data.periodYear, data.periodMonth) : "" })}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-48 w-full" aria-label={tr("loading")} />
        ) : isError || !data ? (
          <p className="text-sm text-destructive" role="alert">{tr("loadFailed")}</p>
        ) : data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("empty")}</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border stack-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("colEmployee")}</TableHead>
                    <TableHead className="text-end">{tr("colBasic")}</TableHead>
                    <TableHead className="text-end">{tr("colAllowances")}</TableHead>
                    <TableHead className="text-end">{tr("colOvertime")}</TableHead>
                    <TableHead className="text-end">{tr("colGross")}</TableHead>
                    <TableHead className="text-end">{tr("colLeave")}</TableHead>
                    <TableHead className="text-end">{tr("colLoans")}</TableHead>
                    <TableHead className="text-end">{tr("colDeductions")}</TableHead>
                    <TableHead className="text-end">{tr("colPension")}</TableHead>
                    <TableHead className="text-end">{tr("colNet")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.employeeId} data-testid={`row-register-${r.employeeId}`}>
                      <TableCell className="font-medium">
                        {r.employeeName}
                        {r.employeeNumber && <div className="text-xs text-muted-foreground">#{r.employeeNumber}</div>}
                        {r.unpaidLeaveDays > 0 && <div className="text-xs text-muted-foreground">{tr("unpaidDays", { days: r.unpaidLeaveDays })}</div>}
                        {r.halfPayLeaveDays > 0 && <div className="text-xs text-muted-foreground">{tr("halfDays", { days: r.halfPayLeaveDays })}</div>}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{money(r.basic)}</TableCell>
                      <TableCell className="text-end tabular-nums">{money(r.housing + r.transport + r.other)}</TableCell>
                      <TableCell className="text-end tabular-nums">{money(r.overtime)}</TableCell>
                      <TableCell className="text-end tabular-nums">{money(r.gross)}</TableCell>
                      <TableCell className="text-end tabular-nums">{money(r.leaveDeduction)}</TableCell>
                      <TableCell className="text-end tabular-nums">{money(r.loanDeduction)}</TableCell>
                      <TableCell className="text-end tabular-nums">{money(r.deductions)}</TableCell>
                      <TableCell className="text-end tabular-nums">{money(r.pensionEmployee)}</TableCell>
                      <TableCell className="text-end tabular-nums font-semibold">{money(r.net)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow data-testid="row-register-totals">
                    <TableCell className="font-semibold">{tr("totals")}</TableCell>
                    <TableCell className="text-end tabular-nums">{money(data.totals.basic)}</TableCell>
                    <TableCell className="text-end tabular-nums">{money(data.totals.housing + data.totals.transport + data.totals.other)}</TableCell>
                    <TableCell className="text-end tabular-nums">{money(data.totals.overtime)}</TableCell>
                    <TableCell className="text-end tabular-nums">{money(data.totals.gross)}</TableCell>
                    <TableCell className="text-end tabular-nums">{money(data.totals.leaveDeduction)}</TableCell>
                    <TableCell className="text-end tabular-nums">{money(data.totals.loanDeduction)}</TableCell>
                    <TableCell className="text-end tabular-nums">{money(data.totals.deductions)}</TableCell>
                    <TableCell className="text-end tabular-nums">{money(data.totals.pensionEmployee)}</TableCell>
                    <TableCell className="text-end tabular-nums font-semibold" data-testid="text-register-net-total">{money(data.totals.net)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>

            <section className="space-y-2">
              <h3 className="font-medium">{tr("tieOutTitle")}</h3>
              {!data.journalTieOut.available ? (
                <p className="text-sm text-muted-foreground">{tr("tieOutPending")}</p>
              ) : (
                <div className="overflow-x-auto rounded-md border stack-table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("colCheck")}</TableHead>
                        <TableHead>{tr("colAccount")}</TableHead>
                        <TableHead className="text-end">{tr("colRegister")}</TableHead>
                        <TableHead className="text-end">{tr("colLedger")}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.journalTieOut.checks.map((c) => (
                        <TableRow key={c.account + c.side} data-testid={`row-tieout-${c.account}`}>
                          <TableCell>{tieLabel(c.account, c.label)}</TableCell>
                          <TableCell dir="ltr" className="text-start">{c.account}</TableCell>
                          <TableCell className="text-end tabular-nums">{money(c.register)}</TableCell>
                          <TableCell className="text-end tabular-nums">{money(c.ledger)}</TableCell>
                          <TableCell>
                            {c.ok ? (
                              <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" />{tr("tieOk")}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-destructive"><XCircle className="h-4 w-4" />{tr("tieOff")}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            {tr("close")}
          </Button>
          <Button onClick={csv} disabled={busy || !data || data.rows.length === 0} data-testid="button-register-csv">
            {busy ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <Download className="h-4 w-4 me-2" />}
            {tr("downloadCsv")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
