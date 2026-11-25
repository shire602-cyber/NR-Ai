import { translateNow } from "@/lib/i18n";
import { errorHeading } from "@/lib/error-heading";
import { useContext, useState } from "react";
import { TrialReadOnlyContext } from "@/lib/trial-access";
import { FileDrop } from "@/components/ui/file-drop";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format-date";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { FileSearch, Save, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorMessage, monthName, useHr, type PayrollRun } from "./shared";
import { apiFieldErrors, type FieldMessages } from "@/lib/api-field-errors";
import { StatusBadge } from "./StatusBadge";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";

interface WpsSettings {
  mohreEstablishmentId: string | null;
  wpsEmployerRoutingCode: string | null;
  wpsEmployerIban: string | null;
  wpsEmployerBankName: string | null;
  wpsAgentId: string | null;
}

const WPS_FIELDS: Array<[keyof WpsSettings, string]> = [
  ["mohreEstablishmentId", "hr.wps.establishmentId"],
  ["wpsEmployerRoutingCode", "hr.wps.routingCode"],
  ["wpsEmployerIban", "hr.wps.iban"],
  ["wpsEmployerBankName", "hr.wps.bankName"],
  ["wpsAgentId", "hr.wps.agentId"],
];

/** Company WPS / MOL settings. Also rendered in Company Settings. */
export function WpsSettingsCard({ companyId }: { companyId: string }) {
  const { tx } = useHr();
  const { toast } = useToast();
  const { gate, can } = useCompanyPermission();
  const key = [`/api/companies/${companyId}/payroll/wps-settings`];
  const { data } = useQuery<WpsSettings>({ queryKey: key });
  // Local edits layered over the saved values (no effect-driven state copy).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<FieldMessages>({});
  const value = (k: keyof WpsSettings) => edits[k] ?? data?.[k] ?? "";
  const save = useMutation({
    mutationFn: () =>
      apiRequest(
        "PUT",
        `/api/companies/${companyId}/payroll/wps-settings`,
        Object.fromEntries(WPS_FIELDS.map(([k]) => [k, value(k)]))
      ),
    onSuccess: () => {
      setEdits({});
      setFieldErrors({});
      queryClient.invalidateQueries({ queryKey: key });
      toast({ title: tx("hr.wps.saved") });
    },
    onError: (err) => {
      // X4 (J3): mark the field the server rejected (e.g. bad IBAN check digits).
      const fields = apiFieldErrors(err);
      setFieldErrors(fields);
      const names = WPS_FIELDS.filter(([k]) => fields[k])
        .map(([, label]) => tx(label))
        .join(", ");
      toast({
        title: names ? translateNow("common.errorHeading.fields") : errorHeading(err),
        description: names ? tx("hr.fixFields", { fields: names }) : errorMessage(err),
        variant: "destructive",
      });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx("hr.wps.settingsTitle")}</CardTitle>
        <CardDescription>{tx("hr.wps.settingsHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {WPS_FIELDS.map(([k, label]) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`wps-${k}`}>{tx(label)}</Label>
              <Input
                id={`wps-${k}`}
                value={value(k)}
                aria-invalid={fieldErrors[k] ? true : undefined}
                aria-describedby={fieldErrors[k] ? `wps-${k}-error` : undefined}
                onChange={(e) => {
                  setEdits({ ...edits, [k]: e.target.value });
                  if (fieldErrors[k]) setFieldErrors({ ...fieldErrors, [k]: "" });
                }}
              />
              {fieldErrors[k] && (
                <p id={`wps-${k}-error`} className="text-xs text-danger" role="alert">
                  {fieldErrors[k]}
                </p>
              )}
            </div>
          ))}
        </div>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          {...(can("settings.company") ? {} : gate("payroll.manage"))}
        >
          <Save className="me-2 h-4 w-4" />
          {tx("hr.save")}
        </Button>
      </CardContent>
    </Card>
  );
}

