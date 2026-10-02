import { useState } from "react";
import { todayYmd as today } from "@/lib/calendar-date";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TabEmployee } from "@/components/payroll/payroll-common";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LeaveBalance, LeaveType } from "@/lib/purchasing-hr";
import { messages } from "./LeaveTab.i18n";

interface Props {
  companyId: string;
  employees: TabEmployee[];
  types: LeaveType[];
  canWrite: boolean;
}

const ALL = "all";
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

export function LeaveBalancesPanel({ companyId, employees, types, canWrite }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [asOf, setAsOf] = useState(today());
  const [employeeId, setEmployeeId] = useState(ALL);
  const [adjusting, setAdjusting] = useState<LeaveBalance | null>(null);
  const [opening, setOpening] = useState("");
  const [adjustment, setAdjustment] = useState("0");
  const [note, setNote] = useState("");

  const key = ["/api/companies", companyId, "leave-balances", asOf, employeeId];
  const { data: rows = [], isLoading } = useQuery<LeaveBalance[]>({
    queryKey: key,
    enabled: !!companyId && !!asOf,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/leave-balances?asOf=${asOf}${employeeId !== ALL ? `&employeeId=${employeeId}` : ""}`),
  });

  const typeName = (r: LeaveBalance) => {
    const t = types.find((x) => x.id === r.leaveTypeId);
    return t ? (locale === "ar" ? t.nameAr : t.nameEn) : r.code;
  };

  const save = useMutation({
    mutationFn: (r: LeaveBalance) =>
      apiRequest("PUT", `/api/companies/${companyId}/leave-balances`, {
        employeeId: r.employeeId,
        leaveTypeId: r.leaveTypeId,
        year: r.year,
        openingDays: opening.trim() === "" ? null : Number(opening),
        adjustmentDays: Number(adjustment) || 0,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast({ title: tr("adjustSaved") });
      setAdjusting(null);
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "leave-balances"] });
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("adjustFailed"), description: error?.message }),
  });

  const openAdjust = (r: LeaveBalance) => {
    setOpening("");
    setAdjustment(String(r.adjustment));
    setNote("");
    setAdjusting(r);
  };

  return (
    <div className="space-y-4" data-testid="panel-leave-balances">
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <Label htmlFor="balances-asof">{tr("asOf")}</Label>
          <Input id="balances-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} data-testid="input-balances-asof" />
        </div>
        <div className="space-y-1 w-[240px]">
          <Label>{tr("employee")}</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger data-testid="select-balances-employee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{tr("statusAll")}</SelectItem>
              {employees.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" aria-label={tr("loading")} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("balancesEmpty")}</p>
      ) : (
        <>
        <p className="text-xs text-muted-foreground" data-testid="text-carry-note">{tr("carryNote")}</p>
        <div className="overflow-x-auto rounded-md border stack-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("colEmployee")}</TableHead>
                <TableHead>{tr("colType")}</TableHead>
                <TableHead>{tr("colYear")}</TableHead>
                <TableHead className="text-end">{tr("colOpening")}</TableHead>
                <TableHead className="text-end">{tr("colAccrued")}</TableHead>
                <TableHead className="text-end">{tr("colAdjustment")}</TableHead>
                <TableHead className="text-end">{tr("colTaken")}</TableHead>
                <TableHead className="text-end">{tr("colPending")}</TableHead>
                <TableHead className="text-end">{tr("colBalance")}</TableHead>
                <TableHead className="text-end">{tr("colAvailable")}</TableHead>
                {canWrite && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.employeeId}-${r.leaveTypeId}`} data-testid={`row-balance-${r.employeeId}-${r.code}`}>
                  <TableCell className="font-medium">{r.employeeName}</TableCell>
                  <TableCell>{typeName(r)}</TableCell>
                  <TableCell>{r.year}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmt(r.opening)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmt(r.accrued)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmt(r.adjustment)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmt(r.taken)}</TableCell>
                  <TableCell className="text-end tabular-nums">{fmt(r.pending)}</TableCell>
                  <TableCell className="text-end tabular-nums font-medium" data-testid="text-balance">{fmt(r.balance)}</TableCell>
                  <TableCell className="text-end tabular-nums font-semibold" data-testid="text-available">{fmt(r.available)}</TableCell>
                  {canWrite && (
                    <TableCell className="text-end">
                      <Button size="sm" variant="ghost" onClick={() => openAdjust(r)}>
                        {tr("adjust")}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}

      <Dialog open={!!adjusting} onOpenChange={(o) => !o && setAdjusting(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{tr("adjustTitle")}</DialogTitle>
            <DialogDescription>{tr("adjustBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="adjust-opening">{tr("openingDays")}</Label>
              <Input id="adjust-opening" type="number" step="0.5" dir="ltr" value={opening} onChange={(e) => setOpening(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adjust-days">{tr("adjustmentDays")}</Label>
              <Input id="adjust-days" type="number" step="0.5" dir="ltr" value={adjustment} onChange={(e) => setAdjustment(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adjust-note">{tr("note")}</Label>
              <Input id="adjust-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjusting(null)}>
              {tr("cancel")}
            </Button>
            <Button onClick={() => adjusting && save.mutate(adjusting)} disabled={save.isPending}>
              {save.isPending ? tr("saving") : tr("adjust")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
