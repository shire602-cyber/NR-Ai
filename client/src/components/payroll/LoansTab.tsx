import { useState } from "react";
import { todayYmd as today } from "@/lib/calendar-date";
import { useMutation, useQuery } from "@tanstack/react-query";
import { HandCoins, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoanScheduleDialog } from "@/components/payroll/LoanScheduleDialog";
import { PaymentAccountSelect } from "@/components/payroll/PaymentAccountSelect";
import type { TabEmployee } from "@/components/payroll/payroll-common";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { periodLabel, type EmployeeLoan, type LoanPreview } from "@/lib/purchasing-hr";
import { messages } from "./LoansTab.i18n";

interface Props {
  companyId: string;
  employees: TabEmployee[];
  canWrite: boolean;
}

type StatusFilter = "all" | EmployeeLoan["status"];
const TONES: Record<EmployeeLoan["status"], StatusTone> = { active: "info", settled: "success", cancelled: "neutral" };

export function LoansTab({ companyId, employees, canWrite }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const now = new Date();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dialog, setDialog] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<"loan" | "advance">("loan");
  const [principal, setPrincipal] = useState("");
  const [count, setCount] = useState("6");
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<string | null>(null);
  const [repaying, setRepaying] = useState<EmployeeLoan | null>(null);
  const [repayAccount, setRepayAccount] = useState("");
  const [repayDate, setRepayDate] = useState(today());

  const listKey = ["/api/companies", companyId, "employee-loans"];
  const { data: loans = [], isLoading, isError } = useQuery<EmployeeLoan[]>({
    queryKey: [...listKey, status],
    enabled: !!companyId,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/employee-loans?status=${status}&limit=200`),
  });

  const previewReady = !!employeeId && Number(principal) > 0 && Number(count) >= 1 && Number(count) <= 120 && Number(year) >= 2000;
  const previewBody = { employeeId, principal: Number(principal), instalmentCount: Number(count), firstPeriodYear: Number(year), firstPeriodMonth: Number(month) };
  const preview = useQuery<LoanPreview>({
    queryKey: [...listKey, "preview", employeeId, principal, count, month, year],
    enabled: dialog && previewReady,
    retry: false,
    queryFn: () => apiRequest("POST", `/api/companies/${companyId}/employee-loans/preview`, previewBody),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: listKey });
  const money = (n: number) => formatCurrency(n, "AED", locale);

  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/employee-loans`, { ...previewBody, kind, disbursementDate: date, paymentAccountId: accountId, notes: notes.trim() || null }),
    onSuccess: (loan: EmployeeLoan) => {
      toast({ title: tr("created", { number: loan.loanNumber }) });
      setDialog(false);
      refresh();
    },
    onError: (error: unknown) => {
      // The error body carries maxInstalment at the top level, which ApiError does not keep; the preview already holds the same number.
      const cap = error instanceof ApiError && error.code === "DEDUCTION_CAP";
      const max = preview.data?.maxInstalment ?? 0;
      toast({ variant: "destructive", title: tr("createFailed"), description: cap && max > 0 ? tr("capFailed", { max: money(max) }) : (error as Error)?.message });
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/employee-loans/${id}/cancel`, {}),
    onSuccess: () => {
      toast({ title: tr("cancelled") });
      refresh();
    },
    onError: (error: unknown) => {
      const blocked = error instanceof ApiError && error.code === "LOAN_HAS_DEDUCTIONS";
      toast({ variant: "destructive", title: tr("cancelFailed"), description: blocked ? tr("hasDeductions") : (error as Error)?.message });
    },
  });

  const repay = useMutation({
    mutationFn: (loan: EmployeeLoan) => apiRequest("POST", `/api/employee-loans/${loan.id}/repay`, { paymentAccountId: repayAccount, date: repayDate }),
    onSuccess: () => {
      toast({ title: tr("repaid") });
      setRepaying(null);
      refresh();
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("repayFailed"), description: error?.message }),
  });

  const submit = () => {
    if (!employeeId) return setProblem(tr("needEmployee"));
    if (!(Number(principal) > 0)) return setProblem(tr("needAmount"));
    if (!accountId) return setProblem(tr("needAccount"));
    setProblem(null);
    create.mutate();
  };

  const statusLabel = (s: EmployeeLoan["status"]) => (s === "active" ? tr("statusActive") : s === "settled" ? tr("statusSettled") : tr("statusCancelled"));
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const p = preview.data;

  return (
    <div className="space-y-4" data-testid="tab-loans">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1 w-[200px]">
          <Label>{tr("filterStatus")}</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger data-testid="select-loan-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tr("statusAll")}</SelectItem>
              <SelectItem value="active">{tr("statusActive")}</SelectItem>
              <SelectItem value="settled">{tr("statusSettled")}</SelectItem>
              <SelectItem value="cancelled">{tr("statusCancelled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canWrite ? (
          <Button onClick={() => { setProblem(null); setDialog(true); }} data-testid="button-new-loan">
            <Plus className="h-4 w-4 me-2" />
            {tr("newLoan")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{tr("readOnly")}</p>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{tr("loansHint")}</p>

      {isLoading ? (
        <Skeleton className="h-32 w-full" aria-label={tr("loading")} />
      ) : isError ? (
        <p className="text-sm text-destructive" role="alert">{tr("loadFailed")}</p>
      ) : loans.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-loans-empty">{tr("loansEmpty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border stack-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("colNumber")}</TableHead>
                <TableHead>{tr("colEmployee")}</TableHead>
                <TableHead>{tr("colKind")}</TableHead>
                <TableHead className="text-end">{tr("colPrincipal")}</TableHead>
                <TableHead className="text-end">{tr("colInstalment")}</TableHead>
                <TableHead className="text-end">{tr("colOutstanding")}</TableHead>
                <TableHead>{tr("colStatus")}</TableHead>
                <TableHead className="text-end">{tr("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loans.map((l) => (
                <TableRow key={l.id} data-testid={`row-loan-${l.id}`}>
                  <TableCell dir="ltr" className="text-start font-mono text-sm whitespace-nowrap">{l.loanNumber}</TableCell>
                  <TableCell className="font-medium">{l.employeeName}</TableCell>
                  <TableCell>{l.kind === "loan" ? tr("kindLoan") : tr("kindAdvance")}</TableCell>
                  <TableCell className="text-end tabular-nums">{money(l.principal)}</TableCell>
                  <TableCell className="text-end tabular-nums">{money(l.instalmentAmount)} x {l.instalmentCount}</TableCell>
                  <TableCell className="text-end tabular-nums">{money(l.outstanding ?? 0)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={TONES[l.status]}>{statusLabel(l.status)}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end flex-wrap gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setScheduleFor(l.id)} data-testid={`button-loan-schedule-${l.id}`}>
                        {tr("schedule")}
                      </Button>
                      {canWrite && l.status === "active" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => { setRepayAccount(""); setRepayDate(today()); setRepaying(l); }} data-testid={`button-loan-repay-${l.id}`}>
                            {tr("repay")}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => window.confirm(tr("cancelConfirm")) && cancel.mutate(l.id)} disabled={cancel.isPending} data-testid={`button-loan-cancel-${l.id}`}>
                            {tr("cancelLoan")}
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <LoanScheduleDialog loanId={scheduleFor} onClose={() => setScheduleFor(null)} />

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-[620px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tr("dialogTitle")}</DialogTitle>
            <DialogDescription>{tr("dialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <Label>{tr("employee")}</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger data-testid="select-loan-employee">
                  <SelectValue placeholder={tr("chooseEmployee")} />
                </SelectTrigger>
                <SelectContent>
                  {employees.filter((e) => e.status === "active").map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{tr("kind")}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as "loan" | "advance")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="loan">{tr("kindLoan")}</SelectItem>
                  <SelectItem value="advance">{tr("kindAdvance")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="loan-principal">{tr("principal")}</Label>
              <Input id="loan-principal" type="number" min={0} step="0.01" dir="ltr" value={principal} onChange={(e) => setPrincipal(e.target.value)} data-testid="input-loan-principal" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loan-count">{tr("instalments")}</Label>
              <Input id="loan-count" type="number" min={1} max={120} dir="ltr" value={count} onChange={(e) => setCount(e.target.value)} data-testid="input-loan-count" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>{tr("firstMonth")}</Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {String(m).padStart(2, "0")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="loan-year">{tr("firstYear")}</Label>
                <Input id="loan-year" type="number" dir="ltr" value={year} onChange={(e) => setYear(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="loan-date">{tr("disbursement")}</Label>
              <Input id="loan-date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{tr("paymentAccount")}</Label>
              <PaymentAccountSelect companyId={companyId} value={accountId} onChange={setAccountId} placeholder={tr("chooseAccount")} testId="select-loan-account" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="loan-notes">{tr("notes")}</Label>
              <Textarea id="loan-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {previewReady && (
            <section className="space-y-2 rounded-md border p-3" data-testid="loan-preview">
              <h3 className="font-medium">{tr("previewTitle")}</h3>
              {preview.isLoading && <Skeleton className="h-16 w-full" aria-label={tr("loading")} />}
              {preview.isError && <p className="text-sm text-destructive" role="alert">{(preview.error as Error)?.message || tr("previewFailed")}</p>}
              {p && (
                <>
                  <p className="text-sm text-muted-foreground">{tr("previewWage", { wage: money(p.monthlyWage), max: money(p.maxInstalment) })}</p>
                  <p className={`text-sm ${p.withinCap ? "text-success" : "text-destructive"}`} data-testid="text-loan-cap">
                    {tr("previewInstalment", { amount: money(p.instalmentAmount) })} - {p.withinCap ? tr("withinCap") : tr("overCap")}
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded-md border">
                    <Table>
                      <TableBody>
                        {p.schedule.map((i) => (
                          <TableRow key={i.sequence}>
                            <TableCell>{i.sequence}</TableCell>
                            <TableCell dir="ltr" className="text-start">{periodLabel(i.periodYear, i.periodMonth)}</TableCell>
                            <TableCell className="text-end tabular-nums">{money(i.amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </section>
          )}
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>
              {tr("cancel")}
            </Button>
            <Button onClick={submit} disabled={create.isPending || (!!p && !p.withinCap)} data-testid="button-create-loan">
              {create.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  {tr("creating")}
                </>
              ) : (
                <>
                  <HandCoins className="h-4 w-4 me-2" />
                  {tr("create")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!repaying} onOpenChange={(o) => !o && setRepaying(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{tr("repayTitle")}</DialogTitle>
            <DialogDescription>{tr("repayBody", { amount: money(repaying?.outstanding ?? 0) })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{tr("paymentAccount")}</Label>
              <PaymentAccountSelect companyId={companyId} value={repayAccount} onChange={setRepayAccount} placeholder={tr("chooseAccount")} testId="select-repay-account" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="repay-date">{tr("repayDate")}</Label>
              <Input id="repay-date" type="date" value={repayDate} onChange={(e) => setRepayDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepaying(null)}>
              {tr("cancel")}
            </Button>
            <Button onClick={() => repaying && repay.mutate(repaying)} disabled={!repayAccount || repay.isPending} data-testid="button-confirm-repay">
              {tr("repayConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