interface PayrollSettings {
  allowSingleOwnerApproval: boolean;
  adviserConfirmed: boolean;
  adviserConfirmedAt: string | null;
  adviserNote: string | null;
  legalParams: {
    pension: Record<
      string,
      { employeeRate: string; employerRate: string; base: string; confirmed: boolean }
    >;
    gratuity: {
      firstTierDaysPerYear: number;
      laterTierDaysPerYear: number;
      capMonthsOfBasic: number | null;
    };
    overtime: { normalMultiplier: string; nightOrRestDayMultiplier: string };
  };
}

function LegalSettingsCard({ companyId }: { companyId: string }) {
  const readOnly = useContext(TrialReadOnlyContext);
  const { tx } = useHr();
  const { toast } = useToast();
  const key = [`/api/companies/${companyId}/payroll/settings`];
  const { data } = useQuery<PayrollSettings>({ queryKey: key });
  const update = useMutation({
    mutationFn: (body: Partial<PayrollSettings>) =>
      apiRequest("PUT", `/api/companies/${companyId}/payroll/settings`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      toast({ title: tx("hr.settingsSaved") });
    },
    onError: (err) =>
      toast({ title: errorHeading(err), description: errorMessage(err), variant: "destructive" }),
  });
  if (!data) return null;
  const uae = data.legalParams.pension.AE;
  const adpf = data.legalParams.pension.ADPF;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx("hr.legalTitle")}</CardTitle>
        <CardDescription>{tx("hr.counselReviewNote")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!data.adviserConfirmed && (
          <div className="flex items-center gap-2 rounded border border-warning p-2">
            <ShieldAlert className="h-4 w-4" />
            {tx("hr.adviserNotConfirmed")}
          </div>
        )}
        <ul className="list-disc space-y-1 ps-5">
          <li>
            {tx("hr.legal.pension", {
              employee: uae.employeeRate,
              employer: uae.employerRate,
              base: uae.base,
            })}
          </li>
          {adpf && (
            <li>
              {tx("hr.legal.adpf", {
                employee: adpf.employeeRate,
                employer: adpf.employerRate,
                base: adpf.base,
              })}
            </li>
          )}
          <li>
            {tx("hr.legal.gratuity", {
              first: data.legalParams.gratuity.firstTierDaysPerYear,
              later: data.legalParams.gratuity.laterTierDaysPerYear,
              cap: data.legalParams.gratuity.capMonthsOfBasic ?? "—",
            })}
          </li>
          <li>
            {tx("hr.legal.overtime", {
              normal: data.legalParams.overtime.normalMultiplier,
              night: data.legalParams.overtime.nightOrRestDayMultiplier,
            })}
          </li>
        </ul>
        <div className="flex items-center justify-between rounded border p-3">
          <Label htmlFor="adviser-confirmed">{tx("hr.adviserConfirmed")}</Label>
          <Switch
            id="adviser-confirmed"
            disabled={readOnly || update.isPending}
            checked={data.adviserConfirmed}
            onCheckedChange={(v) => update.mutate({ adviserConfirmed: v })}
          />
        </div>
        <div className="flex items-center justify-between rounded border p-3">
          <Label htmlFor="single-owner">{tx("hr.allowSingleOwner")}</Label>
          <Switch
            id="single-owner"
            disabled={readOnly || update.isPending}
            checked={data.allowSingleOwnerApproval}
            onCheckedChange={(v) => update.mutate({ allowSingleOwnerApproval: v })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface ValidationResult {
  valid: boolean;
  errors: Array<{ line: number; field: string; message: string }>;
  edrs: unknown[];
}

interface ExpiryRow {
  employeeName: string;
  document: string;
  expiryDate: string;
  daysLeft: number;
}

export function WpsTab({ companyId }: { companyId: string }) {
  const readOnly = useContext(TrialReadOnlyContext);
  const { tx, locale } = useHr();
  const { toast } = useToast();
  const runsKey = [`/api/companies/${companyId}/payroll-runs`];
  const { data: runs = [] } = useQuery<PayrollRun[]>({ queryKey: runsKey });
  const {
    data: expiries = [],
    error: expiriesError,
    refetch: refetchExpiries,
  } = useQuery<ExpiryRow[]>({
    queryKey: [`/api/companies/${companyId}/payroll/expiries`],
  });
  const [content, setContent] = useState("");
  const [sifName, setSifName] = useState<string | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [runId, setRunId] = useState("");
  const [status, setStatus] = useState("submitted");
  const [notes, setNotes] = useState("");
  const withSif = runs.filter((r) => r.sif_file_content);
  const fail = (err: unknown) =>
    toast({ title: errorHeading(err), description: errorMessage(err), variant: "destructive" });

  const validate = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/payroll/sif/validate`, { content }),
    onSuccess: (d: ValidationResult) => setResult(d),
    onError: fail,
  });
  const setWps = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/payroll-runs/${runId}/wps-status`, {
        wpsStatus: status,
        ...(notes ? { notes } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runsKey });
      setNotes("");
      toast({ title: tx("hr.wps.statusSaved") });
    },
    onError: fail,
  });

  return (
    <div className="max-w-narrow space-y-6">
      <WpsSettingsCard companyId={companyId} />

      <Card>
        <CardHeader>
          <CardTitle>{tx("hr.wps.statusTitle")}</CardTitle>
          <CardDescription>{tx("hr.sifExternalNote")}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Select value={runId || undefined} onValueChange={setRunId}>
            <SelectTrigger>
              <SelectValue placeholder={tx("hr.selectRunWithSif")} />
            </SelectTrigger>
            <SelectContent>
              {withSif.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {monthName(r.period_month, locale)} {r.period_year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["submitted", "accepted", "rejected"].map((s) => (
                <SelectItem key={s} value={s}>
                  <StatusBadge status={s} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder={tx("hr.wps.notes")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Button disabled={readOnly || !runId || setWps.isPending} onClick={() => setWps.mutate()}>
            {tx("hr.save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tx("hr.wps.validatorTitle")}</CardTitle>
          <CardDescription>{tx("hr.wps.validatorHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <FileDrop
            id="wps-sif-file"
            accept=".sif,.SIF,.txt,.csv"
            value={sifName}
            onClear={() => {
              setSifName(null);
              setContent("");
            }}
            onFiles={async ([file]) => {
              if (!file) return;
              setSifName(file.name);
              setContent(await file.text());
            }}
          />
          <Textarea
            rows={6}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="tabular-nums text-xs"
          />
          <Button disabled={!content || validate.isPending} onClick={() => validate.mutate()}>
            <FileSearch className="me-2 h-4 w-4" />
            {tx("hr.wps.validate")}
          </Button>
          {result && (
            <div className="text-sm">
              {result.valid ? (
                <p className="text-success">{tx("hr.wps.valid", { count: result.edrs.length })}</p>
              ) : (
                <ul className="space-y-1">
                  {result.errors.map((er, i) => (
                    <li key={i}>
                      {tx("hr.wps.lineError", { line: er.line })}: {er.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tx("hr.expiriesTitle")}</CardTitle>
          <CardDescription>{tx("hr.expiriesHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {expiriesError ? (
            <LoadErrorState
              error={expiriesError}
              onRetry={() => void refetchExpiries()}
              testId="payroll-load-error"
            />
          ) : expiries.length === 0 ? (
            <EmptyState size="sm" title={tx("hr.noExpiries")} />
          ) : (
            <ul className="space-y-1 text-sm">
              {expiries.map((x, i) => (
                <li key={i}>
                  {x.employeeName} · {tx(`hr.doc.${x.document}`)} ·{" "}
                  {formatDate(x.expiryDate, locale)} · {tx("hr.daysLeft", { days: x.daysLeft })}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <LegalSettingsCard companyId={companyId} />
    </div>
  );
}
