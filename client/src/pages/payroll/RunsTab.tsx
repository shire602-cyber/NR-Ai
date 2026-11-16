import { useState } from "react";
import {
  ErrorSummary,
  Field,
  FormActions,
  FormGrid,
  FormSection,
  useFormGate,
} from "@/components/ui/form-layout";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Calculator,
  CheckCircle,
  ChevronLeft,
  Download,
  Eye,
  Plus,
  Undo2,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { Money, MoneyCell } from "@/components/ui/money";
import { RowActions, RowActionButton } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  downloadFile,
  errorMessage,
  monthName,
  useHr,
  type PayrollItem,
  type PayrollRun,
  type SifIssue,
} from "./shared";
import { StatusBadge } from "./StatusBadge";

interface Account {
  id: string;
  code: string;
  nameEn: string;
  type: string;
  isArchived?: boolean;
}

export function RunsTab({ companyId }: { companyId: string }) {
  const { tx, locale } = useHr();
  const { toast } = useToast();
  const runsKey = [`/api/companies/${companyId}/payroll-runs`];
  const { data: runs = [] } = useQuery<PayrollRun[]>({ queryKey: runsKey });
  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: [`/api/companies/${companyId}/accounts`],
  });
  const [viewing, setViewing] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [payRun, setPayRun] = useState<PayrollRun | null>(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [reverseRun, setReverseRun] = useState<{
    run: PayrollRun;
    action: "unpay" | "unapprove";
  } | null>(null);
  const [reason, setReason] = useState("");
  const runGate = useFormGate([{ id: "run-year", label: tx("hr.year"), invalid: !year.trim() }]);
  const [issues, setIssues] = useState<SifIssue[] | null>(null);

  const run = runs.find((r) => r.id === viewing) ?? null;
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: runsKey });
    if (viewing)
      queryClient.invalidateQueries({ queryKey: [`/api/payroll-runs/${viewing}/items`] });
  };
  const fail = (err: unknown) =>
    toast({ title: tx("hr.error"), description: errorMessage(err), variant: "destructive" });

  const action = useMutation({
    mutationFn: ({ id, path, body }: { id: string; path: string; body?: unknown }) =>
      apiRequest("POST", `/api/payroll-runs/${id}/${path}`, body ?? {}),
    onSuccess: (_d, v) => {
      refresh();
      toast({ title: tx(`hr.done.${v.path}`) });
      setPayRun(null);
      setReverseRun(null);
    },
    onError: fail,
  });

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/payroll-runs`, {
        periodMonth: Number(month),
        periodYear: Number(year),
      }),
    onSuccess: () => {
      refresh();
      setCreateOpen(false);
      toast({ title: tx("hr.runCreated") });
    },
    onError: fail,
  });

  const downloadSif = async (r: PayrollRun) => {
    try {
      const pre = (await apiRequest("GET", `/api/payroll-runs/${r.id}/sif-prevalidation`)) as {
        ready: boolean;
        issues: SifIssue[];
      };
      if (!pre.ready) {
        setIssues(pre.issues);
        return;
      }
      await downloadFile(`/api/payroll-runs/${r.id}/generate-sif`, "payroll.SIF");
      refresh();
      toast({ title: tx("hr.sifDownloaded"), description: tx("hr.sifExternalNote") });
    } catch (err) {
      fail(err);
    }
  };

  const bankAccounts = accounts.filter((a) => a.type === "asset" && !a.isArchived);

  if (run) {
    return (
      <RunDetail
        run={run}
        onBack={() => setViewing(null)}
        onChanged={refresh}
        onSif={() => downloadSif(run)}
      />
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <CardTitle>{tx("hr.tab.runs")}</CardTitle>
          <CardDescription>{tx("hr.runsHint")}</CardDescription>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-new-run">
          <Plus className="me-2 h-4 w-4" />
          {tx("hr.newRun")}
        </Button>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="text-muted-foreground">{tx("hr.noRuns")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tx("hr.period")}</TableHead>
                  <TableHead data-numeric>{tx("hr.employeesCount")}</TableHead>
                  <TableHead data-numeric>{tx("hr.totalNet")}</TableHead>
                  <TableHead>{tx("hr.statusLabel")}</TableHead>
                  <TableHead>{tx("hr.wpsStatus")}</TableHead>
                  <TableHead data-numeric>{tx("hr.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium" data-nowrap>
                      {monthName(r.period_month, locale)} {r.period_year}
                    </TableCell>
                    <TableCell data-numeric>{r.employee_count}</TableCell>
                    <MoneyCell amount={Number(r.total_net)} currency="AED" />
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.wps_status} />
                    </TableCell>
                    <TableCell data-nowrap>
                      {/* One next-step action per run (outline); view, SIF and reversals stay quiet. */}
                      <div className="flex items-center justify-end gap-1">
                        {["draft", "calculated", "reversed"].includes(r.status) &&
                          r.status !== "calculated" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => action.mutate({ id: r.id, path: "calculate" })}
                            >
                              <Calculator className="me-1.5 h-4 w-4" aria-hidden />
                              {tx("hr.calculate")}
                            </Button>
                          )}
                        {r.status === "calculated" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => action.mutate({ id: r.id, path: "approve" })}
                          >
                            <CheckCircle className="me-1.5 h-4 w-4" aria-hidden />
                            {tx("hr.approve")}
                          </Button>
                        )}
                        {r.status === "approved" && (
                          <Button size="sm" variant="outline" onClick={() => setPayRun(r)}>
                            <Wallet className="me-1.5 h-4 w-4" aria-hidden />
                            {tx("hr.recordPayment")}
                          </Button>
                        )}
                        <RowActions
                          menu={
                            r.status === "calculated" ||
                            r.status === "approved" ||
                            r.status === "paid" ? (
                              <>
                                {r.status === "calculated" && (
                                  <DropdownMenuItem
                                    onSelect={() => action.mutate({ id: r.id, path: "calculate" })}
                                  >
                                    <Calculator aria-hidden />
                                    {tx("hr.calculate")}
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onSelect={() => downloadSif(r)}>
                                  <Download aria-hidden />
                                  {tx("hr.downloadSif")}
                                </DropdownMenuItem>
                                {r.status === "approved" && (
                                  <DropdownMenuItem
                                    onSelect={() => setReverseRun({ run: r, action: "unapprove" })}
                                  >
                                    <Undo2 aria-hidden />
                                    {tx("hr.unapprove")}
                                  </DropdownMenuItem>
                                )}
                                {r.status === "paid" && (
                                  <DropdownMenuItem
                                    onSelect={() => setReverseRun({ run: r, action: "unpay" })}
                                  >
                                    <Undo2 aria-hidden />
                                    {tx("hr.unpay")}
                                  </DropdownMenuItem>
                                )}
                              </>
                            ) : undefined
                          }
                        >
                          <RowActionButton
                            icon={Eye}
                            label={tx("hr.view")}
                            onClick={() => setViewing(r.id)}
                          />
                        </RowActions>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{tx("hr.approvalSodHint")}</p>
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent size="sm" data-testid="dialog-payroll-run-form">
          <DialogHeader>
            <DialogTitle>{tx("hr.newRun")}</DialogTitle>
            <DialogDescription>{tx("hr.newRunHint")}</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (create.isPending || !runGate.attempt()) return;
              create.mutate();
            }}
          >
            <ErrorSummary items={runGate.summary} />
            <FormSection title={tx("forms.section.period")}>
              <FormGrid>
                <Field id="run-month" label={tx("hr.month")} required>
                  <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger id="run-month">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>
                          {monthName(i + 1, locale)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  id="run-year"
                  label={tx("hr.year")}
                  required
                  error={runGate.errorFor("run-year")}
                >
                  <Input
                    inputMode="numeric"
                    maxLength={4}
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  />
                </Field>
              </FormGrid>
            </FormSection>
            <FormActions>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {tx("hr.cancel")}
              </Button>
              <Button type="submit" className="sm:min-w-28" disabled={create.isPending}>
                {tx("hr.create")}
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payRun} onOpenChange={(o) => !o && setPayRun(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{tx("hr.recordPayment")}</DialogTitle>
            <DialogDescription>{tx("hr.recordPaymentHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!payRun || !payAccount || action.isPending) return;
              action.mutate({
                id: payRun.id,
                path: "pay",
                body: { paymentAccountId: payAccount, paymentDate: payDate },
              });
            }}
          >
            <FormGrid cols={1}>
              <Field id="pay-account" label={tx("hr.paymentAccount")} required>
                <Select value={payAccount || undefined} onValueChange={setPayAccount}>
                  <SelectTrigger id="pay-account">
                    <SelectValue placeholder={tx("hr.select")} />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.code} · {a.nameEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="pay-date" label={tx("hr.paymentDate")} required>
                <Input
                  type="date"
                  dir="ltr"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </Field>
            </FormGrid>
            <FormActions>
              <Button type="button" variant="outline" onClick={() => setPayRun(null)}>
                {tx("hr.cancel")}
              </Button>
              <Button type="submit" disabled={!payAccount || action.isPending}>
                {tx("hr.recordPayment")}
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reverseRun} onOpenChange={(o) => !o && setReverseRun(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {tx(reverseRun?.action === "unpay" ? "hr.unpay" : "hr.unapprove")}
            </DialogTitle>
            <DialogDescription>{tx("hr.reverseHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reverseRun || !reason || action.isPending) return;
              action.mutate({ id: reverseRun.run.id, path: reverseRun.action, body: { reason } });
            }}
          >
            <Field id="rev-reason" label={tx("hr.reason")} required>
              <Input dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <FormActions>
              <Button type="button" variant="outline" onClick={() => setReverseRun(null)}>
                {tx("hr.cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={!reason || action.isPending}>
                {tx("hr.confirm")}
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>

      <SifIssuesDialog issues={issues} onClose={() => setIssues(null)} />
    </Card>
  );
}

export function SifIssuesDialog({
  issues,
  onClose,
}: {
  issues: SifIssue[] | null;
  onClose: () => void;
}) {
  const { tx } = useHr();
  return (
    <Dialog open={!!issues} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tx("hr.sifBlocked")}</DialogTitle>
          <DialogDescription>{tx("hr.sifBlockedHint")}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
          {(issues ?? []).map((i, idx) => (
            <li key={idx} className="rounded border p-2">
              <span className="font-medium">{i.employeeName ?? tx("hr.employer")}</span>
              {" — "}
              {i.message}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={onClose}>{tx("hr.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunDetail({
  run,
  onBack,
  onChanged,
  onSif,
}: {
  run: PayrollRun;
  onBack: () => void;
  onChanged: () => void;
  onSif: () => void;
}) {
  const { tx, locale } = useHr();
  const { toast } = useToast();
  const { data: items = [] } = useQuery<PayrollItem[]>({
    queryKey: [`/api/payroll-runs/${run.id}/items`],
  });
  const [editing, setEditing] = useState<PayrollItem | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const editable = run.status === "draft" || run.status === "calculated";

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(form))
        if (v !== "") body[k] = k === "deductionNotes" ? v : Number(v);
      return apiRequest("PATCH", `/api/payroll-items/${editing!.id}`, body);
    },
    onSuccess: () => {
      onChanged();
      setEditing(null);
      toast({ title: tx("hr.itemUpdated") });
    },
    onError: (err) =>
      toast({ title: tx("hr.error"), description: errorMessage(err), variant: "destructive" }),
  });

  const fmt = (v: string) => formatCurrency(Number(v), "AED", locale);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-2">
            <ChevronLeft className="me-1 h-4 w-4 rtl:rotate-180" />
            {tx("hr.back")}
          </Button>
          <CardTitle>
            {monthName(run.period_month, locale)} {run.period_year}
          </CardTitle>
          <CardDescription>
            <StatusBadge status={run.status} />
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {["calculated", "approved", "paid"].includes(run.status) && (
            <Button variant="outline" size="sm" onClick={onSif}>
              <Download className="me-1 h-4 w-4" />
              {tx("hr.downloadSif")}
            </Button>
          )}
          {["approved", "paid"].includes(run.status) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadFile(`/api/payroll-runs/${run.id}/gpssa-export`, "gpssa.csv").catch((err) =>
                  toast({
                    title: tx("hr.error"),
                    description: errorMessage(err),
                    variant: "destructive",
                  })
                )
              }
            >
              <Download className="me-1 h-4 w-4" />
              {tx("hr.gpssaExport")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tx("hr.field.fullName")}</TableHead>
              <TableHead data-numeric>{tx("hr.field.basicSalary")}</TableHead>
              <TableHead data-numeric>{tx("hr.allowances")}</TableHead>
              <TableHead data-numeric>{tx("hr.overtime")}</TableHead>
              <TableHead data-numeric>{tx("hr.unpaidLeave")}</TableHead>
              <TableHead data-numeric>{tx("hr.pension")}</TableHead>
              <TableHead data-numeric>{tx("hr.deductions")}</TableHead>
              <TableHead data-numeric>{tx("hr.net")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.employee_name}</TableCell>
                <TableCell data-numeric>
                  <Money amount={Number(i.basic_salary)} currency="AED" />
                </TableCell>
                <TableCell data-numeric>
                  {fmt(
                    String(
                      Number(i.housing_allowance) +
                        Number(i.transport_allowance) +
                        Number(i.other_allowance)
                    )
                  )}
                </TableCell>
                <TableCell data-numeric>
                  <Money amount={Number(i.overtime)} currency="AED" />
                </TableCell>
                <TableCell data-numeric>
                  {Number(i.unpaid_leave_days) > 0
                    ? `${i.unpaid_leave_days} · ${fmt(i.unpaid_leave_deduction)}`
                    : "—"}
                </TableCell>
                <TableCell data-numeric>
                  <Money amount={Number(i.pension_employee)} currency="AED" />
                </TableCell>
                <TableCell data-numeric>
                  <Money amount={Number(i.deductions)} currency="AED" />
                </TableCell>
                <TableCell data-numeric className="font-medium">
                  <Money amount={Number(i.net_salary)} currency="AED" />
                </TableCell>
                <TableCell>
                  {editable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(i);
                        setForm({
                          overtimeHours: i.overtime_hours ?? "0",
                          deductions: i.deductions,
                          deductionNotes: i.deduction_notes ?? "",
                          unpaidLeaveDays: i.unpaid_leave_days,
                          paidLeaveDays: i.paid_leave_days,
                        });
                      }}
                    >
                      {tx("hr.edit")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.employee_name}</DialogTitle>
            <DialogDescription>{tx("hr.itemEditHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["overtimeHours", "hr.overtimeHours"],
              ["deductions", "hr.deductions"],
              ["unpaidLeaveDays", "hr.unpaidLeaveDays"],
              ["paidLeaveDays", "hr.paidLeaveDays"],
            ].map(([k, label]) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`item-${k}`}>{tx(label)}</Label>
                <Input
                  id={`item-${k}`}
                  inputMode="decimal"
                  value={form[k] ?? ""}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </div>
            ))}
            <div className="col-span-2 space-y-1">
              <Label htmlFor="item-notes">{tx("hr.deductionNotes")}</Label>
              <Input
                id="item-notes"
                value={form.deductionNotes ?? ""}
                onChange={(e) => setForm({ ...form, deductionNotes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {tx("hr.cancel")}
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {tx("hr.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
