import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { DatePicker } from "@/components/ui/date-picker";
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
import { Money } from "@/components/ui/money";
import {
  ErrorSummary,
  Field,
  FormActions,
  FormGrid,
  FormSection,
} from "@/components/ui/form-layout";
import { useFormGate } from "@/hooks/use-form-gate";
import { dayOnly, errorMessage, useHr, type Employee } from "./shared";
import { apiFieldErrors, type FieldMessages } from "@/lib/api-field-errors";
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
  {
    key: "openingGratuityProvision",
    label: "hr.field.openingGratuityProvisionAtGoLive",
    type: "number",
    col: "opening_gratuity_provision",
  },
  {
    key: "openingGratuityAsOf",
    label: "hr.field.openingGratuityAsOf",
    type: "date",
    col: "opening_gratuity_as_of",
  },
];

const FIELD_BY_KEY = new Map(TEXT_FIELDS.map((f) => [f.key, f]));
/** D5b: the employee form grouped into sections (every TEXT_FIELDS key appears once). */
const EMPLOYEE_SECTIONS: Array<{ title: string; keys: string[] }> = [
  {
    title: "forms.section.personal",
    keys: ["fullName", "fullNameAr", "employeeNumber", "nationality", "email"],
  },
  {
    title: "forms.employee.documents",
    keys: [
      "emiratesId",
      "emiratesIdExpiry",
      "passportNumber",
      "passportExpiry",
      "visaNumber",
      "visaExpiry",
      "laborCardNumber",
      "laborCardExpiry",
      "molPersonId",
    ],
  },
  {
    title: "forms.section.employment",
    keys: ["department", "designation", "joinDate", "contractType", "contractStart", "contractEnd"],
  },
  {
    title: "forms.section.pay",
    keys: [
      "salaryCurrency",
      "basicSalary",
      "housingAllowance",
      "transportAllowance",
      "otherAllowance",
      "pensionScheme",
      "openingGratuityProvision",
      "openingGratuityAsOf",
    ],
  },
  { title: "forms.section.wps", keys: ["bankName", "iban", "routingCode"] },
];
/** Latin identifiers and codes: LTR, tabular, start-aligned in Arabic. */
const LTR_KEYS = new Set([
  "employeeNumber",
  "email",
  "emiratesId",
  "passportNumber",
  "visaNumber",
  "laborCardNumber",
  "molPersonId",
  "iban",
  "routingCode",
  "salaryCurrency",
]);

const CONTRACT_TYPES = ["full_time", "part_time", "temporary", "flexible", "remote", "job_sharing"];
/** A4 (M11): "auto" = by nationality (GPSSA); "adpf" = Abu Dhabi Pension Fund member. */
const PENSION_SCHEME_OPTIONS = ["auto", "gpssa", "adpf"] as const;
const DATE_KEYS = new Set(TEXT_FIELDS.filter((f) => f.type === "date").map((f) => f.key));

