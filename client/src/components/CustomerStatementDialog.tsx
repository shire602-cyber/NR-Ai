import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { downloadPdf } from "@/lib/download-pdf";
import { messages } from "./CustomerStatementDialog.i18n";
import { messages as salesMessages } from "@/components/sales/SalesShared.i18n";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { formatCalendarDate } from "@/lib/calendar-date";

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

/** Pick a period, then download the customer's statement PDF or email it. */
export function CustomerStatementDialog({ companyId, contact, onClose }: Props) {
  const tr = messages.useT();
  const salesTr = salesMessages.useT();
  const { locale } = useTranslation();
  const { toast } = useToast();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState<"pdf" | "email" | null>(null);

  const validPeriod = !!from && !!to && from <= to;
  const base = contact ? `/api/companies/${companyId}/contacts/${contact.id}/statement` : "";

  // Advances received and not yet applied are a memo beside the statement: they never reduce the receivable balance.
  const advances = useQuery<{ unappliedAdvances?: Array<{ number: string; invoiceNumber: string; date: string; availableGross: number; kind: string }>; creditBalance?: number; creditRefunds?: Array<{ date: string; amount: number; reference: string | null }> }>({
    queryKey: ["statement-advances", companyId, contact?.id, from, to],
    enabled: !!contact && validPeriod,
    queryFn: () => apiRequest("GET", `${base}?from=${from}&to=${to}`),
  });
  const memo = advances.data?.unappliedAdvances ?? [];
  // Overpayments held as customer credit (2050), and what was paid back out of it: the same kind of memo.
  const creditBalance = advances.data?.creditBalance ?? 0;
  const creditRefunds = advances.data?.creditRefunds ?? [];

  const handlePdf = async () => {
    if (!contact || !validPeriod) return;
    setBusy("pdf");
    try {
      await downloadPdf(`${base}/pdf?from=${from}&to=${to}`, `statement-${to}.pdf`);
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
      const result = await apiRequest("POST", `${base}/email`, {
        from,
        to,
        ...(recipient.trim() ? { recipient: recipient.trim() } : {}),
      });
      toast({ title: tr("sent"), description: result?.message });
      onClose();
    } catch (err: any) {
      const notConfigured = err instanceof ApiError && err.code === "EMAIL_NOT_CONFIGURED";
      toast({
        variant: "destructive",
        title: tr("sendFailed"),
        description: notConfigured ? tr("emailNotConfigured") : err?.message,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={!!contact} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>
            {tr("title")}
            {contact ? ` - ${contact.name}` : ""}
          </DialogTitle>
          <DialogDescription>{tr("description")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="statement-from">{tr("from")}</Label>
            <Input
              id="statement-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="input-statement-from"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="statement-to">{tr("to")}</Label>
            <Input
              id="statement-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-statement-to"
            />
          </div>
        </div>
        {!validPeriod && <p className="text-sm text-destructive">{tr("invalidPeriod")}</p>}

        {memo.length > 0 && (
          <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm" data-testid="statement-advances-memo">
            <p className="font-medium">{salesTr("statementAdvancesTitle")}</p>
            <ul className="space-y-0.5">
              {memo.map((a) => (
                <li key={a.number} className="flex justify-between gap-3">
                  <span dir="ltr" className="font-mono">{a.number}</span>
                  <span dir="ltr" className="font-mono">{formatCurrency(a.availableGross, "AED", locale)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{salesTr("statementAdvancesNote")}</p>
          </div>
        )}

        {(creditBalance > 0 || creditRefunds.length > 0) && (
          <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm" data-testid="statement-credit-memo">
            <p className="font-medium">{salesTr("statementCreditTitle")}</p>
            <div className="flex justify-between gap-3">
              <span>{salesTr("creditAvailable")}</span>
              <span dir="ltr" className="font-mono" data-testid="statement-credit-balance">{formatCurrency(creditBalance, "AED", locale)}</span>
            </div>
            {creditRefunds.length > 0 && (
              <>
                <p className="pt-1 text-xs font-medium">{salesTr("statementCreditRefunds")}</p>
                <ul className="space-y-0.5">
                  {creditRefunds.map((r, i) => (
                    <li key={`${r.date}-${i}`} className="flex justify-between gap-3">
                      <span>{formatCalendarDate(r.date, locale, "short")}{r.reference ? ` · ${r.reference}` : ""}</span>
                      <span dir="ltr" className="font-mono">{formatCurrency(r.amount, "AED", locale)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="text-xs text-muted-foreground">{salesTr("statementCreditNote")}</p>
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="statement-recipient">{tr("recipient")}</Label>
          <Input
            id="statement-recipient"
            type="email"
            dir="ltr"
            placeholder={contact?.email ?? ""}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            data-testid="input-statement-recipient"
          />
          <p className="text-xs text-muted-foreground">{tr("recipientHint")}</p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            {tr("close")}
          </Button>
          <Button
            variant="outline"
            onClick={handleEmail}
            disabled={!validPeriod || busy !== null}
            data-testid="button-statement-email"
          >
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
          <Button
            onClick={handlePdf}
            disabled={!validPeriod || busy !== null}
            data-testid="button-statement-pdf"
          >
            {busy === "pdf" ? (
              <Loader2 className="w-4 h-4 me-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 me-2" />
            )}
            {tr("downloadPdf")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
