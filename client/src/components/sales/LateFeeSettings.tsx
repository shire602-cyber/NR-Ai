import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { salesErrorMessage } from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";

export interface LateFeeConfig {
  enabled: boolean;
  type: "percent" | "fixed";
  value: number;
  afterDays: number;
  vatTreatment: "out_of_scope" | "standard_rated";
}

const DEFAULTS: LateFeeConfig = { enabled: false, type: "percent", value: 0, afterDays: 15, vatTreatment: "out_of_scope" };

/** Late payment fee: off by default, one fee per invoice, outside the scope of VAT unless the accountant says otherwise. */
export function LateFeeSettings({ companyId, lateFee }: { companyId: string; lateFee: LateFeeConfig | undefined }) {
  const tr = messages.useT();
  const { toast } = useToast();
  const [cfg, setCfg] = useState<LateFeeConfig>(lateFee ?? DEFAULTS);
  useEffect(() => setCfg(lateFee ?? DEFAULTS), [lateFee]);

  const percentTooHigh = cfg.type === "percent" && cfg.value > 100;
  const valueMissing = cfg.enabled && !(cfg.value > 0);
  const daysOk = Number.isInteger(cfg.afterDays) && cfg.afterDays >= 0 && cfg.afterDays <= 365;

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/chasing/config/${companyId}`, { lateFee: cfg }),
    onSuccess: () => {
      toast({ title: tr("lateFeeSaved") });
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/config", companyId] });
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: tr("lateFeeSaveFailed"), description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) }),
  });

  return (
    <Card data-testid="late-fee-settings">
      <CardHeader>
        <CardTitle>{tr("lateFees")}</CardTitle>
        <CardDescription>{tr("lateFeesHelp")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="late-fee-enabled">{tr("lateFeeEnabled")}</Label>
            <p className="text-xs text-muted-foreground">{tr("lateFeeEnabledHelp")}</p>
          </div>
          <Switch id="late-fee-enabled" checked={cfg.enabled} onCheckedChange={(v) => setCfg((c) => ({ ...c, enabled: v }))} data-testid="switch-late-fee" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label>{tr("lateFeeType")}</Label>
            <Select value={cfg.type} onValueChange={(v) => setCfg((c) => ({ ...c, type: v as "percent" | "fixed" }))}>
              <SelectTrigger data-testid="select-late-fee-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">{tr("lateFeePercent")}</SelectItem>
                <SelectItem value="fixed">{tr("lateFeeFixed")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="late-fee-value">{cfg.type === "percent" ? tr("lateFeeValuePercent") : tr("lateFeeValueFixed")}</Label>
            <Input id="late-fee-value" type="number" min={0} step="0.01" dir="ltr" className="font-mono" value={cfg.value} onChange={(e) => setCfg((c) => ({ ...c, value: e.target.value === "" ? 0 : parseFloat(e.target.value) }))} aria-invalid={percentTooHigh || valueMissing} data-testid="input-late-fee-value" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="late-fee-days">{tr("lateFeeAfterDays")}</Label>
            <Input id="late-fee-days" type="number" min={0} max={365} step={1} dir="ltr" className="font-mono" value={cfg.afterDays} onChange={(e) => setCfg((c) => ({ ...c, afterDays: e.target.value === "" ? 0 : parseInt(e.target.value, 10) }))} aria-invalid={!daysOk} data-testid="input-late-fee-days" />
          </div>
          <div className="space-y-1.5">
            <Label>{tr("lateFeeVat")}</Label>
            <Select value={cfg.vatTreatment} onValueChange={(v) => setCfg((c) => ({ ...c, vatTreatment: v as LateFeeConfig["vatTreatment"] }))}>
              <SelectTrigger data-testid="select-late-fee-vat"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="out_of_scope">{tr("lateFeeOutOfScope")}</SelectItem>
                <SelectItem value="standard_rated">{tr("lateFeeStandardRated")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{tr("lateFeeVatNote")}</p>
        {percentTooHigh && <p role="alert" className="text-sm text-destructive">{tr("lateFeePercentMax")}</p>}
        {valueMissing && <p role="alert" className="text-sm text-destructive">{tr("lateFeeValueNeeded")}</p>}
        <Button disabled={percentTooHigh || valueMissing || !daysOk || save.isPending} onClick={() => save.mutate()} data-testid="button-save-late-fee">
          {save.isPending ? tr("saving") : tr("save")}
        </Button>
      </CardContent>
    </Card>
  );
}
