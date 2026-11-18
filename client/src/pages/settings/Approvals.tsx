import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";
import { formatMoneyText } from "@/lib/format-money";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { COMPANY_ROLE_LABELS, type CompanyRole } from "@shared/permissions";

/*
 * Settings › Approvals (WQ7, 12.3). Over the existing server rules: approval_rules
 * (server/services/approval-rules.service.ts) for bills, purchase orders and expense claims —
 * amount bands, the approver role and the step — and the journal maker-checker threshold
 * (ledger_settings.manual_approval_threshold, server/routes/journal.routes.ts). Every rule shown
 * here is enforced by the server when the document is approved or posted; the maker can never
 * approve their own document (except a one-person company that allows it, below).
 */

/** Document types whose approval the server routes through approval rules today. */
const RULE_DOC_TYPES = ["bill", "purchase_order", "expense_claim"] as const;
type RuleDocType = (typeof RULE_DOC_TYPES)[number];

/** Roles that can be named as the approver of a step (the owner can always approve). */
const APPROVER_ROLES: CompanyRole[] = ["approver", "accountant", "admin", "owner"];

interface ApprovalRule {
  id: string;
  name: string;
  document_type: string;
  min_amount: string;
  max_amount: string | null;
  step_order: number;
  required_permission: string;
  required_role: string | null;
  is_active: boolean;
}

interface RulesResponse {
  rules: ApprovalRule[];
  allowSingleMemberSelfApproval: boolean;
}

