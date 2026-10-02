import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/ui/status-badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LeaveType } from "@/lib/purchasing-hr";
import { messages } from "./LeaveTab.i18n";

interface Props {
  companyId: string;
  types: LeaveType[];
  canWrite: boolean;
}

type Policy = LeaveType["payPolicy"];
type Accrual = LeaveType["accrual"];

export function LeaveTypesPanel({ companyId, types, canWrite }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [policy, setPolicy] = useState<Policy>("full");
  const [annual, setAnnual] = useState("0");
  const [accrual, setAccrual] = useState<Accrual>("none");
  const [carry, setCarry] = useState("0");
  const [negative, setNegative] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const key = ["/api/companies", companyId, "leave-types"];

  const policyLabel = (p: Policy) =>
    p === "full" ? tr("policyFull") : p === "sick_tiered" ? tr("policySick") : p === "half" ? tr("policyHalf") : p === "unpaid" ? tr("policyUnpaid") : tr("policyManual");
  const accrualLabel = (a: Accrual) => (a === "monthly_service" ? tr("accrualMonthly") : a === "annual" ? tr("accrualAnnual") : tr("accrualNone"));

  const create = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/leave-types`, { code: code.trim(), nameEn: nameEn.trim(), nameAr: nameAr.trim(), payPolicy: policy, annualDays: Number(annual) || 0, accrual, carryForwardMaxDays: Number(carry) || 0, allowNegative: negative }),
    onSuccess: () => {
      toast({ title: tr("typeSaved") });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("typeFailed"), description: error?.message }),
  });

  const toggle = useMutation({
    mutationFn: (t: LeaveType) => apiRequest("PATCH", `/api/leave-types/${t.id}`, { isActive: !t.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (error: any) => toast({ variant: "destructive", title: tr("typeFailed"), description: error?.message }),
  });

  const submit = () => {
    if (!code.trim() || !nameEn.trim() || !nameAr.trim()) return setProblem(tr("typeNeedFields"));
    setProblem(null);
    create.mutate();
  };

  return (
    <div className="space-y-4" data-testid="panel-leave-types">
      {canWrite && (
        <div className="flex justify-end">
          <Button onClick={() => { setProblem(null); setOpen(true); }} data-testid="button-new-leave-type">
            <Plus className="h-4 w-4 me-2" />
            {tr("typeNew")}
          </Button>
        </div>
      )}
      {types.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("typesEmpty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border stack-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("colCode")}</TableHead>
                <TableHead>{tr("colName")}</TableHead>
                <TableHead>{tr("colPolicy")}</TableHead>
                <TableHead className="text-end">{tr("colAnnual")}</TableHead>
                <TableHead>{tr("colAccrual")}</TableHead>
                <TableHead className="text-end">{tr("colCarry")}</TableHead>
                <TableHead>{tr("colActive")}</TableHead>
                {canWrite && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((t) => (
                <TableRow key={t.id} data-testid={`row-leave-type-${t.code}`}>
                  <TableCell dir="ltr" className="text-start font-mono text-sm">{t.code}</TableCell>
                  <TableCell className="font-medium">{locale === "ar" ? t.nameAr : t.nameEn}</TableCell>
                  <TableCell>{policyLabel(t.payPolicy)}</TableCell>
                  <TableCell className="text-end tabular-nums">{t.annualDays}</TableCell>
                  <TableCell>{accrualLabel(t.accrual)}</TableCell>
                  <TableCell className="text-end tabular-nums">{t.carryForwardMaxDays}</TableCell>
                  <TableCell>
                    <StatusBadge tone={t.isActive ? "success" : "neutral"}>{t.isActive ? tr("activeYes") : tr("activeNo")}</StatusBadge>
                  </TableCell>
                  {canWrite && (
                    <TableCell className="text-end">
                      <Button size="sm" variant="ghost" onClick={() => toggle.mutate(t)} disabled={toggle.isPending}>
                        {t.isActive ? tr("toggleOff") : tr("toggleOn")}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{tr("typeNew")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="type-code">{tr("typeCode")}</Label>
              <Input id="type-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} data-testid="input-type-code" />
            </div>
            <div className="space-y-1">
              <Label>{tr("typePolicy")}</Label>
              <Select value={policy} onValueChange={(v) => setPolicy(v as Policy)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["full", "sick_tiered", "half", "unpaid", "manual"] as const).map((p) => (
                    <SelectItem key={p} value={p}>
                      {policyLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="type-name-en">{tr("typeNameEn")}</Label>
              <Input id="type-name-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="type-name-ar">{tr("typeNameAr")}</Label>
              <Input id="type-name-ar" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="type-annual">{tr("typeAnnual")}</Label>
              <Input id="type-annual" type="number" min={0} dir="ltr" value={annual} onChange={(e) => setAnnual(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{tr("typeAccrual")}</Label>
              <Select value={accrual} onValueChange={(v) => setAccrual(v as Accrual)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["monthly_service", "annual", "none"] as const).map((a) => (
                    <SelectItem key={a} value={a}>
                      {accrualLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="type-carry">{tr("typeCarry")}</Label>
              <Input id="type-carry" type="number" min={0} dir="ltr" value={carry} onChange={(e) => setCarry(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 self-end pb-2">
              <Switch id="type-negative" checked={negative} onCheckedChange={setNegative} />
              <Label htmlFor="type-negative">{tr("typeNegative")}</Label>
            </div>
          </div>
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tr("cancel")}
            </Button>
            <Button onClick={submit} disabled={create.isPending} data-testid="button-save-leave-type">
              {create.isPending ? tr("saving") : tr("submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
