import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { formatCalendarDate, uaeDayOf } from "@/lib/calendar-date";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseAmountText } from "@/lib/statement-review";
import { messages as common } from "@/components/banking/BankingCommon.i18n";
import { bankingErrorText } from "@/components/banking/banking-common";
import { assetErrorText } from "./asset-errors";
import { messages } from "./AssetFromBillDialog.i18n";
import { billLineCost, type BillLine } from "./asset-link";

// i18n-ignore: category values the server stores; the labels shown come from the cat_* keys
const CATEGORIES = ["Vehicles", "Furniture", "Equipment", "Electronics", "Building", "Land", "Other"] as const;

interface BillRow {
  id: string;
  vendor_name: string;
  bill_number: string | null;
  bill_date: string;
  total_amount: number | string;
  status: string;
}

interface BillDetail extends BillRow {
  line_items: BillLine[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}

/** Create a register asset from one line of a bill: cost and date come from the bill, and the asset is linked to it. */
export function AssetFromBillDialog({ open, onOpenChange, companyId }: Props) {
  const tr = messages.useT();
  const trc = common.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [billId, setBillId] = useState("");
  const [lineId, setLineId] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("Equipment");
  const [life, setLife] = useState("5");
  const [salvage, setSalvage] = useState("0");
  const [method, setMethod] = useState("straight_line");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!open) return;
    setBillId("");
    setLineId("");
    setName("");
    setCategory("Equipment");
    setLife("5");
    setSalvage("0");
    setMethod("straight_line");
    setProblem("");
  }, [open]);

  const { data: bills = [] } = useQuery<BillRow[]>({ queryKey: ["/api/companies", companyId, "bills"], enabled: open && !!companyId });
  const { data: bill } = useQuery<BillDetail>({ queryKey: ["/api/bills", billId], enabled: open && !!billId });
  const line = bill?.line_items?.find((l) => l.id === lineId);
  const cost = line ? billLineCost(line) : 0;
  const money = (n: number) => formatCurrency(n, "AED", locale);
  const lifeN = Number(life);
  const salvageN = parseAmountText(salvage);
  const valid = !!line && cost > 0 && name.trim() !== "" && Number.isInteger(lifeN) && lifeN >= 1 && salvageN !== null && salvageN >= 0 && salvageN < cost;

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/fixed-assets`, {
        assetName: name.trim(),
        category,
        purchaseDate: uaeDayOf(bill!.bill_date),
        purchaseCost: cost,
        salvageValue: salvageN ?? 0,
        usefulLifeYears: lifeN,
        depreciationMethod: method,
        billId,
        billLineId: lineId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith(`/api/companies/${companyId}/fixed-assets`) });
      toast({ title: tr("created"), description: tr("createdBody") });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const text = assetErrorText(tr, err) ?? bankingErrorText(trc, err, locale);
      setProblem(text);
      toast({ variant: "destructive", title: tr("failed"), description: text });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto" data-testid="asset-from-bill-dialog">
        <DialogHeader>
          <DialogTitle>{tr("title")}</DialogTitle>
          <DialogDescription>{tr("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{tr("bill")}</Label>
            {bills.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tr("noBills")}</p>
            ) : (
              <Select value={billId} onValueChange={(v) => { if (v) { setBillId(v); setLineId(""); } }}>
                <SelectTrigger data-testid="select-asset-bill">
                  <SelectValue placeholder={tr("pickBill")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {bills.filter((b) => b.status !== "draft" && b.status !== "void").map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span dir="auto">{`${b.bill_number ?? "-"} - ${b.vendor_name} - ${money(Number(b.total_amount))}`}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {bill && (
            <div className="space-y-1">
              <Label>{tr("line")}</Label>
              <Select
                value={lineId}
                onValueChange={(v) => {
                  if (!v) return;
                  setLineId(v);
                  const l = bill.line_items.find((x) => x.id === v);
                  if (l && !name.trim()) setName(l.description);
                }}
              >
                <SelectTrigger data-testid="select-asset-bill-line">
                  <SelectValue placeholder={tr("pickLine")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {bill.line_items.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      <span dir="auto">{tr("lineOption", { description: l.description, amount: money(billLineCost(l)) })}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {line && <p className="text-xs text-muted-foreground">{tr("fromBill", { amount: money(cost), date: formatCalendarDate(bill.bill_date, locale, "short") })}</p>}
            </div>
          )}
          {line && (
            <>
              <div className="space-y-1">
                <Label htmlFor="afb-name">{tr("name")}</Label>
                <Input id="afb-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} dir="auto" data-testid="input-asset-from-bill-name" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{tr("category")}</Label>
                  <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {tr(`cat_${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{tr("method")}</Label>
                  <Select value={method} onValueChange={(v) => v && setMethod(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="straight_line">{tr("straightLine")}</SelectItem>
                      <SelectItem value="declining_balance">{tr("decliningBalance")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="afb-life">{tr("life")}</Label>
                  <Input id="afb-life" type="number" min={1} step={1} value={life} onChange={(e) => setLife(e.target.value)} dir="ltr" className="text-start" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="afb-salvage">{tr("salvage")}</Label>
                  <Input id="afb-salvage" inputMode="decimal" value={salvage} onChange={(e) => setSalvage(e.target.value)} dir="ltr" className="text-start" />
                </div>
              </div>
            </>
          )}
          {problem && (
            <Alert variant="destructive" data-testid="asset-from-bill-error">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tr("cancel")}
          </Button>
          <Button onClick={() => create.mutate()} disabled={!valid || create.isPending} data-testid="button-create-asset-from-bill">
            {create.isPending && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
            {create.isPending ? tr("creating") : tr("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
