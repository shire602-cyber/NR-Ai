import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatNumber } from "@/lib/format";
import { messages as common } from "@/components/banking/BankingCommon.i18n";
import { bankingErrorText } from "@/components/banking/banking-common";
import type { ForecastScenarioFields, SavedScenario } from "@/lib/banking-api-types";
import { messages } from "./ScenarioPanel.i18n";
import { DEFAULT_SCENARIO, MAX_ADJUSTMENTS, scenarioIssues, type ScenarioIssue } from "./chart-data";
import { isIsoDay } from "@/lib/statement-review";

const CUSTOM = "__custom";
const ISSUE_KEY: Record<ScenarioIssue, "issueReceipt" | "issuePayment" | "issueRate" | "issueDay" | "issueOneOff" | "issueLimit"> = {
  RECEIPT_DELAY_RANGE: "issueReceipt",
  PAYMENT_DELAY_RANGE: "issuePayment",
  COLLECTION_RATE_RANGE: "issueRate",
  PAYROLL_DAY_RANGE: "issueDay",
  ADJUSTMENT_INVALID: "issueOneOff",
  ADJUSTMENT_LIMIT: "issueLimit",
};

interface Props {
  companyId: string;
  scenarios: SavedScenario[];
  selectedId: string | null;
  value: ForecastScenarioFields;
  onChange: (value: ForecastScenarioFields) => void;
  onSelect: (id: string | null) => void;
}