function toForm(emp: Employee | null): FormState {
  const out: FormState = {
    contractType: emp?.contract_type ?? "",
    pensionScheme: (emp?.pension_scheme as string | null | undefined) ?? "",
  };
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
  // X4 (J3): field messages from the server (bad IBAN, duplicate Emirates ID, ...).
  const [serverErrors, setServerErrors] = useState<FieldMessages>({});
  const gate = useFormGate([
    { id: "emp-fullName", label: tx("hr.field.fullName"), invalid: !form.fullName },
  ]);
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
      setServerErrors({});
      toast({ title: tx(editing ? "hr.employeeUpdated" : "hr.employeeCreated") });
    },
    onError: (err: unknown) => {
      const fields = apiFieldErrors(err, (code, field) =>
        code === "EMPLOYEE_DUPLICATE" ? tx(`hr.duplicate.${field}`) : undefined
      );
      setServerErrors(fields);
      const names = Object.keys(fields)
        .map((k) => (FIELD_BY_KEY.get(k) ? tx(FIELD_BY_KEY.get(k)!.label) : k))
        .join(", ");
      toast({
        title: tx("hr.error"),
        description: names ? tx("hr.fixFields", { fields: names }) : errorMessage(err),
        variant: "destructive",
      });
    },
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
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
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
          <EmptyState size="sm" title={tx("hr.noEmployees")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tx("hr.field.fullName")}</TableHead>
                  <TableHead>{tx("hr.field.department")}</TableHead>
                  <TableHead>{tx("hr.field.nationality")}</TableHead>
                  <TableHead data-numeric>{tx("hr.totalSalary")}</TableHead>
                  <TableHead>{tx("hr.statusLabel")}</TableHead>
                  <TableHead data-numeric>{tx("hr.actions")}</TableHead>
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
                    <TableCell data-numeric>
                      <Money
                        amount={Number(e.total_salary)}
                        currency={e.salary_currency ?? "AED"}
                      />
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

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            gate.reset();
            setServerErrors({});
          }
        }}
      >
        <DialogContent size="lg" data-testid="dialog-employee-form">
          <DialogHeader>
            <DialogTitle>{tx(editing ? "hr.editEmployee" : "hr.addEmployee")}</DialogTitle>
            <DialogDescription>{tx("hr.employeeFormHint")}</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (save.isPending || !gate.attempt()) return;
              save.mutate();
            }}
          >
            <ErrorSummary items={gate.summary} />
            {EMPLOYEE_SECTIONS.map((section) => (
              <FormSection key={section.title} title={tx(section.title)}>
                <FormGrid>
                  {section.keys.map((k) => {
                    if (k === "pensionScheme") {
                      return (
                        <Field
                          key={k}
                          id="emp-pensionScheme"
                          label={tx("hr.field.pensionScheme")}
                          help={tx("hr.pensionSchemeHint")}
                        >
                          <Select
                            value={form.pensionScheme || "auto"}
                            onValueChange={(v) =>
                              setForm({ ...form, pensionScheme: v === "auto" ? "" : v })
                            }
                          >
                            <SelectTrigger id="emp-pensionScheme">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PENSION_SCHEME_OPTIONS.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {tx(`hr.pensionScheme.${c}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      );
                    }
                    if (k === "contractType") {
                      return (
                        <Field key={k} id="emp-contractType" label={tx("hr.field.contractType")}>
                          <Select
                            value={form.contractType || undefined}
                            onValueChange={(v) => setForm({ ...form, contractType: v })}
                          >
                            <SelectTrigger id="emp-contractType">
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
                        </Field>
                      );
                    }
                    const f = FIELD_BY_KEY.get(k)!;
                    return (
                      <Field
                        key={f.key}
                        id={`emp-${f.key}`}
                        label={tx(f.label)}
                        required={f.key === "fullName"}
                        error={gate.errorFor(`emp-${f.key}`) ?? serverErrors[f.key]}
                      >
                        <Input
                          type={f.type === "number" ? "text" : (f.type ?? "text")}
                          inputMode={f.type === "number" ? "decimal" : undefined}
                          ltr={LTR_KEYS.has(f.key)}
                          dir={
                            f.key === "fullNameAr"
                              ? "rtl"
                              : f.type === "date"
                                ? "ltr"
                                : LTR_KEYS.has(f.key)
                                  ? undefined
                                  : "auto"
                          }
                          value={form[f.key] ?? ""}
                          onChange={(ev) => {
                            setForm({ ...form, [f.key]: ev.target.value });
                            if (serverErrors[f.key]) {
                              const { [f.key]: _cleared, ...rest } = serverErrors;
                              setServerErrors(rest);
                            }
                          }}
                        />
                      </Field>
                    );
                  })}
                </FormGrid>
              </FormSection>
            ))}
            <FormActions sticky>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {tx("hr.cancel")}
              </Button>
              <Button type="submit" className="sm:min-w-32" disabled={save.isPending}>
                {tx("hr.save")}
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!terminating} onOpenChange={(o) => !o && setTerminating(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{tx("hr.terminate")}</DialogTitle>
            <DialogDescription>{tx("hr.terminateHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="term-date">{tx("hr.terminationDate")}</Label>
              <DatePicker
                id="term-date"
                value={termDate}
                onChange={(value) => setTermDate(value)}
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
