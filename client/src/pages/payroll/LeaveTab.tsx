import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
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
import { dayOnly, errorMessage, useHr, type Employee } from "./shared";
import { StatusBadge } from "./StatusBadge";

interface LeaveType {
  id: string;
  code: string;
  name_en: string;
  name_ar: string | null;
  is_paid: boolean;
  annual_entitlement_days: string;
}

interface LeaveRequest {
  id: string;
  employee_name: string;
  leave_name_en: string;
  leave_name_ar: string | null;
  start_date: string;
  end_date: string;
  days: string;
  status: string;
  is_paid: boolean;
}

interface Balance {
  leaveTypeId: string;
  nameEn: string;
  nameAr: string | null;
  accruedDays: number;
  takenDays: number;
  pendingDays: number;
  balanceDays: number;
}

export function LeaveTab({ companyId }: { companyId: string }) {
  const { tx, locale } = useHr();
  const { toast } = useToast();
  const reqKey = [`/api/companies/${companyId}/payroll/leave-requests`];
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: [`/api/companies/${companyId}/employees`],
  });
  const { data: types = [] } = useQuery<LeaveType[]>({
    queryKey: [`/api/companies/${companyId}/payroll/leave-types`],
  });
  const { data: requests = [] } = useQuery<LeaveRequest[]>({ queryKey: reqKey });
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [days, setDays] = useState("");
  const { data: balances = [] } = useQuery<Balance[]>({
    queryKey: [`/api/employees/${employeeId}/leave-balances`],
    enabled: !!employeeId,
  });
  const name = (en: string, ar: string | null) => (locale === "ar" && ar ? ar : en);
  const fail = (err: unknown) =>
    toast({ title: tx("hr.error"), description: errorMessage(err), variant: "destructive" });

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/payroll/leave-requests`, {
        employeeId,
        leaveTypeId,
        startDate,
        endDate,
        ...(days ? { days: Number(days) } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reqKey });
      toast({ title: tx("hr.leaveRequested") });
      setStartDate("");
      setEndDate("");
      setDays("");
    },
    onError: fail,
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" | "cancel" }) =>
      apiRequest("POST", `/api/companies/${companyId}/payroll/leave-requests/${id}/decision`, {
        decision,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reqKey });
      if (employeeId) {
        queryClient.invalidateQueries({
          queryKey: [`/api/employees/${employeeId}/leave-balances`],
        });
      }
    },
    onError: fail,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{tx("hr.newLeaveRequest")}</CardTitle>
          <CardDescription>{tx("hr.leaveHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label>{tx("hr.employee")}</Label>
            <Select value={employeeId || undefined} onValueChange={setEmployeeId}>
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
          <div className="space-y-1">
            <Label>{tx("hr.leaveType")}</Label>
            <Select value={leaveTypeId || undefined} onValueChange={setLeaveTypeId}>
              <SelectTrigger>
                <SelectValue placeholder={tx("hr.select")} />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {name(t.name_en, t.name_ar)} · {tx(t.is_paid ? "hr.paid" : "hr.unpaid")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="leave-days">{tx("hr.leaveDaysOptional")}</Label>
            <Input
              id="leave-days"
              inputMode="decimal"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="leave-start">{tx("hr.startDate")}</Label>
            <Input
              id="leave-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="leave-end">{tx("hr.endDate")}</Label>
            <Input
              id="leave-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => create.mutate()}
              disabled={!employeeId || !leaveTypeId || !startDate || !endDate || create.isPending}
            >
              <Plus className="me-2 h-4 w-4" />
              {tx("hr.requestLeave")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {employeeId && balances.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{tx("hr.leaveBalances")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {balances.map((b) => (
              <div key={b.leaveTypeId} className="rounded border p-3">
                <div className="font-medium">{name(b.nameEn, b.nameAr)}</div>
                <div className="text-sm text-muted-foreground">
                  {tx("hr.balanceLine", {
                    accrued: b.accruedDays,
                    taken: b.takenDays,
                    pending: b.pendingDays,
                    balance: b.balanceDays,
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tx("hr.leaveRequests")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {requests.length === 0 ? (
            <p className="text-muted-foreground">{tx("hr.noLeaveRequests")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tx("hr.employee")}</TableHead>
                  <TableHead>{tx("hr.leaveType")}</TableHead>
                  <TableHead>{tx("hr.dates")}</TableHead>
                  <TableHead>{tx("hr.days")}</TableHead>
                  <TableHead>{tx("hr.statusLabel")}</TableHead>
                  <TableHead className="text-end">{tx("hr.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.employee_name}</TableCell>
                    <TableCell>{name(r.leave_name_en, r.leave_name_ar)}</TableCell>
                    <TableCell>
                      {dayOnly(r.start_date)} → {dayOnly(r.end_date)}
                    </TableCell>
                    <TableCell>{r.days}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-end space-x-1 rtl:space-x-reverse">
                      {r.status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => decide.mutate({ id: r.id, decision: "approve" })}
                          >
                            <Check className="me-1 h-4 w-4" />
                            {tx("hr.approve")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => decide.mutate({ id: r.id, decision: "reject" })}
                          >
                            <X className="me-1 h-4 w-4" />
                            {tx("hr.reject")}
                          </Button>
                        </>
                      )}
                      {r.status === "approved" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => decide.mutate({ id: r.id, decision: "cancel" })}
                        >
                          {tx("hr.cancelLeave")}
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
    </div>
  );
}
