import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaymentAccountSelect } from "@/components/payroll/PaymentAccountSelect";
import type { TabEmployee } from "@/components/payroll/payroll-common";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { CALENDAR_DATE_SHORT_FORMAT, formatCurrency, formatDate } from "@/lib/format";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import type { FinalSettlement, SettlementPreview, SettlementStatus } from "@/lib/purchasing-hr";
import { messages } from "./FinalSettlementTab.i18n";

interface Props {
  companyId: string;
  employees: TabEmployee[];
  canWrite: boolean;
}

const TONES: Record<SettlementStatus, StatusTone> = { draft: "neutral", posted: "info", paid: "success", void: "danger" };
const today = () => new Date().toISOString().slice(0, 10);

export function FinalSettlementTab({ companyId, employees, canWrite }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [dialog, setDialog] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState<"resignation" | "termination" | "end_of_contract">("resignation");
  const [provision, setProvision] = useState("");
  const [leave, setLeave] = useState("");
  const [other, setOther] = useState("0");
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [paying, setPaying] = useState<FinalSettlement | null>(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(today());

  const listKey = ["/api/companies", companyId, "final-settlements"];
  const { data: settlements = [], isLoading, isError } = useQuery<FinalSettlement[]>({
    queryKey: [...listKey, "list"],
    enabled: !!companyId,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/final-settlements?limit=200`),
  });

  const body = {
    employeeId,
    terminationDate: date,
    reason,
    provisionUsed: provision.trim() === "" ? null : Number(provision),
    leaveDays: leave.trim() === "" ? null : Number(leave),
    otherDeductions: Number(other) || 0,
    notes: notes.trim() || null,
  };
  const ready = dialog && !!employeeId && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const preview = useQuery<SettlementPreview>({
    queryKey: [...listKey, "preview", employeeId, date, reason, provision, leave, other],
    enabled: ready,
    retry: false,
    queryFn: () => apiRequest("POST", `/api/companies/${companyId}/final-settlements/preview`, body),
  });

  const money = (n: number) => formatCurrency(n, "AED", locale);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: listKey });
    queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/employees`] });
  };
  const codeMessage = (error: unknown): string | undefined => {
    const code = error instanceof ApiError ? error.code : undefined;
    return code === "PROVISION_EXCEEDS_BALANCE" ? tr("codeProvision") : code === "SETTLEMENT_NEGATIVE" ? tr("codeNegative") : code === "SETTLEMENT_EXISTS" ? tr("codeExists") : (error as Error)?.message;
  };

  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/final-settlements`, body),
    onSuccess: () => {
      toast({ title: tr("created") });
      setDialog(false);
      refresh();
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: tr("createFailed"), description: codeMessage(error) }),
  });
  const post = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/final-settlements/${id}/post`, {}),
    onSuccess: () => {
      toast({ title: tr("posted") });
      refresh();
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: tr("postFailed"), description: codeMessage(error) }),
  });
  const voidIt = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/final-settlements/${id}/void`, {}),
    onSuccess: () => {
      toast({ title: tr("voided") });
      refresh();
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: tr("voidFailed"), description: codeMessage(error) }),
  });
  const pay = useMutation({
    mutationFn: (s: FinalSettlement) => apiRequest("POST", `/api/final-settlements/${s.id}/pay`, { paymentAccountId: payAccount, date: payDate }),
    onSuccess: () => {
      toast({ title: tr("paid") });
      setPaying(null);
      refresh();
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: tr("payFailed"), description: codeMessage(error) }),
  });

  const submit = () => {
    if (!employeeId) return setProblem(tr("needEmployee"));
    if (!date) return setProblem(tr("needDate"));
    setProblem(null);
    create.mutate();
  };

  const statusLabel = (s: SettlementStatus) => (s === "draft" ? tr("statusDraft") : s === "posted" ? tr("statusPosted") : s === "paid" ? tr("statusPaid") : tr("statusVoid"));
  const p = preview.data;
  const Line = ({ label, value, strong, testId }: { label: string; value: string; strong?: boolean; testId?: string }) => (
    <div className={`flex justify-between gap-4 text-sm ${strong ? "font-semibold border-t pt-1" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums" data-testid={testId}>{value}</span>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="tab-settlement">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">{tr("intro")}</p>
        {canWrite ? (
          <Button onClick={() => { setProblem(null); setDialog(true); }} data-testid="button-new-settlement">
            <Plus className="h-4 w-4 me-2" />
            {tr("newSettlement")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{tr("readOnly")}</p>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" aria-label={tr("loading")} />
      ) : isError ? (
        <p className="text-sm text-destructive" role="alert">{tr("loadFailed")}</p>
      ) : settlements.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-settlements-empty">{tr("listEmpty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border stack-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("colEmployee")}</TableHead>
                <TableHead>{tr("colDate")}</TableHead>
                <TableHead className="text-end">{tr("colNet")}</TableHead>
                <TableHead>{tr("colStatus")}</TableHead>
                {canWrite && <TableHead className="text-end">{tr("colActions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {settlements.map((s) => (
                <TableRow key={s.id} data-testid={`row-settlement-${s.id}`}>
                  <TableCell className="font-medium">{s.employeeName}</TableCell>
                  <TableCell>{formatDate(s.terminationDate, locale, CALENDAR_DATE_SHORT_FORMAT)}</TableCell>
                  <TableCell className="text-end tabular-nums font-semibold">{money(s.netPayable)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={TONES[s.status]}>{statusLabel(s.status)}</StatusBadge>
                  </TableCell>
                  {canWrite && (
                    <TableCell className="text-end">
                      <div className="flex justify-end gap-1 flex-wrap">
                        {s.status === "draft" && (
                          <Button size="sm" onClick={() => window.confirm(tr("postConfirm")) && post.mutate(s.id)} disabled={post.isPending} data-testid={`button-post-settlement-${s.id}`}>
                            {tr("post")}
                          </Button>
                        )}
                        {s.status === "posted" && (
                          <>
                            <Button size="sm" onClick={() => { setPayAccount(""); setPayDate(today()); setPaying(s); }} data-testid={`button-pay-settlement-${s.id}`}>
                              {tr("pay")}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => window.confirm(tr("voidConfirm")) && voidIt.mutate(s.id)} disabled={voidIt.isPending}>
                              {tr("voidIt")}
                            </Button>
                          </>
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

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-[680px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tr("formTitle")}</DialogTitle>
            <DialogDescription>{tr("intro")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <Label>{tr("employee")}</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger data-testid="select-settlement-employee">
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
              <Label htmlFor="settlement-date">{tr("terminationDate")}</Label>
              <Input id="settlement-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-settlement-date" />
            </div>
            <div className="space-y-1">
              <Label>{tr("reason")}</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as typeof reason)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resignation">{tr("reasonResignation")}</SelectItem>
                  <SelectItem value="termination">{tr("reasonTermination")}</SelectItem>
                  <SelectItem value="end_of_contract">{tr("reasonEnd")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="settlement-provision">{tr("provisionOverride")}</Label>
              <Input id="settlement-provision" type="number" min={0} step="0.01" dir="ltr" value={provision} onChange={(e) => setProvision(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="settlement-leave">{tr("leaveOverride")}</Label>
              <Input id="settlement-leave" type="number" min={0} step="0.5" dir="ltr" value={leave} onChange={(e) => setLeave(e.target.value)} data-testid="input-settlement-leave" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="settlement-other">{tr("otherDeductions")}</Label>
              <Input id="settlement-other" type="number" min={0} step="0.01" dir="ltr" value={other} onChange={(e) => setOther(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="settlement-notes">{tr("notes")}</Label>
              <Textarea id="settlement-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {ready && (
            <section className="space-y-2 rounded-md border p-3" data-testid="settlement-preview">
              <h3 className="font-medium">{tr("previewTitle")}</h3>
              {preview.isLoading && <Skeleton className="h-24 w-full" aria-label={tr("loading")} />}
              {preview.isError && <p className="text-sm text-destructive" role="alert">{codeMessage(preview.error) || tr("previewFailed")}</p>}
              {p && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">{p.isGccNational ? tr("gccNational") : tr("notGcc")}</p>
                  {p.warnings.map((w) => (
                    <p key={w} className="text-xs text-warning">{w}</p>
                  ))}
                  <Line label={tr("yearsOfService")} value={p.yearsOfService.toFixed(2)} />
                  <Line label={tr("basicSalary")} value={money(p.basicSalary)} />
                  <Line label={tr("gratuity")} value={money(p.gratuityAmount)} testId="text-settlement-gratuity" />
                  <Line label={tr("provisionAccrued")} value={money(p.provisionAccrued)} />
                  <Line label={tr("provisionBalance")} value={money(p.provisionBalance)} />
                  <Line label={tr("provisionUsed")} value={money(p.provisionUsed)} />
                  <Line label={tr("trueUp")} value={money(p.gratuityTrueUp)} />
                  <Line label={`${tr("leaveEncashment")} (${tr("leaveDays")}: ${p.leaveDays})`} value={money(p.leaveEncashment)} testId="text-settlement-leave" />
                  <Line label={tr("loanRecovered")} value={money(p.loanRecovered)} />
                  <Line label={tr("other")} value={money(p.otherDeductions)} />
                  <Line label={tr("netPayable")} value={money(p.netPayable)} strong testId="text-settlement-net" />
                </div>
              )}
            </section>
          )}
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>
              {tr("cancel")}
            </Button>
            <Button onClick={submit} disabled={create.isPending || !p} data-testid="button-create-settlement">
              {create.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  {tr("creating")}
                </>
              ) : (
                tr("createDraft")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{tr("payTitle")}</DialogTitle>
            <DialogDescription>{tr("payBody", { amount: money(paying?.netPayable ?? 0) })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{tr("paymentAccount")}</Label>
              <PaymentAccountSelect companyId={companyId} value={payAccount} onChange={setPayAccount} placeholder={tr("chooseAccount")} testId="select-settlement-account" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="settlement-pay-date">{tr("payDate")}</Label>
              <Input id="settlement-pay-date" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)}>
              {tr("cancel")}
            </Button>
            <Button onClick={() => paying && pay.mutate(paying)} disabled={!payAccount || pay.isPending} data-testid="button-confirm-pay-settlement">
              {tr("payConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
