import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { APPROVAL_DOCUMENT_TYPES, describeRuleRoles, type ApprovalDocumentType, type ApprovalRule, type ApproverRole } from "@/lib/purchasing-hr";
import { messages } from "@/pages/Approvals.i18n";

const ROLES: ApproverRole[] = ["accountant", "cfo", "owner"];

type Tr = ReturnType<typeof messages.useT>;

export function documentTypeLabel(tr: Tr, type: ApprovalDocumentType): string {
  switch (type) {
    case "bill":
      return tr("typeBill");
    case "expense_claim":
      return tr("typeExpenseClaim");
    case "purchase_order":
      return tr("typePurchaseOrder");
    case "payroll_run":
      return tr("typePayrollRun");
    case "manual_journal":
      return tr("typeManualJournal");
    case "final_settlement":
      return tr("typeFinalSettlement");
  }
}

export function roleLabel(tr: Tr, role: string): string {
  return role === "accountant" ? tr("roleAccountant") : role === "cfo" ? tr("roleCfo") : role === "owner" ? tr("roleOwner") : role;
}

interface RuleDraft {
  id: string | null;
  documentType: ApprovalDocumentType;
  name: string;
  threshold: string;
  roles: ApproverRole[];
}

const blankDraft = (): RuleDraft => ({ id: null, documentType: "bill", name: "", threshold: "5000", roles: ["accountant"] });

interface Props {
  companyId: string;
  isOwner: boolean;
}

/** The company's approval rules: everyone sees them, only the owner changes them. */
export function ApprovalRulesPanel({ companyId, isOwner }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const key = ["/api/companies", companyId, "approval-rules"];

  const { data: rules = [], isLoading } = useQuery<ApprovalRule[]>({ queryKey: key, enabled: !!companyId });

  const save = useMutation({
    mutationFn: (d: RuleDraft) => {
      const body = { name: d.name.trim(), thresholdAed: Number(d.threshold), approverRoles: d.roles };
      return d.id
        ? apiRequest("PATCH", `/api/approval-rules/${d.id}`, body)
        : apiRequest("POST", `/api/companies/${companyId}/approval-rules`, { ...body, documentType: d.documentType });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "approvals"] });
      toast({ title: tr("ruleSaved") });
      setDraft(null);
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("ruleSaveFailed"), description: error?.message }),
  });

  const setActive = useMutation({
    mutationFn: (rule: ApprovalRule) =>
      rule.isActive ? apiRequest("DELETE", `/api/approval-rules/${rule.id}`) : apiRequest("PATCH", `/api/approval-rules/${rule.id}`, { isActive: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "approvals"] });
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("ruleStateFailed"), description: error?.message }),
  });

  const submit = () => {
    if (!draft) return;
    if (!draft.name.trim()) return setProblem(tr("ruleNameRequired"));
    const threshold = Number(draft.threshold);
    if (draft.threshold.trim() === "" || !Number.isFinite(threshold) || threshold < 0) return setProblem(tr("ruleThresholdInvalid"));
    setProblem(null);
    save.mutate(draft);
  };

  const openDraft = (next: RuleDraft) => {
    setProblem(null);
    setDraft(next);
  };

  return (
    <div className="space-y-4" data-testid="panel-approval-rules">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold">{tr("rulesTitle")}</h2>
          <p className="text-sm text-muted-foreground">{tr("rulesBody")}</p>
          {!isOwner && <p className="mt-1 text-sm text-muted-foreground" data-testid="text-rules-owner-only">{tr("ownerOnly")}</p>}
        </div>
        {isOwner && (
          <Button onClick={() => openDraft(blankDraft())} data-testid="button-new-rule">
            <Plus className="h-4 w-4 me-2" />
            {tr("newRule")}
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-rules-empty">{tr("rulesEmpty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("colName")}</TableHead>
                <TableHead>{tr("colType")}</TableHead>
                <TableHead className="text-end">{tr("colThreshold")}</TableHead>
                <TableHead>{tr("colApprovers")}</TableHead>
                <TableHead>{tr("colActive")}</TableHead>
                {isOwner && <TableHead className="text-end">{tr("colActions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id} data-testid={`row-rule-${rule.id}`}>
                  <TableCell className="font-medium">{rule.name}</TableCell>
                  <TableCell>{documentTypeLabel(tr, rule.documentType)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatCurrency(Number(rule.thresholdAed), "AED", locale)}</TableCell>
                  <TableCell>{describeRuleRoles(rule.approverRoles, (r) => roleLabel(tr, r), tr("then"))}</TableCell>
                  <TableCell>
                    <StatusBadge tone={rule.isActive ? "success" : "neutral"}>{rule.isActive ? tr("activeYes") : tr("activeNo")}</StatusBadge>
                  </TableCell>
                  {isOwner && (
                    <TableCell className="text-end space-x-2 rtl:space-x-reverse">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          openDraft({ id: rule.id, documentType: rule.documentType, name: rule.name, threshold: String(Number(rule.thresholdAed)), roles: rule.approverRoles })
                        }
                        data-testid={`button-edit-rule-${rule.id}`}
                      >
                        {tr("editRule")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setActive.mutate(rule)} disabled={setActive.isPending} data-testid={`button-toggle-rule-${rule.id}`}>
                        {rule.isActive ? tr("deactivate") : tr("activate")}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{draft?.id ? tr("ruleDialogEdit") : tr("ruleDialogNew")}</DialogTitle>
            <DialogDescription>{tr("stepsHint")}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>{tr("filterType")}</Label>
                <Select value={draft.documentType} onValueChange={(v) => setDraft({ ...draft, documentType: v as ApprovalDocumentType })} disabled={!!draft.id}>
                  <SelectTrigger data-testid="select-rule-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPROVAL_DOCUMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {documentTypeLabel(tr, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-name">{tr("ruleName")}</Label>
                <Input id="rule-name" value={draft.name} placeholder={tr("ruleNamePlaceholder")} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="input-rule-name" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-threshold">{tr("ruleThreshold")}</Label>
                <Input id="rule-threshold" type="number" min={0} step="0.01" dir="ltr" value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: e.target.value })} data-testid="input-rule-threshold" />
              </div>
              <div className="space-y-1">
                <Label>{tr("ruleSteps")}</Label>
                <Select
                  value={String(draft.roles.length)}
                  onValueChange={(v) => setDraft({ ...draft, roles: v === "2" ? [draft.roles[0], draft.roles[1] ?? "owner"] : [draft.roles[0]] })}
                >
                  <SelectTrigger data-testid="select-rule-steps">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">{tr("ruleOneStep")}</SelectItem>
                    <SelectItem value="2">{tr("ruleTwoSteps")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draft.roles.map((role, index) => (
                <div className="space-y-1" key={index}>
                  <Label>{tr("ruleStepRole", { step: index + 1 })}</Label>
                  <Select value={role} onValueChange={(v) => setDraft({ ...draft, roles: draft.roles.map((r, i) => (i === index ? (v as ApproverRole) : r)) })}>
                    <SelectTrigger data-testid={`select-rule-role-${index + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {roleLabel(tr, r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {tr("cancel")}
            </Button>
            <Button onClick={submit} disabled={save.isPending} data-testid="button-save-rule">
              {save.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  {tr("saving")}
                </>
              ) : (
                tr("save")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
