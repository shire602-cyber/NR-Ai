import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import type { Project, ProjectInvoiceResult } from "@/lib/purchasing-hr";
import { messages } from "./ProjectInvoiceDialog.i18n";

interface Props {
  open: boolean;
  project: Project;
  timeEntryIds: string[];
  expenseIds: string[];
  hours: number;
  timeAmount: number;
  expenseAmount: number;
  onClose: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export function ProjectInvoiceDialog({ open, project, timeEntryIds, expenseIds, hours, timeAmount, expenseAmount, onClose }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [date, setDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [vat, setVat] = useState<"5" | "0">("5");
  const [created, setCreated] = useState<ProjectInvoiceResult | null>(null);

  useEffect(() => {
    if (open) {
      setDate(today());
      setDueDate("");
      setVat("5");
      setCreated(null);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/projects/${project.id}/invoice`, {
        timeEntryIds,
        expenseIds,
        date,
        dueDate: dueDate || null,
        vatRate: Number(vat),
      }),
    onSuccess: (invoice: ProjectInvoiceResult) => {
      setCreated(invoice);
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: tr("created", { number: invoice.number }), description: tr("createdBody") });
    },
    onError: (error: unknown) => {
      const code = error instanceof ApiError ? error.code : undefined;
      const description =
        code === "NOTHING_TO_BILL" ? tr("nothingToBill") : code === "PROJECT_HAS_NO_CUSTOMER" ? tr("noCustomer") : code === "CURRENCY_MISMATCH" ? tr("currencyMismatch") : (error as Error)?.message;
      toast({ variant: "destructive", title: tr("createFailed"), description });
    },
  });

  const nothing = timeEntryIds.length === 0 && expenseIds.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{tr("title")}</DialogTitle>
          <DialogDescription>{tr("description")}</DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-3" data-testid="invoice-created">
            <p className="text-sm font-medium">{tr("created", { number: created.number })}</p>
            <p className="text-sm text-muted-foreground">{tr("createdBody")}</p>
            <Button asChild>
              <Link href="/invoices" data-testid="link-open-invoices">
                {tr("openInvoices")}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border p-3 text-sm space-y-1">
              <p>{tr("summaryTime", { count: timeEntryIds.length, hours })}</p>
              <p>{tr("summaryExpenses", { count: expenseIds.length, amount: expenseAmount.toFixed(2) })}</p>
              <p className="font-medium" data-testid="text-invoice-net">
                {tr("summaryTotal")}: {formatCurrency(timeAmount + expenseAmount, project.currency, locale)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pi-date">{tr("invoiceDate")}</Label>
                <Input id="pi-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pi-due">{tr("dueDate")}</Label>
                <Input id="pi-due" type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>{tr("vatRate")}</Label>
              <Select value={vat} onValueChange={(v) => setVat(v as "5" | "0")}>
                <SelectTrigger data-testid="select-invoice-vat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">{tr("vatStandard")}</SelectItem>
                  <SelectItem value="0">{tr("vatZero")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {nothing && <p className="text-sm text-destructive">{tr("nothingSelected")}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {created ? tr("close") : tr("cancel")}
          </Button>
          {!created && (
            <Button onClick={() => create.mutate()} disabled={nothing || create.isPending || !date} data-testid="button-create-project-invoice">
              {create.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  {tr("creating")}
                </>
              ) : (
                tr("create")
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
