import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { formatCalendarDate } from "@/lib/calendar-date";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { messages as common } from "@/components/banking/BankingCommon.i18n";
import { bankingErrorText } from "@/components/banking/banking-common";
import { messages } from "./LinkAssetDialog.i18n";
import type { AssetRegisterRow } from "@/lib/banking-api-types";
import { hasRoomFor, journalCostCandidates, linkedCostByDocument, matchesCost, sortByCostMatch, type JournalLike } from "./asset-link";

interface BillRow {
  id: string;
  vendor_name: string;
  bill_number: string | null;
  bill_date: string;
  total_amount: number | string;
  status: string;
  currency?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  asset: { assetId: string; name: string; cost: number } | null;
  /** The register rows: documents they are already linked to are not offered again. */
  registerRows?: AssetRegisterRow[];
}

/** Link an asset that is already on the register to the bill or journal that bought it. */
export function LinkAssetDialog({ open, onOpenChange, companyId, asset, registerRows = [] }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [tab, setTab] = useState<"bill" | "journal">("bill");
  const [billId, setBillId] = useState("");
  const [journalId, setJournalId] = useState("");

  useEffect(() => {
    if (!open) return;
    setTab("bill");
    setBillId("");
    setJournalId("");
  }, [open, asset?.assetId]);

  const { data: bills = [] } = useQuery<BillRow[]>({ queryKey: ["/api/companies", companyId, "bills"], enabled: open && !!companyId });
  const { data: journals = [] } = useQuery<JournalLike[]>({ queryKey: ["/api/companies", companyId, "journal"], enabled: open && !!companyId });
  const cost = asset?.cost ?? 0;
  const money = (n: number) => formatCurrency(n, "AED", locale);
  const linkedCost = useMemo(() => linkedCostByDocument(registerRows, asset?.assetId), [registerRows, asset?.assetId]);
  const billChoices = useMemo(
    () => sortByCostMatch(bills.filter((b) => b.status !== "draft" && b.status !== "void" && hasRoomFor(Number(b.total_amount), linkedCost.get(b.id) ?? 0, cost)).map((b) => ({ ...b, date: b.bill_date })), (b) => Number(b.total_amount), cost),
    [bills, cost, linkedCost],
  );
  const journalChoices = useMemo(
    () => sortByCostMatch(journalCostCandidates(journals).filter((j) => hasRoomFor(j.cost, linkedCost.get(j.id) ?? 0, cost)), (j) => j.cost, cost),
    [journals, cost, linkedCost],
  );

  const link = useMutation({
    mutationFn: () => apiRequest("POST", `/api/fixed-assets/${asset!.assetId}/link`, tab === "bill" ? { billId } : { journalEntryId: journalId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith(`/api/companies/${companyId}/fixed-assets`) });
      toast({ title: tr("linked"), description: tr("linkedBody") });
      onOpenChange(false);
    },
    onError: (err: unknown) =>
      toast({ variant: "destructive", title: tr("failed"), description: err instanceof ApiError && err.code === "LINK_INVALID" ? tr("errLinkInvalid") : err instanceof ApiError && err.code === "LINE_ALREADY_LINKED" ? tr("errLineLinked") : bankingErrorText(trc, err, locale) }),
  });

  const ready = tab === "bill" ? !!billId : !!journalId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="link-asset-dialog">
        <DialogHeader>
          <DialogTitle dir="auto">{tr("title", { asset: asset?.name ?? "" })}</DialogTitle>
          <DialogDescription>{tr("description")}</DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium">{tr("cost", { amount: money(cost) })}</p>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "bill" | "journal")}>
          <TabsList>
            <TabsTrigger value="bill" data-testid="tab-link-bill">{tr("tabBill")}</TabsTrigger>
            <TabsTrigger value="journal" data-testid="tab-link-journal">{tr("tabJournal")}</TabsTrigger>
          </TabsList>
          <TabsContent value="bill" className="mt-3 space-y-2">
            {billChoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tr("noBills")}</p>
            ) : (
              <Select value={billId} onValueChange={(v) => v && setBillId(v)}>
                <SelectTrigger data-testid="select-link-bill">
                  <SelectValue placeholder={tr("pickBill")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {billChoices.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span dir="auto">
                        {tr("billOption", { number: b.bill_number ?? "-", vendor: b.vendor_name, amount: money(Number(b.total_amount)), date: formatCalendarDate(b.bill_date, locale, "short") })}
                        {matchesCost(Number(b.total_amount), cost) ? ` - ${tr("matches")}` : ""}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </TabsContent>
          <TabsContent value="journal" className="mt-3 space-y-2">
            {journalChoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tr("noJournals")}</p>
            ) : (
              <Select value={journalId} onValueChange={(v) => v && setJournalId(v)}>
                <SelectTrigger data-testid="select-link-journal">
                  <SelectValue placeholder={tr("pickJournal")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {journalChoices.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      <span dir="auto">
                        {tr("journalOption", { number: j.entryNumber, amount: money(j.cost), date: formatCalendarDate(j.date, locale, "short") })}
                        {matchesCost(j.cost, cost) ? ` - ${tr("matches")}` : ""}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tr("cancel")}
          </Button>
          <Button onClick={() => link.mutate()} disabled={!ready || link.isPending} data-testid="button-link-asset">
            {link.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
            {link.isPending ? tr("linking") : tr("link")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