function RuleForm({
  docType,
  companyId,
  disabled,
}: {
  docType: RuleDocType;
  companyId: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [role, setRole] = useState<CompanyRole>("approver");
  const [step, setStep] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/approval-rules`, {
        name: formatMessage(translateNow("settingsPages.approvalsRuleName"), {
          doc: translateNow(`settingsPages.approvalsDoc_${docType}`),
          step,
        }),
        document_type: docType,
        min_amount: min || "0",
        max_amount: max ? max : null,
        step_order: Number(step),
        required_permission: "documents.approve",
        required_role: role,
      }),
    onSuccess: () => {
      setMin("");
      setMax("");
      setError(null);
      toast({ title: translateNow("settingsPages.approvalsRuleAdded") });
      void queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "approval-rules"],
      });
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (max && min && Number(max) < Number(min)) {
      setError(t["settingsPages.approvalsMaxBelowMin"]);
      return;
    }
    create.mutate();
  };

  const id = (f: string) => `approval-${docType}-${f}`;
  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-lg border border-dashed border-border p-4 sm:grid-cols-[1fr_1fr_1.2fr_0.7fr_auto] sm:items-end"
      data-testid={`approval-rule-form-${docType}`}
    >
      <div className="space-y-1.5">
        <Label htmlFor={id("min")}>{t["settingsPages.approvalsFrom"]}</Label>
        <Input
          id={id("min")}
          inputMode="decimal"
          dir="ltr"
          className="text-end tabular-nums"
          placeholder="0.00"
          value={min}
          onChange={(e) => setMin(e.target.value.replace(/[^0-9.]/g, ""))}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("max")}>{t["settingsPages.approvalsTo"]}</Label>
        <Input
          id={id("max")}
          inputMode="decimal"
          dir="ltr"
          className="text-end tabular-nums"
          placeholder={t["settingsPages.approvalsNoUpperLimit"]}
          value={max}
          onChange={(e) => setMax(e.target.value.replace(/[^0-9.]/g, ""))}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("role")}>{t["settingsPages.approvalsApprover"]}</Label>
        <Select value={role} onValueChange={(v) => setRole(v as CompanyRole)} disabled={disabled}>
          <SelectTrigger id={id("role")} data-testid={`approval-role-${docType}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPROVER_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                <RoleLabel role={r} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("step")}>{t["settingsPages.approvalsStep"]}</Label>
        <Select value={step} onValueChange={setStep} disabled={disabled}>
          <SelectTrigger id={id("step")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["1", "2", "3"].map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="submit"
        variant="outline"
        disabled={disabled || create.isPending}
        data-testid={`approval-rule-add-${docType}`}
      >
        {create.isPending ? (
          <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Plus className="me-2 h-4 w-4" aria-hidden />
        )}
        {t["settingsPages.approvalsAddRule"]}
      </Button>
      {error ? (
        <p role="alert" className="text-small text-danger sm:col-span-5">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function RoleLabel({ role }: { role: string }) {
  const { locale } = useTranslation();
  const labels = COMPANY_ROLE_LABELS[role as CompanyRole];
  return <>{labels ? (locale === "ar" ? labels.ar : labels.en) : role}</>;
}

function JournalThreshold({ companyId, disabled }: { companyId: string; disabled: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const settings = useQuery<{ manualApprovalThreshold: string | number | null }>({
    queryKey: ["/api/companies", companyId, "journal", "settings"],
  });
  const current = settings.data?.manualApprovalThreshold;
  const [value, setValue] = useState<string | null>(null);
  const shown = value ?? (current === null || current === undefined ? "" : String(current));
  const save = useMutation({
    mutationFn: (threshold: string | null) =>
      apiRequest("PUT", `/api/companies/${companyId}/journal/settings`, {
        manualApprovalThreshold: threshold,
      }),
    onSuccess: () => {
      setValue(null);
      toast({ title: translateNow("settingsPages.approvalsSaved") });
      void queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "journal", "settings"],
      });
    },
    onError: (e: Error) =>
      toast({ title: translateNow("toasts.error"), description: e.message, variant: "destructive" }),
  });
  const on = current !== null && current !== undefined;
  return (
    <Card data-testid="approvals-journal">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-h4">{t["settingsPages.approvalsDoc_journal"]}</CardTitle>
            <CardDescription>{t["settingsPages.approvalsJournalHelp"]}</CardDescription>
          </div>
          <Badge dot variant={on ? "success" : "neutral"}>
            {on ? t["settingsPages.approvalsOn"] : t["settingsPages.approvalsOff"]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(shown.trim() === "" ? null : shown.trim());
          }}
        >
          <div className="min-w-48 flex-1 space-y-1.5 sm:max-w-xs">
            <Label htmlFor="journal-threshold">{t["settingsPages.approvalsJournalAbove"]}</Label>
            <Input
              id="journal-threshold"
              inputMode="decimal"
              dir="ltr"
              className="text-end tabular-nums"
              placeholder={t["settingsPages.approvalsJournalOffPlaceholder"]}
              value={shown}
              onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
              disabled={disabled}
              data-testid="input-journal-threshold"
            />
          </div>
          <Button type="submit" disabled={disabled || save.isPending} data-testid="button-save-journal-threshold">
            {t["settingsPages.approvalsSave"]}
          </Button>
          {on ? (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || save.isPending}
              onClick={() => save.mutate(null)}
            >
              {t["settingsPages.approvalsTurnOff"]}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

export default function ApprovalsSettings() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const { can } = useCompanyPermission();
  const canManage = can("settings.company");

  const rules = useQuery<RulesResponse>({
    queryKey: ["/api/companies", companyId, "approval-rules"],
    enabled: !!companyId,
  });

  const remove = useMutation({
    mutationFn: (ruleId: string) =>
      apiRequest("DELETE", `/api/companies/${companyId}/approval-rules/${ruleId}`),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "approval-rules"],
      }),
    onError: (e: Error) =>
      toast({ title: translateNow("toasts.error"), description: e.message, variant: "destructive" }),
  });

  const selfApproval = useMutation({
    mutationFn: (allow: boolean) =>
      apiRequest("PUT", `/api/companies/${companyId}/approval-settings`, {
        allow_single_member_self_approval: allow,
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "approval-rules"],
      }),
  });

  const money = (v: string | null) =>
    v === null ? "" : formatMoneyText(Number(v), "AED", locale, { fractionDigits: 2 });

  return (
    <SettingsLayout>
      <div className="space-y-6">
        <PageHeader
          eyebrow={t["pages.companyProfileEyebrow"]}
          title={t["settingsPages.approvalsTitle"]}
          description={t["settingsPages.approvalsDescription"]}
        />
        {!canManage ? (
          <p className="text-small text-muted-foreground" data-testid="approvals-readonly">
            {t["settingsPages.approvalsReadOnly"]}
          </p>
        ) : null}

        {companyId ? <JournalThreshold companyId={companyId} disabled={!canManage} /> : null}

        {RULE_DOC_TYPES.map((docType) => {
          const list = (rules.data?.rules ?? [])
            .filter((r) => r.document_type === docType)
            .sort((a, b) => a.step_order - b.step_order || Number(a.min_amount) - Number(b.min_amount));
          return (
            <Card key={docType} data-testid={`approvals-${docType}`}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-h4">
                      {t[`settingsPages.approvalsDoc_${docType}`]}
                    </CardTitle>
                    <CardDescription>{t[`settingsPages.approvalsDocHelp_${docType}`]}</CardDescription>
                  </div>
                  <Badge dot variant={list.length ? "success" : "neutral"}>
                    {list.length
                      ? formatMessage(t["settingsPages.approvalsRuleCount"], { count: list.length })
                      : t["settingsPages.approvalsOff"]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {list.length ? (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {list.map((rule) => (
                      <li
                        key={rule.id}
                        className="flex flex-wrap items-center gap-3 px-4 py-3 text-small"
                        data-testid={`approval-rule-${rule.id}`}
                      >
                        <Badge variant="outline">
                          {formatMessage(t["settingsPages.approvalsStepN"], { n: rule.step_order })}
                        </Badge>
                        <span className="min-w-0 flex-1">
                          <span className="tabular-nums">
                            {rule.max_amount === null
                              ? formatMessage(t["settingsPages.approvalsBandFrom"], {
                                  min: money(rule.min_amount),
                                })
                              : formatMessage(t["settingsPages.approvalsBandRange"], {
                                  min: money(rule.min_amount),
                                  max: money(rule.max_amount),
                                })}
                          </span>
                          <span className="text-muted-foreground">
                            {" · "}
                            {t["settingsPages.approvalsApprovedBy"]}{" "}
                            <RoleLabel role={rule.required_role ?? "approver"} />
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => remove.mutate(rule.id)}
                          disabled={!canManage || remove.isPending}
                          aria-label={t["settingsPages.approvalsRemoveRule"]}
                          data-testid={`approval-rule-remove-${rule.id}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-small text-muted-foreground">
                    {t["settingsPages.approvalsNoRules"]}
                  </p>
                )}
                {companyId && canManage ? (
                  <RuleForm docType={docType} companyId={companyId} disabled={!canManage} />
                ) : null}
              </CardContent>
            </Card>
          );
        })}

        <Card data-testid="approvals-self">
          <CardHeader>
            <CardTitle className="text-h4">{t["settingsPages.approvalsSelfTitle"]}</CardTitle>
            <CardDescription>{t["settingsPages.approvalsSelfHelp"]}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <Label htmlFor="self-approval">{t["settingsPages.approvalsSelfLabel"]}</Label>
            <Switch
              id="self-approval"
              checked={rules.data?.allowSingleMemberSelfApproval ?? true}
              disabled={!canManage || selfApproval.isPending}
              onCheckedChange={(v) => selfApproval.mutate(v)}
              data-testid="switch-self-approval"
            />
          </CardContent>
        </Card>
      </div>
    </SettingsLayout>
  );
}
