import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useContactsByType } from "@/hooks/useContactsByType";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Project, ProjectStatus } from "@/lib/purchasing-hr";
import { messages } from "./ProjectFormDialog.i18n";

interface Props {
  companyId: string;
  open: boolean;
  /** The project being edited; null creates one. */
  project: Project | null;
  onClose: () => void;
  onSaved?: (project: Project) => void;
}

interface Draft {
  name: string;
  nameAr: string;
  contactId: string;
  status: ProjectStatus;
  billingMethod: "hourly" | "non_billable";
  hourlyRate: string;
  currency: string;
  budgetAmount: string;
  budgetHours: string;
  startDate: string;
  endDate: string;
  description: string;
}

const NO_CUSTOMER = "none";
const blank: Draft = { name: "", nameAr: "", contactId: NO_CUSTOMER, status: "active", billingMethod: "hourly", hourlyRate: "", currency: "AED", budgetAmount: "", budgetHours: "", startDate: "", endDate: "", description: "" };

const toDraft = (p: Project | null): Draft =>
  p
    ? {
        name: p.name,
        nameAr: p.nameAr ?? "",
        contactId: p.contactId ?? NO_CUSTOMER,
        status: p.status,
        billingMethod: p.billingMethod,
        hourlyRate: p.hourlyRate === null ? "" : String(p.hourlyRate),
        currency: p.currency,
        budgetAmount: p.budgetAmount === null ? "" : String(p.budgetAmount),
        budgetHours: p.budgetHours === null ? "" : String(p.budgetHours),
        startDate: p.startDate ?? "",
        endDate: p.endDate ?? "",
        description: p.description ?? "",
      }
    : blank;

const optionalNumber = (v: string): number | null => (v.trim() === "" ? null : Number(v));

export function ProjectFormDialog({ companyId, open, project, onClose, onSaved }: Props) {
  const tr = messages.useT();
  const { toast } = useToast();
  const { data: customers = [] } = useContactsByType(companyId, "customer");
  const [draft, setDraft] = useState<Draft>(blank);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(toDraft(project));
      setProblem(null);
    }
  }, [open, project]);

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = {
        name: d.name.trim(),
        nameAr: d.nameAr.trim() || null,
        contactId: d.contactId === NO_CUSTOMER ? null : d.contactId,
        status: d.status,
        billingMethod: d.billingMethod,
        hourlyRate: d.billingMethod === "hourly" ? optionalNumber(d.hourlyRate) : null,
        currency: d.currency.trim().toUpperCase() || "AED",
        budgetAmount: optionalNumber(d.budgetAmount),
        budgetHours: optionalNumber(d.budgetHours),
        startDate: d.startDate || null,
        endDate: d.endDate || null,
        description: d.description.trim() || null,
      };
      return project ? apiRequest("PATCH", `/api/projects/${project.id}`, body) : apiRequest("POST", `/api/companies/${companyId}/projects`, body);
    },
    onSuccess: (saved: Project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "projects"] });
      if (project) queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id] });
      toast({ title: tr("saved") });
      onSaved?.(saved);
      onClose();
    },
    onError: (error: any) => toast({ variant: "destructive", title: tr("saveFailed"), description: error?.message }),
  });

  const submit = () => {
    if (!draft.name.trim()) return setProblem(tr("nameRequired"));
    if (draft.billingMethod === "hourly" && draft.hourlyRate.trim() !== "" && !(Number(draft.hourlyRate) >= 0)) return setProblem(tr("rateRequired"));
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) return setProblem(tr("datesInvalid"));
    setProblem(null);
    save.mutate(draft);
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{project ? tr("titleEdit") : tr("titleNew")}</DialogTitle>
          <DialogDescription>{tr("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="project-name">{tr("name")}</Label>
            <Input id="project-name" value={draft.name} onChange={(e) => set("name", e.target.value)} data-testid="input-project-name" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="project-name-ar">{tr("nameAr")}</Label>
            <Input id="project-name-ar" dir="rtl" value={draft.nameAr} onChange={(e) => set("nameAr", e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>{tr("customer")}</Label>
            <Select value={draft.contactId} onValueChange={(v) => set("contactId", v)}>
              <SelectTrigger data-testid="select-project-customer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CUSTOMER}>{tr("noCustomer")}</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{tr("customerHint")}</p>
          </div>
          <div className="space-y-1">
            <Label>{tr("status")}</Label>
            <Select value={draft.status} onValueChange={(v) => set("status", v as ProjectStatus)}>
              <SelectTrigger data-testid="select-project-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{tr("statusActive")}</SelectItem>
                <SelectItem value="on_hold">{tr("statusOnHold")}</SelectItem>
                <SelectItem value="completed">{tr("statusCompleted")}</SelectItem>
                <SelectItem value="cancelled">{tr("statusCancelled")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{tr("billingMethod")}</Label>
            <Select value={draft.billingMethod} onValueChange={(v) => set("billingMethod", v as Draft["billingMethod"])}>
              <SelectTrigger data-testid="select-project-billing">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">{tr("billingHourly")}</SelectItem>
                <SelectItem value="non_billable">{tr("billingNonBillable")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.billingMethod === "hourly" && (
            <>
              <div className="space-y-1">
                <Label htmlFor="project-rate">{tr("hourlyRate")}</Label>
                <Input id="project-rate" type="number" min={0} step="0.01" dir="ltr" value={draft.hourlyRate} onChange={(e) => set("hourlyRate", e.target.value)} data-testid="input-project-rate" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="project-currency">{tr("currency")}</Label>
                <Input id="project-currency" maxLength={3} dir="ltr" value={draft.currency} onChange={(e) => set("currency", e.target.value)} />
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label htmlFor="project-budget">{tr("budgetAmount")}</Label>
            <Input id="project-budget" type="number" min={0} step="0.01" dir="ltr" value={draft.budgetAmount} onChange={(e) => set("budgetAmount", e.target.value)} data-testid="input-project-budget" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="project-budget-hours">{tr("budgetHours")}</Label>
            <Input id="project-budget-hours" type="number" min={0} step="0.25" dir="ltr" value={draft.budgetHours} onChange={(e) => set("budgetHours", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="project-start">{tr("startDate")}</Label>
            <Input id="project-start" type="date" value={draft.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="project-end">{tr("endDate")}</Label>
            <Input id="project-end" type="date" value={draft.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="project-description">{tr("notes")}</Label>
            <Textarea id="project-description" value={draft.description} onChange={(e) => set("description", e.target.value)} maxLength={4000} />
          </div>
        </div>
        {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr("cancel")}
          </Button>
          <Button onClick={submit} disabled={save.isPending} data-testid="button-save-project">
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
  );
}
