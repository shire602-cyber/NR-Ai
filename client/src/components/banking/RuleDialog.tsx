import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BankAccount, LedgerAccount, ReconciliationRule, RuleDirection, RuleMatchField, RuleMatchType, RuleSplitLine } from "@/lib/banking-api-types";
import { messages } from "./RuleDialog.i18n";
import { messages as common } from "./BankingCommon.i18n";
import { bankingErrorText } from "./banking-common";
import { RuleSplitEditor } from "./RuleSplitEditor";
import { splitIssues } from "./rule-split";

interface FormState {
  name: string;
  priority: string;
  matchField: RuleMatchField;
  matchType: RuleMatchType;
  matchValue: string;
  direction: RuleDirection;
  bankAccountId: string;
  amountMin: string;
  amountMax: string;
  splitLines: RuleSplitLine[];
  vat: boolean;
  category: string;
  memo: string;
  isActive: boolean;
}

const blank = (): FormState => ({
  name: "",
  priority: "0",
  matchField: "description",
  matchType: "contains",
  matchValue: "",
  direction: "any",
  bankAccountId: "",
  amountMin: "",
  amountMax: "",
  splitLines: [{ accountId: "", percent: 100 }],
  vat: false,
  category: "",
  memo: "",
  isActive: true,
});

const fromRule = (r: ReconciliationRule): FormState => ({
  name: r.name,
  priority: String(r.priority ?? 0),
  matchField: r.matchField,
  matchType: (r.matchType as string) === "exact" ? "equals" : r.matchType,
  matchValue: r.matchValue,
  direction: r.direction ?? "any",
  bankAccountId: r.bankAccountId ?? "",
  amountMin: r.amountMin == null ? "" : String(r.amountMin),
  amountMax: r.amountMax == null ? "" : String(r.amountMax),
  splitLines: Array.isArray(r.splitLines) && r.splitLines.length > 0 ? r.splitLines.map((l) => ({ ...l, percent: Number(l.percent) })) : [{ accountId: "", percent: 100 }],
  vat: Number(r.vatRate ?? 0) > 0,
  category: r.category ?? "",
  memo: r.memo ?? "",
  isActive: r.isActive ?? true,
});

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  rule: ReconciliationRule | null;
  accounts: LedgerAccount[];
  bankAccounts: BankAccount[];
}

