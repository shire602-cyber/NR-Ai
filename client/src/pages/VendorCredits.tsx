import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { accountName } from "@/lib/account-name";
import { todayYmd } from "@/lib/calendar-date";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { CALENDAR_DATE_SHORT_FORMAT, formatCurrency, formatDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/ui/page-header";
import { Package, CheckCircle, Edit, FileText, MoreHorizontal, Plus, Trash2, Undo2 } from "lucide-react";
import { VendorPicker } from "@/components/purchases/VendorPicker";
import { useConfirmAction } from "@/components/ConfirmDialog";
import { LineProductPicker, type PickerProduct } from "@/components/sales/LineProductPicker";
import { VendorCreditStockDialog } from "@/components/purchases/VendorCreditStockDialog";
import { messages as pageMessages } from "./VendorCredits.i18n";

// ===========================
// Types
// ===========================

interface VendorCredit {
  id: string;
  vendor_id?: string | null;
  vendor_name: string;
  vendor_trn: string | null;
  bill_id: string | null;
  number: string;
  vendor_reference: string | null;
  date: string;
  currency: string;
  exchange_rate: string;
  subtotal: string;
  vat_amount: string;
  total: string;
  reverse_charge: boolean;
  status: "draft" | "approved" | "void";
  remaining_amount: string;
  notes: string | null;
}

interface CreditLine {
  product_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  vat_rate: string;
  account_id: string;
}

interface CreditDetail extends VendorCredit {
  lines: Array<{
    description: string;
    quantity: string;
    unit_price: string;
    vat_rate: string;
    account_id: string | null;
    product_id?: string | null;
  }>;
}

interface BillRow {
  id: string;
  vendor_id?: string | null;
  vendor_name: string;
  vendor_trn: string | null;
  bill_number: string | null;
  currency: string;
  total_amount: string;
  amount_paid: string;
  status: string;
  reverse_charge?: boolean;
}

const EMPTY_LINE: CreditLine = { product_id: "", description: "", quantity: "1", unit_price: "", vat_rate: "5", account_id: "" };
const NO_BILL = "none";
const OPEN_BILL_STATUSES = ["approved", "partial", "overdue"];
const round2 = (n: number) => Math.round(n * 100) / 100;

function statusBadge(status: string, label: (s: "draft" | "approved" | "void") => string) {
  const cls =
    status === "approved"
      ? "bg-info-subtle text-info"
      : status === "void"
        ? "bg-danger-subtle text-destructive"
        : "bg-muted text-foreground";
  return (
    <Badge variant="outline" className={cls}>
      {label(status as "draft" | "approved" | "void")}
    </Badge>
  );
}

export default function VendorCredits() {
  const [askConfirm, confirmDialog] = useConfirmAction();
  const locale = useI18n((s) => s.locale);
  const tr = pageMessages.useT();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [applying, setApplying] = useState<VendorCredit | null>(null);
  const [stockFor, setStockFor] = useState<VendorCredit | null>(null);

  const base = `/api/companies/${companyId}/vendor-credits`;
  const statusLabel = (s: "draft" | "approved" | "void") => tr(s);

  const { data: credits = [], isLoading } = useQuery<VendorCredit[]>({
    queryKey: ["/api/companies", companyId, "vendor-credits"],
    queryFn: () => apiRequest("GET", base),
    enabled: !!companyId,
  });

  const { data: bills = [] } = useQuery<BillRow[]>({
    queryKey: ["/api/companies", companyId, "bills"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/bills`),
    enabled: !!companyId,
  });

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/companies", companyId, "accounts"],
    enabled: !!companyId,
  });
  const expenseAccounts = accounts.filter((a: any) => a.type === "expense" || a.type === "asset");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return credits.filter(
      (c) =>
        (statusFilter === "all" || c.status === statusFilter) &&
        (!term || c.vendor_name.toLowerCase().includes(term) || c.number.toLowerCase().includes(term))
    );
  }, [credits, statusFilter, search]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vendor-credits"] });
    queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "bills"] });
  };
  const onError = (error: any) =>
    toast({ variant: "destructive", title: tr("error"), description: error?.message || tr("pleaseTryAgain") });

  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `${base}/${id}/approve`),
    onSuccess: () => {
      refresh();
      toast({ title: tr("approvedToast"), description: tr("approvedDescription") });
    },
    onError,
  });

  const voidMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `${base}/${id}/void`, {}),
    onSuccess: () => {
      refresh();
      toast({ title: tr("voidedToast"), description: tr("voidedDescription") });
    },
    onError,
  });

  const openCreate = () => {
    setEditingId(null);
    setFormOpen(true);
  };
  const openEdit = (id: string) => {
    setEditingId(id);
    setFormOpen(true);
  };

  if (!companyId) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold">{tr("vendorCreditNotes")}</h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">{tr("pleaseCreateACompanyFirst")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={tr("purchases")} title={tr("vendorCreditNotes")} description={tr("pageDescription")} />

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 flex-wrap">
              <Input
                placeholder={tr("searchVendorOrNumber")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64"
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={tr("status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tr("allStatuses")}</SelectItem>
                  <SelectItem value="draft">{tr("draft")}</SelectItem>
                  <SelectItem value="approved">{tr("approved")}</SelectItem>
                  <SelectItem value="void">{tr("void")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4 me-2" />
              {tr("newCreditNote")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <FileText className="w-10 h-10 mx-auto text-muted-foreground" />
              <p className="font-medium">{tr("noCreditNotesYet")}</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">{tr("noCreditNotesHint")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("number")}</TableHead>
                  <TableHead>{tr("vendor")}</TableHead>
                  <TableHead>{tr("date")}</TableHead>
                  <TableHead>{tr("status")}</TableHead>
                  <TableHead className="text-end">{tr("total")}</TableHead>
                  <TableHead className="text-end">{tr("remaining")}</TableHead>
                  <TableHead className="text-end">{tr("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.number}</TableCell>
                    <TableCell>{c.vendor_name}</TableCell>
                    <TableCell>{formatDate(c.date, tr.locale, CALENDAR_DATE_SHORT_FORMAT)}</TableCell>
                    <TableCell>{statusBadge(c.status, statusLabel)}</TableCell>
                    <TableCell className="text-end">{formatCurrency(Number(c.total), c.currency, tr.locale)}</TableCell>
                    <TableCell className="text-end">
                      {c.status === "approved" ? formatCurrency(Number(c.remaining_amount), c.currency, tr.locale) : "-"}
                    </TableCell>
                    <TableCell className="text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={tr("actions")}>
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {c.status === "draft" && (
                            <>
                              <DropdownMenuItem onClick={() => openEdit(c.id)}>
                                <Edit className="w-4 h-4 me-2" />
                                {tr("edit")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  askConfirm(tr("confirmApprove"), () => approveMutation.mutate(c.id));
                                }}
                              >
                                <CheckCircle className="w-4 h-4 me-2" />
                                {tr("approve")}
                              </DropdownMenuItem>
                            </>
                          )}
                          {c.status !== "draft" && (
                            <DropdownMenuItem onClick={() => setStockFor(c)} data-testid={`menu-credit-stock-${c.id}`}>
                              <Package className="w-4 h-4 me-2" />
                              {tr("viewStockMovement")}
                            </DropdownMenuItem>
                          )}
                          {c.status === "approved" && Number(c.remaining_amount) > 0 && (
                            <DropdownMenuItem onClick={() => setApplying(c)}>
                              <Undo2 className="w-4 h-4 me-2" />
                              {tr("applyToBill")}
                            </DropdownMenuItem>
                          )}
                          {c.status !== "void" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => {
                                  askConfirm(tr("confirmVoid"), () => voidMutation.mutate(c.id), { destructive: true });
                                }}
                              >
                                <Trash2 className="w-4 h-4 me-2" />
                                {tr("voidCreditNote")}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {formOpen && (
        <CreditFormDialog
          key={editingId ?? "new"}
          companyId={companyId}
          editingId={editingId}
          bills={bills}
          accounts={expenseAccounts}
          onClose={() => setFormOpen(false)}
          onSaved={refresh}
        />
      )}
      {applying && (
        <ApplyDialog
          companyId={companyId}
          credit={applying}
          bills={bills}
          onClose={() => setApplying(null)}
          onApplied={refresh}
        />
      )}
      {companyId && <VendorCreditStockDialog companyId={companyId} credit={stockFor} onClose={() => setStockFor(null)} />}
      {confirmDialog}
    </div>
  );
}

// ===========================
// Create / edit dialog
// ===========================

function CreditFormDialog(props: {
  companyId: string;
  editingId: string | null;
  bills: BillRow[];
  accounts: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { companyId, editingId, bills, accounts, onClose, onSaved } = props;
  const tr = pageMessages.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const base = `/api/companies/${companyId}/vendor-credits`;

  const [billId, setBillId] = useState(NO_BILL);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [vendorTrn, setVendorTrn] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [vendorReference, setVendorReference] = useState("");
  const [reverseCharge, setReverseCharge] = useState(false);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<CreditLine[]>([{ ...EMPTY_LINE }]);
  // Stock items can be returned to the supplier on a line: approving the credit takes the quantity out of stock.
  const { data: allProducts = [] } = useQuery<Array<PickerProduct>>({
    queryKey: ["/api/companies", companyId, "products"],
    enabled: !!companyId,
  });
  const stockItems = allProducts.filter((p) => p.trackInventory && p.isActive !== false);

  useQuery<CreditDetail>({
    queryKey: ["/api/companies", companyId, "vendor-credits", editingId],
    queryFn: async () => {
      const d: CreditDetail = await apiRequest("GET", `${base}/${editingId}`);
      setBillId(d.bill_id ?? NO_BILL);
      setVendorId(d.vendor_id ?? null);
      setVendorName(d.vendor_name);
      setVendorTrn(d.vendor_trn ?? "");
      setDate(d.date);
      setVendorReference(d.vendor_reference ?? "");
      setReverseCharge(d.reverse_charge);
      setNotes(d.notes ?? "");
      setLines(
        d.lines.map((l) => ({
          product_id: l.product_id ?? "",
          description: l.description,
          quantity: String(Number(l.quantity)),
          unit_price: String(Number(l.unit_price)),
          vat_rate: String(Number(l.vat_rate)),
          account_id: l.account_id ?? "",
        }))
      );
      return d;
    },
    enabled: !!editingId,
  });

  const linkedBill = bills.find((b) => b.id === billId);
  const selectableBills = bills.filter((b) => b.status !== "pending" && b.status !== "pending_approval");

  const totals = useMemo(() => {
    let subtotal = 0;
    let vat = 0;
    for (const l of lines) {
      const amount = round2((Number(l.quantity) || 1) * (Number(l.unit_price) || 0));
      subtotal += amount;
      vat += (amount * (Number(l.vat_rate) || 0)) / 100;
    }
    const rc = linkedBill ? linkedBill.reverse_charge === true : reverseCharge;
    return { subtotal: round2(subtotal), vat: round2(vat), total: round2(rc ? subtotal : subtotal + vat) };
  }, [lines, linkedBill, reverseCharge]);

  const updateLine = (index: number, patch: Partial<CreditLine>) =>
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const chooseBill = (id: string) => {
    setBillId(id);
    const bill = bills.find((b) => b.id === id);
    if (bill) {
      setVendorId(bill.vendor_id ?? null);
      setVendorName(bill.vendor_name);
      setVendorTrn(bill.vendor_trn ?? "");
    }
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        bill_id: billId === NO_BILL ? null : billId,
        vendor_id: vendorId,
        vendor_name: vendorName.trim() || undefined,
        vendor_trn: vendorTrn.trim() || null,
        vendor_reference: vendorReference.trim() || null,
        date,
        reverse_charge: reverseCharge,
        notes: notes.trim() || null,
        line_items: lines.map((l) => ({
          product_id: l.product_id || null,
          description: l.description,
          quantity: l.quantity || "1",
          unit_price: l.unit_price,
          vat_rate: Number(l.vat_rate),
          account_id: l.account_id || null,
        })),
      };
      return editingId ? apiRequest("PATCH", `${base}/${editingId}`, payload) : apiRequest("POST", base, payload);
    },
    onSuccess: () => {
      onSaved();
      toast({
        title: editingId ? tr("updated") : tr("created"),
        description: editingId ? undefined : tr("createdDescription"),
      });
      onClose();
    },
    onError: (error: any) =>
      toast({ variant: "destructive", title: tr("error"), description: error?.message || tr("pleaseTryAgain") }),
  });

  const submit = () => {
    if (billId === NO_BILL && !vendorName.trim()) {
      return toast({ variant: "destructive", title: tr("error"), description: tr("vendorIsRequired") });
    }
    if (lines.some((l) => !l.description.trim())) {
      return toast({ variant: "destructive", title: tr("error"), description: tr("descriptionIsRequired") });
    }
    if (lines.some((l) => !(Number(l.unit_price) > 0))) {
      return toast({ variant: "destructive", title: tr("error"), description: tr("atLeastOneLine") });
    }
    saveMutation.mutate();
  };

  const currency = linkedBill?.currency ?? "AED";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingId ? tr("editCreditNote") : tr("newCreditNote")}</DialogTitle>
          <DialogDescription>{editingId ? tr("editDescription") : tr("createDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2 sm:col-span-2">
              <Label>{tr("relatedBill")}</Label>
              <Select value={billId} onValueChange={chooseBill}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_BILL}>{tr("noBillStandalone")}</SelectItem>
                  {selectableBills.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {`${b.bill_number || b.id.slice(0, 8)} - ${b.vendor_name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{tr("vendorName")}</Label>
              <VendorPicker
                companyId={companyId}
                vendorId={vendorId}
                fallbackName={vendorName}
                disabled={billId !== NO_BILL}
                onSelect={(vendor) => {
                  setVendorId(vendor.id);
                  setVendorName(vendor.name);
                  if (vendor.trnNumber) setVendorTrn(vendor.trnNumber);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>{tr("vendorTrn")}</Label>
              <Input
                value={vendorTrn}
                onChange={(e) => setVendorTrn(e.target.value)}
                placeholder={tr("optional")}
                disabled={billId !== NO_BILL}
              />
            </div>
            <div className="space-y-2">
              <Label>{tr("date")}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{tr("vendorReference")}</Label>
              <Input
                value={vendorReference}
                onChange={(e) => setVendorReference(e.target.value)}
                placeholder={tr("optional")}
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="vcn-reverse-charge"
                type="checkbox"
                checked={linkedBill ? linkedBill.reverse_charge === true : reverseCharge}
                disabled={!!linkedBill}
                onChange={(e) => setReverseCharge(e.target.checked)}
              />
              <Label htmlFor="vcn-reverse-charge">{tr("reverseCharge")}</Label>
              {linkedBill && <span className="text-xs text-muted-foreground">{tr("reverseChargeInherited")}</span>}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{tr("lineItems")}</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, { ...EMPTY_LINE }])}>
                <Plus className="w-4 h-4 me-1" />
                {tr("addLine")}
              </Button>
            </div>
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-center p-3 border rounded-md">
                <Input
                  className="col-span-12 sm:col-span-3"
                  placeholder={tr("description")}
                  value={line.description}
                  onChange={(e) => updateLine(index, { description: e.target.value })}
                />
                <Input
                  className="col-span-3 sm:col-span-1"
                  type="number"
                  step="0.01"
                  placeholder={tr("qty")}
                  value={line.quantity}
                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                />
                <Input
                  className="col-span-5 sm:col-span-2"
                  type="number"
                  step="0.01"
                  placeholder={tr("unitPrice")}
                  value={line.unit_price}
                  onChange={(e) => updateLine(index, { unit_price: e.target.value })}
                />
                {stockItems.length > 0 && (
                  <div className="col-span-12 order-first" data-testid={`credit-line-stock-${index}`}>
                    <LineProductPicker
                      products={stockItems}
                      value={line.product_id || null}
                      testId={`select-credit-line-product-${index}`}
                      onPick={(picked) => {
                        if (!picked) return updateLine(index, { product_id: "" });
                        updateLine(index, {
                          product_id: picked.id,
                          description: locale === "ar" && picked.nameAr ? picked.nameAr : picked.name,
                          ...(Number(picked.costPrice) > 0 ? { unit_price: String(Number(picked.costPrice)) } : {}),
                          vat_rate: String(Math.round(Number(picked.vatRate ?? 0.05) * 100)),
                        });
                      }}
                    />
                    {line.product_id && <p className="mt-1 text-xs text-muted-foreground">{tr("stockReturnHint")}</p>}
                  </div>
                )}
                <Select value={line.vat_rate} onValueChange={(v) => updateLine(index, { vat_rate: v })}>
                  <SelectTrigger className="col-span-4 sm:col-span-2" aria-label={tr("vatPercent")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5%</SelectItem>
                    <SelectItem value="0">0%</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={line.account_id || "default"}
                  onValueChange={(v) => updateLine(index, { account_id: v === "default" ? "" : v })}
                >
                  <SelectTrigger className="col-span-10 sm:col-span-3" aria-label={tr("account")}>
                    <SelectValue placeholder={tr("account")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{tr("defaultAccount")}</SelectItem>
                    {accounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {`${a.code} ${accountName(a, locale)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="col-span-2 sm:col-span-1"
                  aria-label={tr("removeLine")}
                  disabled={lines.length === 1}
                  onClick={() => setLines((p) => p.filter((_, i) => i !== index))}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-1 text-sm text-end">
            <div>
              {tr("subtotal")}: {formatCurrency(totals.subtotal, currency, tr.locale)}
            </div>
            <div>
              {tr("vat")}: {formatCurrency(totals.vat, currency, tr.locale)}
            </div>
            <div className="font-semibold">
              {tr("total")}: {formatCurrency(totals.total, currency, tr.locale)}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{tr("notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr("cancel")}
          </Button>
          <Button onClick={submit} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? tr("saving") : tr("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================
// Apply-to-bill dialog
// ===========================

function ApplyDialog(props: {
  companyId: string;
  credit: VendorCredit;
  bills: BillRow[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const { companyId, credit, bills, onClose, onApplied } = props;
  const tr = pageMessages.useT();
  const { toast } = useToast();

  const openBills = bills.filter(
    (b) =>
      OPEN_BILL_STATUSES.includes(b.status) &&
      b.vendor_name.trim().toLowerCase() === credit.vendor_name.trim().toLowerCase() &&
      b.currency === credit.currency &&
      (b.reverse_charge === true) === credit.reverse_charge
  );
  const dueOf = (b: BillRow) => round2(Number(b.total_amount) - Number(b.amount_paid));

  const [billId, setBillId] = useState("");
  const [amount, setAmount] = useState("");

  const chooseBill = (id: string) => {
    setBillId(id);
    const bill = openBills.find((b) => b.id === id);
    if (bill) setAmount(String(Math.max(0, Math.min(Number(credit.remaining_amount), dueOf(bill)))));
  };

  const applyMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/vendor-credits/${credit.id}/apply`, {
        bill_id: billId,
        amount: Number(amount),
      }),
    onSuccess: () => {
      onApplied();
      toast({ title: tr("appliedToast"), description: tr("appliedDescription") });
      onClose();
    },
    onError: (error: any) =>
      toast({ variant: "destructive", title: tr("error"), description: error?.message || tr("pleaseTryAgain") }),
  });

  const canSubmit = !!billId && Number(amount) > 0 && !applyMutation.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("applyTitle")}</DialogTitle>
          <DialogDescription>{tr("applyDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm">
            {credit.number} - {tr("creditRemaining")}:{" "}
            <span className="font-semibold">
              {formatCurrency(Number(credit.remaining_amount), credit.currency, tr.locale)}
            </span>
          </p>
          {openBills.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("noOpenBills")}</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label>{tr("openBill")}</Label>
                <Select value={billId} onValueChange={chooseBill}>
                  <SelectTrigger>
                    <SelectValue placeholder={tr("selectBill")} />
                  </SelectTrigger>
                  <SelectContent>
                    {openBills.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {`${b.bill_number || b.id.slice(0, 8)} - ${tr("billDue")} ${formatCurrency(dueOf(b), b.currency, tr.locale)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{tr("amountToApply")}</Label>
                <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tr("cancel")}
          </Button>
          <Button onClick={() => applyMutation.mutate()} disabled={!canSubmit}>
            {tr("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
