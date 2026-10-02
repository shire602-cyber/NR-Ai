import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Download, Plus, Undo2, WalletCards } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ContactPicker } from "@/components/sales/ContactPicker";
import { messages as sharedMessages } from "@/components/sales/SalesShared.i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/format";
import { downloadPdf } from "@/lib/download-pdf";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { advanceStatusTone, grossOfNet, isCashOrBankAccount, netOfGross, round2, salesErrorMessage, salesKeys, type CustomerAdvance } from "@/lib/sales-api";
import { messages } from "./CustomerAdvances.i18n";

const todayYmd = () => new Date().toISOString().slice(0, 10);
const METHODS = ["bank", "cash", "cheque", "card"] as const;

export default function CustomerAdvances() {
  const tr = messages.useT();
  const shared = sharedMessages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [recordOpen, setRecordOpen] = useState(false);
  const [refunding, setRefunding] = useState<CustomerAdvance | null>(null);

  const { data: advances = [], isLoading } = useQuery<CustomerAdvance[]>({
    queryKey: salesKeys.advances(companyId),
    enabled: !!companyId,
  });
  const { data: accounts = [] } = useQuery<any[]>({ queryKey: ["/api/companies", companyId, "accounts"], enabled: !!companyId });
  const bankAccounts = accounts.filter((a) => isCashOrBankAccount(a) && a.isActive !== false);
  const accountLabel = (a: any) => `${a.code} - ${locale === "ar" && a.nameAr ? a.nameAr : a.nameEn}`;
  const money = (n: number | string, currency = "AED") => formatCurrency(Number(n), currency, locale);

  // ── record an advance ──
  const [contactId, setContactId] = useState<string | null>(null);
  const [date, setDate] = useState(todayYmd());
  const [gross, setGross] = useState("");
  const [vatRate, setVatRate] = useState("0.05");
  const [kind, setKind] = useState<"advance" | "deposit">("advance");
  const [description, setDescription] = useState("");
  const [receiveNow, setReceiveNow] = useState(true);
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [method, setMethod] = useState<string>("bank");
  const [reference, setReference] = useState("");

  const resetRecord = () => {
    setContactId(null); setDate(todayYmd()); setGross(""); setVatRate("0.05"); setKind("advance"); setDescription("");
    setReceiveNow(true); setPaymentAccountId(""); setMethod("bank"); setReference("");
  };

  const grossNum = Number(gross);
  const effectiveRate = kind === "deposit" ? 0 : Number(vatRate);
  const netPreview = Number.isFinite(grossNum) && grossNum > 0 ? netOfGross(grossNum, effectiveRate) : 0;
  const vatPreview = Number.isFinite(grossNum) && grossNum > 0 ? round2(grossNum - netPreview) : 0;
  const canRecord = !!contactId && grossNum > 0 && (!receiveNow || !!paymentAccountId);

  const record = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/customer-advances`, {
        contactId,
        date,
        amount: grossNum,
        vatRate: effectiveRate,
        kind,
        description: description.trim() || null,
        ...(receiveNow ? { receive: { paymentAccountId, method, reference: reference.trim() || null } } : {}),
      }),
    onSuccess: (result: { advance: CustomerAdvance; paymentError?: string | null }) => {
      queryClient.invalidateQueries({ queryKey: salesKeys.advances(companyId) });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
      if (result.paymentError) {
        toast({ variant: "destructive", title: tr("recordedNotReceived"), description: result.paymentError });
      } else {
        toast({ title: tr("recorded"), description: result.advance.number });
      }
      setRecordOpen(false);
      resetRecord();
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: tr("recordFailed"), description: salesErrorMessage(error, (k) => shared(k), shared("pleaseTryAgain")) }),
  });

  // ── refund ──
  const [refundGross, setRefundGross] = useState("");
  const [refundDate, setRefundDate] = useState(todayYmd());
  const [refundAccount, setRefundAccount] = useState("");
  const openRefund = (a: CustomerAdvance) => {
    setRefunding(a);
    setRefundGross(String(grossOfNet(Number(a.available ?? 0), a.vatRate)));
    setRefundDate(todayYmd());
    setRefundAccount("");
  };
  const refundNum = Number(refundGross);
  const maxGross = refunding ? grossOfNet(Number(refunding.available ?? 0), refunding.vatRate) : 0;
  const refund = useMutation({
    mutationFn: () => apiRequest("POST", `/api/companies/${companyId}/customer-advances/${refunding!.id}/refund`, { amount: refundNum, date: refundDate, bankAccountId: refundAccount }),
    onSuccess: (result: { refundError?: string | null }) => {
      queryClient.invalidateQueries({ queryKey: salesKeys.advances(companyId) });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "credit-notes"] });
      if (result.refundError) toast({ variant: "destructive", title: tr("refundCreditNoteOnly"), description: result.refundError });
      else toast({ title: tr("refunded") });
      setRefunding(null);
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: tr("refundFailed"), description: salesErrorMessage(error, (k) => shared(k), shared("pleaseTryAgain")) }),
  });

  const statusLabel = (s: string) => (s === "open" ? tr("statusOpen") : s === "applied" ? tr("statusApplied") : s === "refunded" ? tr("statusRefunded") : tr("statusVoid"));
  const kindLabel = (k: string) => (k === "deposit" ? tr("kindDeposit") : tr("kindAdvance"));
  const pdf = (a: CustomerAdvance) => downloadPdf(`/api/invoices/${a.invoiceId}/pdf`, `${a.number}.pdf`).catch((e: Error) => toast({ variant: "destructive", title: tr("pdfFailed"), description: e.message }));

  return (
    <div className="space-y-6" data-testid="page-customer-advances">
      <PageHeader eyebrow={tr("eyebrow")} title={tr("title")} description={tr("description")} icon={WalletCards} />
      <div className="flex justify-end">
        <Button onClick={() => setRecordOpen(true)} data-testid="button-record-advance">
          <Plus className="me-2 h-4 w-4" />
          {tr("recordAdvance")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : advances.length === 0 ? (
        <EmptyState icon={WalletCards} title={tr("emptyTitle")} description={tr("emptyBody")} action={{ label: tr("recordAdvance"), onClick: () => setRecordOpen(true) }} testId="empty-advances" />
      ) : (
        <>
          <div className="grid gap-3 lg:hidden" data-testid="mobile-advances">
            {advances.map((a) => (
              <Card key={a.id} className="space-y-2 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono text-sm font-semibold" dir="ltr">{a.number}</p>
                    <p className="text-sm">{a.contactName}</p>
                  </div>
                  <p className="font-mono text-sm font-semibold" dir="ltr">{money(a.grossAmount, a.currency)}</p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge tone={advanceStatusTone(a.status)}>{statusLabel(a.status)}</StatusBadge>
                  <span className="text-xs text-muted-foreground">{tr("availableNet", { amount: money(a.available ?? 0, a.currency) })}</span>
                </div>
                {Number(a.available ?? 0) > 0.004 && a.status !== "void" && (
                  <Button size="sm" variant="outline" onClick={() => openRefund(a)}><Undo2 className="me-2 h-4 w-4" />{tr("refund")}</Button>
                )}
              </Card>
            ))}
          </div>
          <Card className="hidden lg:block">
            <div className="overflow-x-auto">
              <Table className="whitespace-nowrap">
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("colNumber")}</TableHead>
                    <TableHead>{tr("colCustomer")}</TableHead>
                    <TableHead>{tr("colKind")}</TableHead>
                    <TableHead>{tr("colInvoice")}</TableHead>
                    <TableHead className="text-end">{tr("colGross")}</TableHead>
                    <TableHead className="text-end">{tr("colApplied")}</TableHead>
                    <TableHead className="text-end">{tr("colAvailable")}</TableHead>
                    <TableHead>{tr("colStatus")}</TableHead>
                    <TableHead className="text-end">{tr("colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {advances.map((a) => (
                    <TableRow key={a.id} data-testid={`advance-row-${a.number}`}>
                      <TableCell className="font-mono font-medium" dir="ltr">{a.number}</TableCell>
                      <TableCell>{a.contactName}</TableCell>
                      <TableCell>{kindLabel(a.kind)}</TableCell>
                      <TableCell className="font-mono" dir="ltr"><Link href="/invoices" className="underline-offset-2 hover:underline">{a.invoiceNumber}</Link></TableCell>
                      <TableCell className="text-end font-mono" dir="ltr">{money(a.grossAmount, a.currency)}</TableCell>
                      <TableCell className="text-end font-mono" dir="ltr">{money(a.applied ?? 0, a.currency)}</TableCell>
                      <TableCell className="text-end font-mono" dir="ltr" data-testid={`advance-available-${a.number}`}>{money(a.available ?? 0, a.currency)}</TableCell>
                      <TableCell><StatusBadge tone={advanceStatusTone(a.status)}>{statusLabel(a.status)}</StatusBadge></TableCell>
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => pdf(a)} aria-label={tr("downloadPdfFor", { number: a.number })} data-testid={`button-advance-pdf-${a.number}`}>
                            <Download className="h-4 w-4" />
                          </Button>
                          {Number(a.available ?? 0) > 0.004 && a.status !== "void" && (
                            <Button variant="ghost" size="sm" onClick={() => openRefund(a)} data-testid={`button-refund-${a.number}`}>
                              <Undo2 className="me-1 h-4 w-4" />
                              {tr("refund")}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
          <p className="text-xs text-muted-foreground">{tr("availableNote")}</p>
        </>
      )}

      {/* Record an advance */}
      <Dialog open={recordOpen} onOpenChange={(o) => { setRecordOpen(o); if (!o) resetRecord(); }}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" data-testid="record-advance-dialog">
          <DialogHeader>
            <DialogTitle>{tr("recordAdvance")}</DialogTitle>
            <DialogDescription>{tr("recordHelp")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <ContactPicker companyId={companyId} contactId={contactId} required testId="select-advance-contact" label={tr("customer")} onSelect={(c) => setContactId(c?.id ?? null)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{tr("kind")}</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as "advance" | "deposit")}>
                  <SelectTrigger data-testid="select-advance-kind"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="advance">{tr("kindAdvance")}</SelectItem>
                    <SelectItem value="deposit">{tr("kindDeposit")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="advance-date">{tr("date")}</Label>
                <Input id="advance-date" type="date" dir="ltr" max={todayYmd()} value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-advance-date" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="advance-gross">{tr("grossAmount")}</Label>
                <Input id="advance-gross" type="number" min={0.01} step="0.01" dir="ltr" className="font-mono" value={gross} onChange={(e) => setGross(e.target.value)} data-testid="input-advance-gross" />
              </div>
              <div className="space-y-1.5">
                <Label>{tr("vat")}</Label>
                <Select value={kind === "deposit" ? "0" : vatRate} onValueChange={setVatRate} disabled={kind === "deposit"}>
                  <SelectTrigger data-testid="select-advance-vat"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.05">5%</SelectItem>
                    <SelectItem value="0">0%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="advance-split">
              {kind === "deposit" ? tr("depositNote") : tr("advanceVatNote")} {tr("splitPreview", { net: money(netPreview), vat: money(vatPreview) })}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="advance-description">{tr("descriptionLabel")}</Label>
              <Textarea id="advance-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="advance-receive">{tr("receivedNow")}</Label>
                <Switch id="advance-receive" checked={receiveNow} onCheckedChange={setReceiveNow} data-testid="switch-advance-received" />
              </div>
              {receiveNow ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>{tr("paymentAccount")}</Label>
                    <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                      <SelectTrigger data-testid="select-advance-account"><SelectValue placeholder={tr("selectAccount")} /></SelectTrigger>
                      <SelectContent>
                        {bankAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{accountLabel(a)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{tr("method")}</Label>
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {METHODS.map((m) => <SelectItem key={m} value={m}>{m === "bank" ? tr("methodBank") : m === "cash" ? tr("methodCash") : m === "cheque" ? tr("methodCheque") : tr("methodCard")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="advance-reference">{tr("reference")}</Label>
                    <Input id="advance-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{tr("notReceivedNote")}</p>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setRecordOpen(false); resetRecord(); }}>{tr("cancel")}</Button>
              <Button className="flex-1" disabled={!canRecord || record.isPending} onClick={() => record.mutate()} data-testid="button-save-advance">
                {record.isPending ? tr("saving") : tr("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Refund */}
      <Dialog open={refunding !== null} onOpenChange={(o) => !o && setRefunding(null)}>
        <DialogContent className="max-w-md" data-testid="refund-advance-dialog">
          <DialogHeader>
            <DialogTitle>{tr("refundTitle", { number: refunding?.number ?? "" })}</DialogTitle>
            <DialogDescription>{tr("refundHelp")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="refund-gross">{tr("refundAmount")}</Label>
              <Input id="refund-gross" type="number" min={0.01} step="0.01" max={maxGross} dir="ltr" className="font-mono" value={refundGross} onChange={(e) => setRefundGross(e.target.value)} data-testid="input-refund-amount" />
              <p className="text-xs text-muted-foreground">{tr("refundMax", { amount: money(maxGross) })}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refund-date">{tr("date")}</Label>
              <Input id="refund-date" type="date" dir="ltr" max={todayYmd()} value={refundDate} onChange={(e) => setRefundDate(e.target.value)} data-testid="input-refund-date" />
            </div>
            <div className="space-y-1.5">
              <Label>{tr("refundFrom")}</Label>
              <Select value={refundAccount} onValueChange={setRefundAccount}>
                <SelectTrigger data-testid="select-refund-account"><SelectValue placeholder={tr("selectAccount")} /></SelectTrigger>
                <SelectContent>{bankAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{accountLabel(a)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setRefunding(null)}>{tr("cancel")}</Button>
              <Button className="flex-1" disabled={!(refundNum > 0) || refundNum > maxGross + 0.004 || !refundAccount || refund.isPending} onClick={() => refund.mutate()} data-testid="button-confirm-refund">
                {refund.isPending ? tr("saving") : tr("refund")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
