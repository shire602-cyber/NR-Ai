import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Calculator, FileCheck, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Money } from "@/components/ui/money";
import {
  dayOnly,
  errorMessage,
  isCashOrBankAccount,
  monthName,
  useHr,
  type Employee,
} from "./shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "./StatusBadge";
import { accountDisplayName } from "@/lib/account-name";

interface Preview {
  employeeName: string;
  completedYears: number;
  trailingDays: number;
  unpaidLeaveDays: number;
  gratuityEligible: boolean;
  gratuity: string;
  gratuityCap: string | null;
  isCapped: boolean;
  provisionAccrued: string;
  noticePay: string;
  leaveEncashmentDays: number;
  leaveEncashment: string;
  otherAdditions: string;
  deductions: string;
  net: string;
}

interface SettlementRow {
  id: string;
  employee_name: string;
  termination_date: string;
  gratuity_amount: string;
  net_amount: string;
  status: string;
}

export function SettlementTab({ companyId }: { companyId: string }) {
  const { tx, locale } = useHr();
  const { toast } = useToast();
  const listKey = [`/api/companies/${companyId}/payroll/settlements`];
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: [`/api/companies/${companyId}/employees`],
  });
  const { data: settlements = [] } = useQuery<SettlementRow[]>({ queryKey: listKey });
  // X4 (J3): settlements can be paid now (pay-from account) or later (Record payment).
  const { data: accounts = [] } = useQuery<
    Array<{
      id: string;
      code: string;
      nameEn: string;
      nameAr?: string | null;
      type: string;
      subType?: string | null;
      isArchived?: boolean;
      isActive?: boolean;
    }>
  >({ queryKey: [`/api/companies/${companyId}/accounts`] });
  const cashAccounts = accounts.filter(isCashOrBankAccount);
  const accountLabel = (a: (typeof accounts)[number]) =>
    `${a.code} · ${accountDisplayName(a, locale)}`;
  const [payNowAccount, setPayNowAccount] = useState("");
  const [paying, setPaying] = useState<SettlementRow | null>(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [form, setForm] = useState({
    employeeId: "",
    terminationDate: new Date().toISOString().slice(0, 10),
    reason: "",
    noticeDaysInLieu: "0",
    leaveEncashmentDays: "",
    otherAdditions: "0",
    deductions: "0",
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const fmt = (v: string) => formatCurrency(Number(v), "AED", locale);
  const body = () => ({
    employeeId: form.employeeId,
    terminationDate: form.terminationDate,
    reason: form.reason,
    noticeDaysInLieu: Number(form.noticeDaysInLieu || 0),
    ...(form.leaveEncashmentDays !== ""
      ? { leaveEncashmentDays: Number(form.leaveEncashmentDays) }
      : {}),
    otherAdditions: form.otherAdditions || "0",
    deductions: form.deductions || "0",
  });
  const postBody = () => ({
    ...body(),
    ...(payNowAccount && payNowAccount !== "later" ? { paymentAccountId: payNowAccount } : {}),
  });
  const fail = (err: unknown) =>
    toast({ title: tx("hr.error"), description: errorMessage(err), variant: "destructive" });

  const previewMut = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/payroll/settlements/preview`, body()),
    onSuccess: (d: Preview) => setPreview(d),
    onError: fail,
  });
  const post = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/payroll/settlements`, postBody()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/employees`] });
      setPreview(null);
      setPayNowAccount("");
      toast({ title: tx("hr.settlementPosted") });
    },
    onError: fail,
  });
  const pay = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/payroll/settlements/${paying!.id}/pay`, {
        paymentAccountId: payAccount,
        paymentDate: payDate,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      setPaying(null);
      toast({ title: tx("hr.settlementPaid") });
    },
    onError: fail,
  });
  const termMonth = form.terminationDate ? Number(form.terminationDate.slice(5, 7)) : 0;

  const field = (key: keyof typeof form, label: string, type = "text") => (
    <div className="space-y-1">
      <Label htmlFor={`set-${key}`}>{tx(label)}</Label>
      <Input
        id={`set-${key}`}
        type={type}
        value={form[key]}
        onChange={(e) => {
          setForm({ ...form, [key]: e.target.value });
          setPreview(null);
        }}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{tx("hr.tab.settlement")}</CardTitle>
          <CardDescription>{tx("hr.settlementHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label>{tx("hr.employee")}</Label>
              <Select
                value={form.employeeId || undefined}
                onValueChange={(v) => {
                  setForm({ ...form, employeeId: v });
                  setPreview(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tx("hr.select")} />
                </SelectTrigger>
                <SelectContent>
                  {employees
                    .filter((e) => e.status !== "terminated")
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.full_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {field("terminationDate", "hr.terminationDate", "date")}
            {field("reason", "hr.reason")}
            {field("noticeDaysInLieu", "hr.noticeDaysInLieu")}
            {field("leaveEncashmentDays", "hr.leaveEncashmentDays")}
            {field("otherAdditions", "hr.otherAdditions")}
            {field("deductions", "hr.deductions")}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="set-payNow">{tx("hr.settlementPayFrom")}</Label>
              <Select value={payNowAccount || "later"} onValueChange={setPayNowAccount}>
                <SelectTrigger id="set-payNow" data-testid="settlement-pay-now">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="later">{tx("hr.settlementPayLater")}</SelectItem>
                  {cashAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {termMonth > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="settlement-final-salary-note">
              {tx("hr.settlementFinalSalaryNote", {
                month: monthName(termMonth, locale),
                year: form.terminationDate.slice(0, 4),
              })}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!form.employeeId || !form.reason}
              onClick={() => previewMut.mutate()}
            >
              <Calculator className="me-2 h-4 w-4" />
              {tx("hr.preview")}
            </Button>
            <Button disabled={!preview || post.isPending} onClick={() => post.mutate()}>
              <FileCheck className="me-2 h-4 w-4" />
              {tx("hr.postSettlement")}
            </Button>
          </div>
          {preview && (
            <div className="grid grid-cols-1 gap-2 rounded border p-4 text-sm md:grid-cols-2">
              <div>
                {tx("hr.serviceLine", {
                  years: preview.completedYears,
                  days: preview.trailingDays,
                  unpaid: preview.unpaidLeaveDays,
                })}
              </div>
              <div>
                {tx("hr.gratuity")}: <Money amount={Number(preview.gratuity)} currency="AED" />
                {preview.isCapped && preview.gratuityCap
                  ? ` (${tx("hr.capped")} ${fmt(preview.gratuityCap)})`
                  : ""}
              </div>
              <div>
                {tx("hr.provisionAccrued")}:{" "}
                <Money amount={Number(preview.provisionAccrued)} currency="AED" />
              </div>
              <div>
                {tx("hr.noticePay")}: <Money amount={Number(preview.noticePay)} currency="AED" />
              </div>
              <div>
                {tx("hr.leaveEncashment")} ({preview.leaveEncashmentDays}):{" "}
                <Money amount={Number(preview.leaveEncashment)} currency="AED" />
              </div>
              <div>
                {tx("hr.deductions")}: <Money amount={Number(preview.deductions)} currency="AED" />
              </div>
              <div className="font-semibold">
                {tx("hr.net")}: <Money amount={Number(preview.net)} currency="AED" />
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{tx("hr.counselReviewNote")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tx("hr.settlements")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {settlements.length === 0 ? (
            <p className="text-muted-foreground">{tx("hr.noSettlements")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tx("hr.employee")}</TableHead>
                  <TableHead>{tx("hr.terminationDate")}</TableHead>
                  <TableHead data-numeric>{tx("hr.gratuity")}</TableHead>
                  <TableHead data-numeric>{tx("hr.net")}</TableHead>
                  <TableHead>{tx("hr.statusLabel")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{tx("hr.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.employee_name}</TableCell>
                    <TableCell>{dayOnly(s.termination_date)}</TableCell>
                    <TableCell data-numeric>
                      <Money amount={Number(s.gratuity_amount)} currency="AED" />
                    </TableCell>
                    <TableCell data-numeric>
                      <Money amount={Number(s.net_amount)} currency="AED" />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell>
                      {s.status === "posted" && Number(s.net_amount) > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`settlement-pay-${s.id}`}
                          onClick={() => {
                            setPaying(s);
                            setPayAccount("");
                            setPayDate(new Date().toISOString().slice(0, 10));
                          }}
                        >
                          <Wallet className="me-1.5 h-4 w-4" aria-hidden />
                          {tx("hr.recordPayment")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{tx("hr.recordPayment")}</DialogTitle>
            <DialogDescription>
              {paying
                ? tx("hr.settlementPayHint", {
                    name: paying.employee_name,
                    amount: fmt(paying.net_amount),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="settle-pay-account">{tx("hr.paymentAccount")}</Label>
              <Select value={payAccount || undefined} onValueChange={setPayAccount}>
                <SelectTrigger id="settle-pay-account" data-testid="settlement-pay-account">
                  <SelectValue placeholder={tx("hr.select")} />
                </SelectTrigger>
                <SelectContent>
                  {cashAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="settle-pay-date">{tx("hr.paymentDate")}</Label>
              <DatePicker
                id="settle-pay-date"
                value={payDate}
                onChange={(value) => setPayDate(value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)}>
              {tx("hr.cancel")}
            </Button>
            <Button
              disabled={!payAccount || !payDate || pay.isPending}
              onClick={() => pay.mutate()}
              data-testid="settlement-pay-confirm"
            >
              {tx("hr.recordPayment")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
