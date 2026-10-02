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
import { periodLabel, type PayrollRegister, type RegisterRow } from "@/lib/purchasing-hr";
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
  // Fixed columns first, then the employer-side and provision columns the register carries. A column that is absent
  // from the response (an older server) is left out rather than shown as zero.
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  const extra = (r: RegisterRow, key: string) => num((r as unknown as Record<string, unknown>)[key]);
  const first = data?.rows[0] as unknown as Record<string, unknown> | undefined;
  const has = (key: string) => !!first && key in first;
  const columns: Array<{ key: string; label: string; strong?: boolean; value: (r: RegisterRow) => number }> = [
    { key: "basic", label: tr("colBasic"), value: (r) => num(r.basic) },
    { key: "allowances", label: tr("colAllowances"), value: (r) => num(r.housing) + num(r.transport) + num(r.other) },
    { key: "overtime", label: tr("colOvertime"), value: (r) => num(r.overtime) },
    { key: "gross", label: tr("colGross"), value: (r) => num(r.gross) },
    { key: "leaveDeduction", label: tr("colLeave"), value: (r) => num(r.leaveDeduction) },
    { key: "loanDeduction", label: tr("colLoans"), value: (r) => num(r.loanDeduction) },
    { key: "deductions", label: tr("colDeductions"), value: (r) => num(r.deductions) },
    { key: "pensionEmployee", label: tr("colPension"), value: (r) => num(r.pensionEmployee) },
    ...(has("liabilityDeductions") ? [{ key: "liabilityDeductions", label: tr("colLiabilityDeductions"), value: (r: RegisterRow) => extra(r, "liabilityDeductions") }] : []),
    { key: "net", label: tr("colNet"), strong: true, value: (r) => num(r.net) },
    { key: "pensionEmployer", label: tr("colPensionEmployer"), value: (r) => num(r.pensionEmployer) },
    { key: "gratuityAccrual", label: tr("colGratuityAccrual"), value: (r) => num(r.gratuityAccrual) },
    ...(has("leaveAccrual") ? [{ key: "leaveAccrual", label: tr("colLeaveAccrual"), value: (r: RegisterRow) => extra(r, "leaveAccrual") }] : []),
    ...(has("leaveProvision") ? [{ key: "leaveProvision", label: tr("colLeaveProvision"), value: (r: RegisterRow) => extra(r, "leaveProvision") }] : []),
    ...(has("employerCost") ? [{ key: "employerCost", label: tr("colEmployerCost"), strong: true, value: (r: RegisterRow) => extra(r, "employerCost") }] : []),
  ];
  const tieLabel = (account: string, fallback: string) => {
    const key = (`tie${account}`) as "tie2030" | "tie5020" | "tie1080" | "tie2034" | "tie5025" | "tie5028" | "tie2037" | "tie5029" | "tie2036";
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
            {data.isDraft && (
              <div className="rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm font-medium" role="status" data-testid="register-draft-banner">
                {tr("draftBanner")}
              </div>
            )}
            {(data.priorServiceMissing?.length ?? 0) > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning-subtle p-3 text-sm" role="status" data-testid="register-prior-service">
                {tr("priorServiceMissing", { names: data.priorServiceMissing!.map((m) => m.name).join(", ") })}
              </div>
            )}
            <div className="overflow-x-auto rounded-md border stack-table" data-testid="register-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("colEmployee")}</TableHead>
                    {columns.map((c) => (
                      <TableHead key={c.key} className="text-end">{c.label}</TableHead>
                    ))}
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
                      {columns.map((c) => (
                        <TableCell key={c.key} className={`text-end tabular-nums ${c.strong ? "font-semibold" : ""}`}>{money(c.value(r))}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow data-testid="row-register-totals">
                    <TableCell className="font-semibold">{tr("totals")}</TableCell>
                    {columns.map((c) => (
                      <TableCell key={c.key} className={`text-end tabular-nums ${c.strong ? "font-semibold" : ""}`} data-testid={c.key === "net" ? "text-register-net-total" : undefined}>
                        {money(c.value(data.totals as unknown as RegisterRow))}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              </Table>
            </div>

            {data.reconciliation?.available && (
              <section className="space-y-2" data-testid="register-reconciliation">
                <h3 className="font-medium">{tr("reconciliationTitle")}</h3>
                <div className="overflow-x-auto rounded-md border stack-table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tr("colCheck")}</TableHead>
                        <TableHead>{tr("colAccount")}</TableHead>
                        <TableHead className="text-end">{tr("colRegister")}</TableHead>
                        <TableHead className="text-end">{tr("colLedger")}</TableHead>
                        <TableHead className="text-end">{tr("colDifference")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.reconciliation.rows.map((r) => (
                        <TableRow key={r.code} data-testid={`row-reconciliation-${r.code}`}>
                          <TableCell>{tieLabel(r.code, r.label)}</TableCell>
                          <TableCell dir="ltr" className="text-start">{r.code}</TableCell>
                          <TableCell className="text-end tabular-nums">{money(r.register)}</TableCell>
                          <TableCell className="text-end tabular-nums">{money(r.ledger)}</TableCell>
                          <TableCell className={`text-end tabular-nums ${Math.abs(r.difference) < 0.005 ? "" : "text-destructive font-semibold"}`}>{money(r.difference)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={4} className="font-semibold">{data.reconciliation.ok ? tr("recOk") : tr("recOff")}</TableCell>
                        <TableCell className="text-end tabular-nums font-semibold" data-testid="text-reconciliation-difference">{money(data.reconciliation.difference)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              </section>
            )}

            {!data.reconciliation?.available && (
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
            )}
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
