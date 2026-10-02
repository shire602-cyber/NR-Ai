import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { periodLabel, type EmployeeLoan } from "@/lib/purchasing-hr";
import { messages } from "./LoansTab.i18n";

/** The instalments of one loan with their status (scheduled, in a payroll run, deducted). */
export function LoanScheduleDialog({ loanId, onClose }: { loanId: string | null; onClose: () => void }) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { data, isLoading } = useQuery<EmployeeLoan>({ queryKey: ["/api/employee-loans", loanId], enabled: !!loanId });
  const label = (s?: string) =>
    s === "scheduled" ? tr("instalmentStatusScheduled") : s === "reserved" ? tr("instalmentStatusReserved") : s === "deducted" ? tr("instalmentStatusDeducted") : s === "settled" ? tr("instalmentStatusSettled") : s === "cancelled" ? tr("instalmentStatusCancelled") : (s ?? "");
  return (
    <Dialog open={!!loanId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto" data-testid="dialog-loan-schedule">
        <DialogHeader>
          <DialogTitle>
            {tr("schedule")}
            {data ? ` - ${data.loanNumber} - ${data.employeeName}` : ""}
          </DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <Skeleton className="h-32 w-full" aria-label={tr("loading")} />
        ) : (
          <div className="overflow-x-auto rounded-md border stack-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>{tr("colPeriod")}</TableHead>
                  <TableHead className="text-end">{tr("colAmount")}</TableHead>
                  <TableHead className="text-end">{tr("colDeducted")}</TableHead>
                  <TableHead>{tr("colStatus")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.instalments ?? []).map((i) => (
                  <TableRow key={i.id ?? i.sequence}>
                    <TableCell>{i.sequence}</TableCell>
                    <TableCell dir="ltr" className="text-start">{periodLabel(i.periodYear, i.periodMonth)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(i.amount, "AED", locale)}</TableCell>
                    <TableCell className="text-end tabular-nums">{formatCurrency(i.deductedAmount ?? 0, "AED", locale)}</TableCell>
                    <TableCell>{label(i.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
