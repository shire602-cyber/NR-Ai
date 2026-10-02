import { useEffect, useState } from "react";
import { todayYmd as today } from "@/lib/calendar-date";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarPlus, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LeaveBalancesPanel } from "@/components/payroll/LeaveBalancesPanel";
import { LeaveTypesPanel } from "@/components/payroll/LeaveTypesPanel";
import type { TabEmployee } from "@/components/payroll/payroll-common";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { CALENDAR_DATE_SHORT_FORMAT, formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { inclusiveCalendarDays, type LeaveRequest, type LeaveType } from "@/lib/purchasing-hr";
import { messages } from "./LeaveTab.i18n";

interface Props {
  companyId: string;
  employees: TabEmployee[];
  canWrite: boolean;
}

type StatusFilter = "all" | LeaveRequest["status"];
const TONES: Record<LeaveRequest["status"], StatusTone> = { pending: "warning", approved: "success", rejected: "danger", cancelled: "neutral" };

export function LeaveTab({ companyId, employees, canWrite }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [dialog, setDialog] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const typesKey = ["/api/companies", companyId, "leave-types"];
  const requestsKey = ["/api/companies", companyId, "leave-requests"];
  const { data: types = [] } = useQuery<LeaveType[]>({ queryKey: typesKey, enabled: !!companyId });
  const { data: requests = [], isLoading, isError } = useQuery<LeaveRequest[]>({
    queryKey: [...requestsKey, status],
    enabled: !!companyId,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/leave-requests?status=${status}&limit=200`),
  });

  // The days follow the dates until the person types their own (half days).
  useEffect(() => {
    if (dialog) setDays(String(inclusiveCalendarDays(start, end) || ""));
  }, [start, end, dialog]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: requestsKey });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "leave-balances"] });
  };

  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/leave-requests`, { employeeId, leaveTypeId: typeId, startDate: start, endDate: end, days: Number(days), reason: reason.trim() || null }),
    onSuccess: () => {
      toast({ title: tr("requestSaved") });
      setDialog(false);
      setReason("");
      refresh();
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("requestFailed"), description: error?.message }),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" | "cancel" }) => apiRequest("POST", `/api/leave-requests/${id}/${decision}`, {}),
    onSuccess: () => {
      toast({ title: tr("decisionDone") });
      refresh();
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("decisionFailed"), description: error?.message }),
  });

  const submit = () => {
    if (!employeeId) return setProblem(tr("needEmployee"));
    if (!typeId) return setProblem(tr("needType"));
    if (inclusiveCalendarDays(start, end) === 0 || !(Number(days) > 0)) return setProblem(tr("needDates"));
    setProblem(null);
    create.mutate();
  };

  const statusLabel = (s: LeaveRequest["status"]) =>
    s === "pending" ? tr("statusPending") : s === "approved" ? tr("statusApproved") : s === "rejected" ? tr("statusRejected") : tr("statusCancelled");
  const day = (d: string) => formatDate(d, locale, CALENDAR_DATE_SHORT_FORMAT);

  return (
    <Tabs defaultValue="requests" className="space-y-4" data-testid="tab-leave">
      <TabsList>
        <TabsTrigger value="requests" data-testid="subtab-leave-requests">{tr("subRequests")}</TabsTrigger>
        <TabsTrigger value="balances" data-testid="subtab-leave-balances">{tr("subBalances")}</TabsTrigger>
        <TabsTrigger value="types" data-testid="subtab-leave-types">{tr("subTypes")}</TabsTrigger>
      </TabsList>

      <TabsContent value="requests" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1 w-[200px]">
            <Label>{tr("filterStatus")}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger data-testid="select-leave-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tr("statusAll")}</SelectItem>
                <SelectItem value="pending">{tr("statusPending")}</SelectItem>
                <SelectItem value="approved">{tr("statusApproved")}</SelectItem>
                <SelectItem value="rejected">{tr("statusRejected")}</SelectItem>
                <SelectItem value="cancelled">{tr("statusCancelled")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {canWrite ? (
            <Button onClick={() => { setProblem(null); setEmployeeId(""); setTypeId(""); setReason(""); setStart(today()); setEnd(today()); setDialog(true); }} data-testid="button-new-leave-request">
              <CalendarPlus className="h-4 w-4 me-2" />
              {tr("newRequest")}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{tr("readOnly")}</p>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-32 w-full" aria-label={tr("loading")} />
        ) : isError ? (
          <p className="text-sm text-destructive" role="alert">{tr("loadFailed")}</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-leave-empty">{tr("requestsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border stack-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("colEmployee")}</TableHead>
                  <TableHead>{tr("colType")}</TableHead>
                  <TableHead>{tr("colFrom")}</TableHead>
                  <TableHead>{tr("colTo")}</TableHead>
                  <TableHead className="text-end">{tr("colDays")}</TableHead>
                  <TableHead>{tr("colStatus")}</TableHead>
                  {canWrite && <TableHead className="text-end">{tr("colActions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id} data-testid={`row-leave-${r.id}`}>
                    <TableCell className="font-medium">{r.employeeName}</TableCell>
                    <TableCell>{locale === "ar" ? r.typeNameAr : r.typeNameEn}</TableCell>
                    <TableCell>{day(r.startDate)}</TableCell>
                    <TableCell>{day(r.endDate)}</TableCell>
                    <TableCell className="text-end tabular-nums">{r.days}</TableCell>
                    <TableCell>
                      <StatusBadge tone={TONES[r.status]}>{statusLabel(r.status)}</StatusBadge>
                    </TableCell>
                    {canWrite && (
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          {r.status === "pending" && (
                            <>
                              <Button size="sm" onClick={() => decide.mutate({ id: r.id, decision: "approve" })} disabled={decide.isPending} data-testid={`button-approve-leave-${r.id}`}>
                                <CheckCircle2 className="h-4 w-4 me-1" />
                                {tr("approve")}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, decision: "reject" })} disabled={decide.isPending} data-testid={`button-reject-leave-${r.id}`}>
                                <XCircle className="h-4 w-4 me-1" />
                                {tr("reject")}
                              </Button>
                            </>
                          )}
                          {(r.status === "pending" || r.status === "approved") && (
                            <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, decision: "cancel" })} disabled={decide.isPending}>
                              {tr("cancelRequest")}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="balances">
        <LeaveBalancesPanel companyId={companyId} employees={employees} types={types} canWrite={canWrite} />
      </TabsContent>
      <TabsContent value="types">
        <LeaveTypesPanel companyId={companyId} types={types} canWrite={canWrite} />
      </TabsContent>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{tr("requestDialogTitle")}</DialogTitle>
            <DialogDescription>{tr("requestDialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{tr("employee")}</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger data-testid="select-leave-employee">
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
              <Label>{tr("leaveType")}</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger data-testid="select-leave-type">
                  <SelectValue placeholder={tr("chooseType")} />
                </SelectTrigger>
                <SelectContent>
                  {types.filter((t) => t.isActive).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {locale === "ar" ? t.nameAr : t.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="leave-start">{tr("startDate")}</Label>
                <Input id="leave-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="input-leave-start" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="leave-end">{tr("endDate")}</Label>
                <Input id="leave-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} data-testid="input-leave-end" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="leave-days">{tr("days")}</Label>
                <Input id="leave-days" type="number" min={0.5} step={0.5} dir="ltr" value={days} onChange={(e) => setDays(e.target.value)} data-testid="input-leave-days" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="leave-reason">{tr("reason")}</Label>
              <Textarea id="leave-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </div>
            {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>
              {tr("cancel")}
            </Button>
            <Button onClick={submit} disabled={create.isPending} data-testid="button-submit-leave">
              {create.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  {tr("saving")}
                </>
              ) : (
                tr("submit")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