export function ScenarioPanel({ companyId, scenarios, selectedId, value, onChange, onSelect }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [toDelete, setToDelete] = useState<SavedScenario | null>(null);
  const [oneOff, setOneOff] = useState({ date: "", label: "", amount: "" });

  const issues = scenarioIssues(value);
  const selected = scenarios.find((s) => s.id === selectedId) ?? null;
  const path = `/api/companies/${companyId}/cashflow/scenarios`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "cashflow", "scenarios"] });
  const fail = (title: string) => (err: unknown) => toast({ variant: "destructive", title, description: bankingErrorText(trc, err, locale) });
  const set = <K extends keyof ForecastScenarioFields>(k: K, v: ForecastScenarioFields[K]) => onChange({ ...value, [k]: v });
  const intValue = (text: string) => (text.trim() === "" || !Number.isFinite(Number(text)) ? 0 : Math.trunc(Number(text)));

  const create = useMutation({
    mutationFn: () => apiRequest("POST", path, { name: saveName.trim(), ...value }) as Promise<SavedScenario>,
    onSuccess: (row) => {
      refresh();
      setShowSave(false);
      setSaveName("");
      onSelect(row.id);
      toast({ title: tr("toastSaved") });
    },
    onError: fail(tr("toastFailed")),
  });
  const update = useMutation({
    mutationFn: (args: { id: string; body: Partial<ForecastScenarioFields> & { isDefault?: boolean } }) => apiRequest("PATCH", `${path}/${args.id}`, args.body),
    onSuccess: () => {
      refresh();
      toast({ title: tr("toastSaved") });
    },
    onError: fail(tr("toastFailed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `${path}/${id}`),
    onSuccess: () => {
      refresh();
      setToDelete(null);
      onSelect(null);
      toast({ title: tr("toastDeleted") });
    },
    onError: fail(tr("toastDeleteFailed")),
  });

  const addOneOff = () => {
    const amount = Number(oneOff.amount);
    if (!isIsoDay(oneOff.date) || !oneOff.label.trim() || !Number.isFinite(amount) || amount === 0) return;
    set("adjustments", [...value.adjustments, { date: oneOff.date, label: oneOff.label.trim(), amount }]);
    setOneOff({ date: "", label: "", amount: "" });
  };
  const oneOffReady = isIsoDay(oneOff.date) && oneOff.label.trim() !== "" && Number.isFinite(Number(oneOff.amount)) && Number(oneOff.amount) !== 0 && value.adjustments.length < MAX_ADJUSTMENTS;

  return (
    <Card data-testid="scenario-panel">
      <CardHeader>
        <CardTitle className="text-base">{tr("title")}</CardTitle>
        <CardDescription>{tr("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1">
          <Label>{tr("saved")}</Label>
          <Select
            value={selectedId ?? CUSTOM}
            onValueChange={(v) => {
              if (v === CUSTOM) onSelect(null);
              else {
                const s = scenarios.find((x) => x.id === v);
                if (s) {
                  onSelect(s.id);
                  onChange({ receiptDelayDays: s.receiptDelayDays, paymentDelayDays: s.paymentDelayDays, collectionRatePct: Number(s.collectionRatePct), includeRecurring: s.includeRecurring, includePayroll: s.includePayroll, payrollPayDay: s.payrollPayDay, adjustments: s.adjustments ?? [] });
                }
              }
            }}
          >
            <SelectTrigger data-testid="select-scenario">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CUSTOM}>{tr("current")}</SelectItem>
              {scenarios.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.isDefault ? ` (${tr("defaultTag")})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="sc-receipt">{tr("receiptDelay")}</Label>
            <Input id="sc-receipt" type="number" step={1} min={-60} max={180} value={value.receiptDelayDays} onChange={(e) => set("receiptDelayDays", intValue(e.target.value))} dir="ltr" className="text-start" data-testid="input-receipt-delay" />
            <p className="text-[11px] text-muted-foreground">{tr("receiptDelayHint")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sc-payment">{tr("paymentDelay")}</Label>
            <Input id="sc-payment" type="number" step={1} min={-60} max={180} value={value.paymentDelayDays} onChange={(e) => set("paymentDelayDays", intValue(e.target.value))} dir="ltr" className="text-start" data-testid="input-payment-delay" />
            <p className="text-[11px] text-muted-foreground">{tr("paymentDelayHint")}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sc-rate">{tr("collectionRate")}</Label>
            <Input id="sc-rate" type="number" step={1} min={0} max={100} value={value.collectionRatePct} onChange={(e) => set("collectionRatePct", e.target.value === "" ? 0 : Number(e.target.value))} dir="ltr" className="text-start" data-testid="input-collection-rate" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sc-day">{tr("payrollDay")}</Label>
            <Input id="sc-day" type="number" step={1} min={1} max={28} value={value.payrollPayDay} onChange={(e) => set("payrollPayDay", intValue(e.target.value))} dir="ltr" className="text-start" />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="sc-recurring">{tr("includeRecurring")}</Label>
            <Switch id="sc-recurring" checked={value.includeRecurring} onCheckedChange={(v) => set("includeRecurring", v)} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="sc-payroll">{tr("includePayroll")}</Label>
            <Switch id="sc-payroll" checked={value.includePayroll} onCheckedChange={(v) => set("includePayroll", v)} data-testid="switch-payroll" />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{tr("oneOffs")}</p>
          <p className="text-xs text-muted-foreground">{tr("oneOffsHint")}</p>
          {value.adjustments.length === 0 ? (
            <p className="text-xs text-muted-foreground">{tr("oneOffNone")}</p>
          ) : (
            <ul className="space-y-1" data-testid="oneoff-list">
              {value.adjustments.map((a, i) => (
                <li key={`${a.date}-${i}`} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm">
                  <span className="min-w-0 truncate" dir="auto">
                    <span dir="ltr" className="font-mono text-xs me-2">
                      {a.date}
                    </span>
                    {a.label}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span dir="ltr" className={`font-mono text-xs ${a.amount < 0 ? "text-destructive" : "text-[hsl(var(--chart-5))]"}`}>
                      {formatNumber(a.amount, locale)}
                    </span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={tr("oneOffRemove")} onClick={() => set("adjustments", value.adjustments.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" value={oneOff.date} onChange={(e) => setOneOff({ ...oneOff, date: e.target.value })} aria-label={tr("oneOffDate")} dir="ltr" className="text-start" data-testid="input-oneoff-date" />
            <Input inputMode="decimal" value={oneOff.amount} onChange={(e) => setOneOff({ ...oneOff, amount: e.target.value })} placeholder={tr("oneOffAmount")} aria-label={tr("oneOffAmount")} dir="ltr" className="text-start" data-testid="input-oneoff-amount" />
            <Input value={oneOff.label} onChange={(e) => setOneOff({ ...oneOff, label: e.target.value })} placeholder={tr("oneOffLabel")} aria-label={tr("oneOffLabel")} maxLength={120} dir="auto" className="col-span-2" data-testid="input-oneoff-label" />
          </div>
          <Button type="button" size="sm" variant="outline" onClick={addOneOff} disabled={!oneOffReady} data-testid="button-add-oneoff">
            <Plus className="h-4 w-4 me-1" />
            {tr("oneOffAdd")}
          </Button>
        </div>

        {issues.length > 0 && (
          <ul className="text-xs text-destructive space-y-0.5" data-testid="scenario-issues">
            {issues.map((i) => (
              <li key={i}>{tr(ISSUE_KEY[i])}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button type="button" size="sm" variant="ghost" onClick={() => { onSelect(null); onChange(DEFAULT_SCENARIO); }}>
            {tr("reset")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setShowSave((s) => !s)} disabled={issues.length > 0} data-testid="button-save-as">
            {tr("saveAs")}
          </Button>
          {selected && (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => update.mutate({ id: selected.id, body: value })} disabled={issues.length > 0 || update.isPending}>
                {update.isPending && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
                {tr("update")}
              </Button>
              {selected.isDefault ? (
                <Badge variant="secondary" className="self-center">
                  {tr("isDefault")}
                </Badge>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={() => update.mutate({ id: selected.id, body: { isDefault: true } })} disabled={update.isPending}>
                  {tr("makeDefault")}
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => setToDelete(selected)}>
                <Trash2 className="h-4 w-4 me-1 text-destructive" />
                {tr("delete")}
              </Button>
            </>
          )}
        </div>

        {showSave && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (saveName.trim() && issues.length === 0) create.mutate();
            }}
          >
            <div className="space-y-1 flex-1 min-w-[10rem]">
              <Label htmlFor="sc-name">{tr("saveName")}</Label>
              <Input id="sc-name" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={tr("saveNamePlaceholder")} maxLength={80} dir="auto" data-testid="input-scenario-name" />
            </div>
            <Button type="submit" size="sm" disabled={!saveName.trim() || create.isPending} data-testid="button-save-scenario">
              {create.isPending && <Loader2 className="h-4 w-4 me-1 animate-spin" />}
              {tr("saveNew")}
            </Button>
          </form>
        )}
      </CardContent>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate(toDelete.id)}>{tr("confirmDelete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