export function RuleDialog({ open, onOpenChange, companyId, rule, accounts, bankAccounts }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(blank);

  useEffect(() => {
    if (open) setForm(rule ? fromRule(rule) : blank());
  }, [open, rule]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const vatAllowed = form.direction !== "inflow";
  const splitOk = splitIssues(form.splitLines).length === 0;
  const valid = form.name.trim() !== "" && form.matchValue.trim() !== "" && splitOk;

  const save = useMutation({
    mutationFn: () => {
      const num = (t: string) => (t.trim() === "" ? null : Number(t));
      const body = {
        name: form.name.trim(),
        matchField: form.matchField,
        matchType: form.matchType,
        matchValue: form.matchValue.trim(),
        direction: form.direction,
        bankAccountId: form.bankAccountId || null,
        amountMin: num(form.amountMin),
        amountMax: num(form.amountMax),
        splitLines: form.splitLines.map((l) => ({ accountId: l.accountId, percent: l.percent, ...(l.description ? { description: l.description } : {}) })),
        vatRate: vatAllowed && form.vat ? 5 : 0,
        priority: Number(form.priority) || 0,
        isActive: form.isActive,
        category: form.category.trim() || null,
        memo: form.memo.trim() || null,
      };
      return rule
        ? apiRequest("PUT", `/api/reconciliation-rules/${rule.id}`, body)
        : apiRequest("POST", `/api/companies/${companyId}/reconciliation-rules`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "reconciliation-rules"] });
      toast({ title: rule ? tr("updated") : tr("created") });
      onOpenChange(false);
    },
    onError: (err: unknown) => toast({ variant: "destructive", title: tr("saveFailed"), description: bankingErrorText(trc, err, locale) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="rule-dialog">
        <DialogHeader>
          <DialogTitle>{rule ? tr("editTitle") : tr("createTitle")}</DialogTitle>
          <DialogDescription>{tr("description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-1">
              <Label htmlFor="rule-name">{tr("name")}</Label>
              <Input id="rule-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={tr("namePlaceholder")} maxLength={120} dir="auto" data-testid="input-rule-name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-priority">{tr("priority")}</Label>
              <Input id="rule-priority" type="number" min={0} max={1000} value={form.priority} onChange={(e) => set("priority", e.target.value)} dir="ltr" className="text-start" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">{tr("priorityHint")}</p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>{tr("matchField")}</Label>
              <Select value={form.matchField} onValueChange={(v) => set("matchField", v as RuleMatchField)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="description">{tr("fieldDescription")}</SelectItem>
                  <SelectItem value="reference">{tr("fieldReference")}</SelectItem>
                  <SelectItem value="amount">{tr("fieldAmount")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{tr("matchType")}</Label>
              <Select value={form.matchType} onValueChange={(v) => set("matchType", v as RuleMatchType)}>
                <SelectTrigger data-testid="select-match-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">{tr("typeContains")}</SelectItem>
                  <SelectItem value="equals">{tr("typeEquals")}</SelectItem>
                  <SelectItem value="starts_with">{tr("typeStartsWith")}</SelectItem>
                  <SelectItem value="regex">{tr("typeRegex")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-value">{tr("matchValue")}</Label>
              <Input id="rule-value" value={form.matchValue} onChange={(e) => set("matchValue", e.target.value)} placeholder={tr("matchValuePlaceholder")} maxLength={200} dir="auto" data-testid="input-rule-value" />
            </div>
          </div>
          {form.matchType === "regex" && <p className="text-xs text-muted-foreground -mt-2">{tr("regexHint")}</p>}
          {form.matchField === "amount" && <p className="text-xs text-muted-foreground -mt-2">{tr("matchValueAmountHint")}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{tr("direction")}</Label>
              <Select value={form.direction} onValueChange={(v) => set("direction", v as RuleDirection)}>
                <SelectTrigger data-testid="select-rule-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{tr("dirAny")}</SelectItem>
                  <SelectItem value="inflow">{tr("dirInflow")}</SelectItem>
                  <SelectItem value="outflow">{tr("dirOutflow")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{tr("bankAccount")}</Label>
              <Select value={form.bankAccountId || "any"} onValueChange={(v) => set("bankAccountId", v === "any" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{tr("anyAccount")}</SelectItem>
                  {bankAccounts.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>{tr("amountRange")}</Label>
            <div className="grid grid-cols-2 gap-3">
              <Input inputMode="decimal" placeholder={tr("amountMin")} aria-label={tr("amountMin")} value={form.amountMin} onChange={(e) => set("amountMin", e.target.value)} dir="ltr" className="text-start" />
              <Input inputMode="decimal" placeholder={tr("amountMax")} aria-label={tr("amountMax")} value={form.amountMax} onChange={(e) => set("amountMax", e.target.value)} dir="ltr" className="text-start" />
            </div>
          </div>

          <RuleSplitEditor lines={form.splitLines} onChange={(l) => set("splitLines", l)} accounts={accounts} vatRate={vatAllowed && form.vat ? 5 : 0} direction={form.direction} />

          <div className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="rule-vat" className="text-sm font-medium">
                {tr("vatTitle")}
              </Label>
              <p className="text-xs text-muted-foreground">{vatAllowed ? tr("vatHint") : tr("vatInflowNote")}</p>
            </div>
            <Switch id="rule-vat" checked={vatAllowed && form.vat} disabled={!vatAllowed} onCheckedChange={(v) => set("vat", v)} data-testid="switch-rule-vat" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="rule-category">{tr("category")}</Label>
              <Input id="rule-category" value={form.category} onChange={(e) => set("category", e.target.value)} maxLength={120} dir="auto" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-memo">{tr("memo")}</Label>
              <Input id="rule-memo" value={form.memo} onChange={(e) => set("memo", e.target.value)} maxLength={500} dir="auto" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="rule-active" className="text-sm font-medium">
                {tr("active")}
              </Label>
              <p className="text-xs text-muted-foreground">{tr("activeHint")}</p>
            </div>
            <Switch id="rule-active" checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tr("cancel")}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending} title={!splitOk ? tr("invalidSplit") : undefined} data-testid="button-save-rule">
              {save.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              {save.isPending ? tr("saving") : tr("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
