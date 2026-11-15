import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Archive, Edit, Plus, Trash2, UserX } from "lucide-react";
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
import { dayOnly, errorMessage, useHr, type Employee } from "./shared";
import { StatusBadge } from "./StatusBadge";

type FormState = Record<string, string>;

const TEXT_FIELDS: Array<{ key: string; label: string; type?: string; col?: keyof Employee }> = [
  { key: "fullName", label: "hr.field.fullName", col: "full_name" },
  { key: "fullNameAr", label: "hr.field.fullNameAr", col: "full_name_ar" },
  { key: "employeeNumber", label: "hr.field.employeeNumber", col: "employee_number" },
  { key: "nationality", label: "hr.field.nationality", col: "nationality" },
  { key: "email", label: "hr.field.email", type: "email", col: "email" },
  { key: "emiratesId", label: "hr.field.emiratesId", col: "emirates_id" },
  {
    key: "emiratesIdExpiry",
    label: "hr.field.emiratesIdExpiry",
    type: "date",
    col: "emirates_id_expiry",
  },
  { key: "passportNumber", label: "hr.field.passportNumber", col: "passport_number" },
  { key: "passportExpiry", label: "hr.field.passportExpiry", type: "date", col: "passport_expiry" },
  { key: "visaNumber", label: "hr.field.visaNumber", col: "visa_number" },
  { key: "visaExpiry", label: "hr.field.visaExpiry", type: "date", col: "visa_expiry" },
  { key: "laborCardNumber", label: "hr.field.laborCardNumber", col: "labor_card_number" },
  {
    key: "laborCardExpiry",
    label: "hr.field.laborCardExpiry",
    type: "date",
    col: "labor_card_expiry",
  },
  { key: "molPersonId", label: "hr.field.molPersonId", col: "mol_person_id" },
  { key: "bankName", label: "hr.field.bankName", col: "bank_name" },
  { key: "iban", label: "hr.field.iban", col: "iban" },
  { key: "routingCode", label: "hr.field.routingCode", col: "routing_code" },
  { key: "department", label: "hr.field.department", col: "department" },
  { key: "designation", label: "hr.field.designation", col: "designation" },
  { key: "joinDate", label: "hr.field.joinDate", type: "date", col: "join_date" },
  { key: "contractStart", label: "hr.field.contractStart", type: "date", col: "contract_start" },
  { key: "contractEnd", label: "hr.field.contractEnd", type: "date", col: "contract_end" },
  { key: "salaryCurrency", label: "hr.field.salaryCurrency", col: "salary_currency" },
  { key: "basicSalary", label: "hr.field.basicSalary", type: "number", col: "basic_salary" },
  {
    key: "housingAllowance",
    label: "hr.field.housingAllowance",
    type: "number",
    col: "housing_allowance",
  },
  {
    key: "transportAllowance",
    label: "hr.field.transportAllowance",
    type: "number",
    col: "transport_allowance",
  },
  {
    key: "otherAllowance",
    label: "hr.field.otherAllowance",
    type: "number",
    col: "other_allowance",
  },
];

const CONTRACT_TYPES = ["full_time", "part_time", "temporary", "flexible", "remote", "job_sharing"];
const DATE_KEYS = new Set(TEXT_FIELDS.filter((f) => f.type === "date").map((f) => f.key));

function toForm(emp: Employee | null): FormState {
  const out: FormState = { contractType: emp?.contract_type ?? "" };
  for (const f of TEXT_FIELDS) {
    const v = emp && f.col ? emp[f.col] : null;
    out[f.key] =
      v === null || v === undefined ? "" : DATE_KEYS.has(f.key) ? dayOnly(String(v)) : String(v);
  }
  if (!emp) out.salaryCurrency = "AED";
  return out;
}

