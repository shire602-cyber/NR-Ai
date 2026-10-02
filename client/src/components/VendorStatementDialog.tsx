import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Mail } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { CALENDAR_DATE_SHORT_FORMAT, formatCurrency, formatDate } from "@/lib/format";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { downloadPdf } from "@/lib/download-pdf";
import type { AgeingDetailResponse, VendorStatementResponse } from "@/lib/purchasing-hr";
import { messages } from "./VendorStatementDialog.i18n";

interface StatementContact {
  id: string;
  name: string;
  email?: string | null;
}

interface Props {
  companyId: string;
  contact: StatementContact | null;
  onClose: () => void;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const defaultFrom = () => {
  const d = new Date();
  return isoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1)));
};

/** Pick a period, read the vendor's statement and ageing on screen, then download the PDF or email it. */
export function VendorStatementDialog({ companyId, contact, onClose }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState<"pdf" | "email" | null>(null);

  const validPeriod = !!from && !!to && from <= to;
  const base = contact ? `/api/companies/${companyId}/contacts/${contact.id}/vendor-statement` : "";

  const statement = useQuery<VendorStatementResponse>({
    queryKey: ["/api/companies", companyId, "vendor-statement", contact?.id, from, to],
    enabled: !!contact && validPeriod,
    queryFn: () => apiRequest("GET", `${base}?from=${from}&to=${to}`),
  });
  const ageing = useQuery<AgeingDetailResponse>({
    queryKey: ["/api/companies", companyId, "payables-ageing-detail", contact?.id, to],
    enabled: !!contact && validPeriod,
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/payables/ageing-detail?vendorId=${contact!.id}&asOf=${to > isoDay(new Date()) ? isoDay(new Date()) : to}`),
  });

  const money = (n: number) => formatCurrency(n, "AED", locale);
  const day = (d: string) => formatDate(d, locale, CALENDAR_DATE_SHORT_FORMAT);
  const typeLabel = (t: string) => (t === "bill" ? tr("typeBill") : t === "vendor_credit" ? tr("typeCredit") : tr("typePayment"));

  const handlePdf = async () => {
    if (!contact || !validPeriod) return;
    setBusy("pdf");
    try {
      await downloadPdf(`${base}/pdf?from=${from}&to=${to}`, `vendor-statement-${to}.pdf`);
    } catch (err: any) {
      toast({ variant: "destructive", title: tr("pdfFailed"), description: err?.message });
    } finally {
      setBusy(null);
    }
  };

  const handleEmail = async () => {
    if (!contact || !validPeriod) return;
    setBusy("email");
    try {
      const result = await apiRequest("POST", `${base}/email`, { from, to, ...(recipient.trim() ? { recipient: recipient.trim() } : {}) });
      toast({ title: tr("sent"), description: result?.message });
      onClose();
    } catch (err: any) {
      const code = err instanceof ApiError ? err.code : undefined;
      toast({
        variant: "destructive",
        title: tr("sendFailed"),
        description: code === "EMAIL_NOT_CONFIGURED" ? tr("emailNotConfigured") : code === "NO_RECIPIENT" ? tr("noRecipient") : err?.message,
      });
    } finally {
      setBusy(null);
    }
  };

  const s = statement.data;
  const a = ageing.data;
  const rows = a?.vendors.flatMap((v) => v.rows) ?? [];
  const buckets = a?.totals;

  return (
    <Dialog open={!!contact} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="dialog-vendor-statement">
        <DialogHeader>
          <DialogTitle>
            {tr("title")}
            {contact ? ` - ${contact.name}` : ""}
          </DialogTitle>
          <DialogDescription>{tr("description")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="vstatement-from">{tr("from")}</Label>
            <Input id="vstatement-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} data-testid="input-vstatement-from" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vstatement-to">{tr("to")}</Label>
            <Input id="vstatement-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} data-testid="input-vstatement-to" />
          </div>
        </div>
        {!validPeriod && <p className="text-sm text-destructive">{tr("invalidPeriod")}</p>}

        <Tabs defaultValue="statement">
          <TabsList>
            <TabsTrigger value="statement" data-testid="tab-vstatement">{tr("tabStatement")}</TabsTrigger>
            <TabsTrigger value="ageing" data-testid="tab-vageing">{tr("tabAgeing")}</TabsTrigger>
          </TabsList>

          <TabsContent value="statement">
            {statement.isLoading ? (
              <Skeleton className="h-32 w-full" aria-label={tr("loading")} />
            ) : statement.isError || !s ? (
              <p className="text-sm text-destructive" role="alert">{tr("loadFailed")}</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tr("colDate")}</TableHead>
                      <TableHead>{tr("colType")}</TableHead>
                      <TableHead>{tr("colReference")}</TableHead>
                      <TableHead className="text-end">{tr("colBilled")}</TableHead>
                      <TableHead className="text-end">{tr("colPaid")}</TableHead>
                      <TableHead className="text-end">{tr("colBalance")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">{tr("opening")}</TableCell>
                      <TableCell className="text-end tabular-nums">{money(s.openingBalance)}</TableCell>
                    </TableRow>
                    {s.lines.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">{tr("noLines")}</TableCell>
                      </TableRow>
                    )}
                    {s.lines.map((l, i) => (
                      <TableRow key={`${l.type}-${l.reference}-${i}`} data-testid={`row-vstatement-${i}`}>
                        <TableCell>{day(l.date)}</TableCell>
                        <TableCell>{typeLabel(l.type)}</TableCell>
                        <TableCell dir="ltr" className="text-start">{l.reference}</TableCell>
                        <TableCell className="text-end tabular-nums">{l.credit ? money(l.credit) : ""}</TableCell>
                        <TableCell className="text-end tabular-nums">{l.debit ? money(l.debit) : ""}</TableCell>
                        <TableCell className="text-end tabular-nums">{money(l.balance)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={5} className="font-medium">{tr("closing")}</TableCell>
                      <TableCell className="text-end tabular-nums font-semibold" data-testid="text-vstatement-closing">{money(s.closingBalance)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="ageing" className="space-y-3">
            {ageing.isLoading ? (
              <Skeleton className="h-32 w-full" aria-label={tr("loading")} />
            ) : ageing.isError || !a || !buckets ? (
              <p className="text-sm text-destructive" role="alert">{tr("loadFailed")}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{tr("ageingAsOf", { date: day(a.asOf) })}</p>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-sm" data-testid="ageing-buckets">
                  {([
                    ["bucketCurrent", buckets.current],
                    ["bucket1to30", buckets.days1to30],
                    ["bucket31to60", buckets.days31to60],
                    ["bucket61to90", buckets.days61to90],
                    ["bucketOver90", buckets.over90],
                    ["bucketTotal", buckets.total],
                  ] as const).map(([key, value]) => (
                    <div key={key} className="rounded-md border p-2">
                      <div className="text-xs text-muted-foreground">{tr(key)}</div>
                      <div className="tabular-nums font-medium">{money(value)}</div>
                    </div>
                  ))}
                </div>
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{tr("ageingEmpty")}</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{tr("colBill")}</TableHead>
                          <TableHead>{tr("colDate")}</TableHead>
                          <TableHead>{tr("colDue")}</TableHead>
                          <TableHead className="text-end">{tr("colDays")}</TableHead>
                          <TableHead className="text-end">{tr("colOutstanding")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r, i) => (
                          <TableRow key={`${r.billId ?? r.creditId}-${i}`} data-testid={`row-vageing-${i}`}>
                            <TableCell dir="ltr" className="text-start">
                              {r.type === "credit" ? `${tr("credit")} ` : ""}
                              {r.number || "-"}
                            </TableCell>
                            <TableCell>{day(r.billDate)}</TableCell>
                            <TableCell>{r.dueDate ? day(r.dueDate) : ""}</TableCell>
                            <TableCell className="text-end tabular-nums">{r.type === "credit" ? "" : Math.max(0, r.daysPastDue)}</TableCell>
                            <TableCell className="text-end tabular-nums">{money(r.outstandingAed)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

        <div className="space-y-1">
          <Label htmlFor="vstatement-recipient">{tr("recipient")}</Label>
          <Input id="vstatement-recipient" type="email" dir="ltr" placeholder={contact?.email ?? ""} value={recipient} onChange={(e) => setRecipient(e.target.value)} data-testid="input-vstatement-recipient" />
          <p className="text-xs text-muted-foreground">{tr("recipientHint")}</p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            {tr("close")}
          </Button>
          <Button variant="outline" onClick={handleEmail} disabled={!validPeriod || busy !== null} data-testid="button-vstatement-email">
            {busy === "email" ? (
              <>
                <Loader2 className="w-4 h-4 me-2 animate-spin" />
                {tr("sending")}
              </>
            ) : (
              <>
                <Mail className="w-4 h-4 me-2" />
                {tr("sendEmail")}
              </>
            )}
          </Button>
          <Button onClick={handlePdf} disabled={!validPeriod || busy !== null} data-testid="button-vstatement-pdf">
            {busy === "pdf" ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Download className="w-4 h-4 me-2" />}
            {tr("downloadPdf")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