export function EmployeesTab({ companyId }: { companyId: string }) {
  const { tx } = useHr();
  const { toast } = useToast();
  const key = [`/api/companies/${companyId}/employees`];
  const { data: employees = [], isLoading } = useQuery<Employee[]>({ queryKey: key });
  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(toForm(null));
  const [terminating, setTerminating] = useState<Employee | null>(null);
  const [termDate, setTermDate] = useState("");
  const [termReason, setTermReason] = useState("");
  const [search, setSearch] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const fail = (err: unknown) =>
    toast({ title: tx("hr.error"), description: errorMessage(err), variant: "destructive" });

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      for (const [k, v] of Object.entries(form)) {
        // Create: omit blanks. Update: "" clears the field.
        if (v !== "" || editing) body[k] = v;
      }
      return editing
        ? apiRequest("PATCH", `/api/employees/${editing.id}`, body)
        : apiRequest("POST", `/api/companies/${companyId}/employees`, body);
    },
    onSuccess: () => {
      refresh();
      setOpen(false);
      toast({ title: tx(editing ? "hr.employeeUpdated" : "hr.employeeCreated") });
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/employees/${id}`),
    onSuccess: () => {
      refresh();
      toast({ title: tx("hr.employeeDeleted") });
    },
    onError: fail,
  });

  const archive = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/employees/${id}/archive`, {}),
    onSuccess: () => {
      refresh();
      toast({ title: tx("hr.employeeArchived") });
    },
    onError: fail,
  });

  const terminate = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/employees/${terminating!.id}/terminate`, {
        terminationDate: termDate,
        reason: termReason,
      }),
    onSuccess: () => {
      refresh();
      setTerminating(null);
      toast({ title: tx("hr.employeeTerminated") });
    },
    onError: fail,
  });

  const filtered = employees.filter((e) => {
    const q = search.trim().toLowerCase();
    return (
      !q ||
      e.full_name.toLowerCase().includes(q) ||
      (e.employee_number ?? "").toLowerCase().includes(q) ||
      (e.department ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{tx("hr.tab.employees")}</CardTitle>
          <CardDescription>{tx("hr.employeesHint")}</CardDescription>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setForm(toForm(null));
            setOpen(true);
          }}
          data-testid="button-add-employee"
        >
          <Plus className="me-2 h-4 w-4" />
          {tx("hr.addEmployee")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          placeholder={tx("hr.searchEmployees")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {isLoading ? (
          <p className="text-muted-foreground">{tx("hr.loading")}</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground">{tx("hr.noEmployees")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tx("hr.field.fullName")}</TableHead>
                  <TableHead>{tx("hr.field.department")}</TableHead>
                  <TableHead>{tx("hr.field.nationality")}</TableHead>
                  <TableHead className="text-end">{tx("hr.totalSalary")}</TableHead>
                  <TableHead>{tx("hr.statusLabel")}</TableHead>
                  <TableHead className="text-end">{tx("hr.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className="font-medium">{e.full_name}</div>
                      {e.full_name_ar && (
                        <div className="text-xs text-muted-foreground">{e.full_name_ar}</div>
                      )}
                    </TableCell>
                    <TableCell>{e.department ?? "—"}</TableCell>
                    <TableCell>{e.nationality ?? "—"}</TableCell>
                    <TableCell className="text-end">
                      {formatCurrency(Number(e.total_salary), e.salary_currency ?? "AED")}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="text-end space-x-1 rtl:space-x-reverse">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={tx("hr.edit")}
                        disabled={e.status === "terminated"}
                        onClick={() => {
                          setEditing(e);
                          setForm(toForm(e));
                          setOpen(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={tx("hr.terminate")}
                        disabled={e.status === "terminated"}
                        onClick={() => {
                          setTerminating(e);
                          setTermDate(new Date().toISOString().slice(0, 10));
                          setTermReason("");
                        }}
                      >
                        <UserX className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={tx("hr.archive")}
                        onClick={() => archive.mutate(e.id)}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={tx("hr.delete")}
                        onClick={() => remove.mutate(e.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{tx("hr.deleteGuardHint")}</p>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tx(editing ? "hr.editEmployee" : "hr.addEmployee")}</DialogTitle>
            <DialogDescription>{tx("hr.employeeFormHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TEXT_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`emp-${f.key}`}>{tx(f.label)}</Label>
                <Input
                  id={`emp-${f.key}`}
                  type={f.type === "number" ? "text" : (f.type ?? "text")}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  value={form[f.key] ?? ""}
                  onChange={(ev) => setForm({ ...form, [f.key]: ev.target.value })}
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label>{tx("hr.field.contractType")}</Label>
              <Select
                value={form.contractType || undefined}
                onValueChange={(v) => setForm({ ...form, contractType: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tx("hr.select")} />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {tx(`hr.contract.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tx("hr.cancel")}
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !form.fullName}>
              {tx("hr.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!terminating} onOpenChange={(o) => !o && setTerminating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tx("hr.terminate")}</DialogTitle>
            <DialogDescription>{tx("hr.terminateHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="term-date">{tx("hr.terminationDate")}</Label>
              <Input
                id="term-date"
                type="date"
                value={termDate}
                onChange={(e) => setTermDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="term-reason">{tx("hr.reason")}</Label>
              <Input
                id="term-reason"
                value={termReason}
                onChange={(e) => setTermReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminating(null)}>
              {tx("hr.cancel")}
            </Button>
            <Button
              onClick={() => terminate.mutate()}
              disabled={!termDate || !termReason || terminate.isPending}
            >
              {tx("hr.terminate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
