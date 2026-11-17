import { useEffect, useState } from "react";
import { Check, Copy, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";

type EmailOutcome = "sent" | "not_configured" | "queued" | "failed";

/**
 * Share link and "send by email" for an issued invoice. The link comes from
 * POST /api/invoices/:id/share (public /view/invoice/:token). The email result is shown honestly:
 * "sent" only when the server says it was sent; with no email provider the user is told nothing
 * was sent and to copy the link instead.
 */
export function ShareInvoiceDialog(props: {
  invoice: { id: string; number: string } | null;
  companyId: string | undefined;
  onClose: () => void;
}) {
  // Keyed by invoice so every invoice opens with fresh state (no reset-in-effect).
  return <ShareInvoiceDialogBody key={props.invoice?.id ?? "none"} {...props} />;
}

function ShareInvoiceDialogBody({
  invoice,
  companyId,
  onClose,
}: {
  invoice: { id: string; number: string } | null;
  companyId: string | undefined;
  onClose: () => void;
}) {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<EmailOutcome | null>(null);

  useEffect(() => {
    if (!invoice) return;
    let cancelled = false;
    apiRequest("POST", `/api/invoices/${invoice.id}/share`, {})
      .then((res) => {
        if (cancelled) return;
        const path = String(res?.shareUrl ?? "");
        setLink(path.startsWith("http") ? path : `${window.location.origin}${path}`);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLinkError(
          error instanceof ApiError && error.body?.code === "INVOICE_NOT_ISSUED"
            ? t["invoices.shareNotIssued"]
            : t["invoices.shareLinkFailed"]
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast({ title: t["invoices.shareCopied"] });
    } catch {
      // Clipboard blocked: select the field so the user can copy by hand.
      document.getElementById("invoice-share-link")?.focus();
    }
  };

  const send = async () => {
    if (!invoice || !companyId || !to) return;
    setSending(true);
    setOutcome(null);
    try {
      const res = await apiRequest(
        "POST",
        `/api/companies/${companyId}/invoices/${invoice.id}/send-email`,
        { to, language: locale === "ar" ? "ar" : "en" }
      );
      setOutcome(res?.sent ? "sent" : res?.emailConfigured === false ? "not_configured" : "queued");
    } catch {
      setOutcome("failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {formatMessage(t["invoices.shareTitle"], { number: invoice?.number ?? "" })}
          </DialogTitle>
          <DialogDescription>{t["invoices.shareDesc"]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label htmlFor="invoice-share-link" className="text-sm font-medium">
              {t["invoices.shareLinkLabel"]}
            </label>
            {linkError ? (
              <Alert variant="destructive">
                <AlertDescription>{linkError}</AlertDescription>
              </Alert>
            ) : (
              <div className="flex gap-2">
                <Input
                  id="invoice-share-link"
                  readOnly
                  dir="ltr"
                  value={link}
                  placeholder={t["invoices.shareCreating"]}
                  data-testid="input-invoice-share-link"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0"
                  disabled={!link}
                  onClick={() => void copy()}
                  data-testid="button-copy-invoice-link"
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {t["invoices.shareCopy"]}
                </Button>
              </div>
            )}
          </div>

          {!linkError && (
            <div className="space-y-2">
              <label htmlFor="invoice-share-email" className="text-sm font-medium">
                {t["invoices.shareEmailLabel"]}
              </label>
              <div className="flex gap-2">
                <Input
                  id="invoice-share-email"
                  type="email"
                  dir="ltr"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder={t["invoices.shareEmailTo"]}
                  data-testid="input-invoice-share-email"
                />
                <Button
                  type="button"
                  className="min-h-11 shrink-0"
                  disabled={sending || !to || !link}
                  onClick={() => void send()}
                  data-testid="button-send-invoice-email"
                >
                  <Mail aria-hidden />
                  {sending ? t["invoices.shareEmailSending"] : t["invoices.shareEmailSend"]}
                </Button>
              </div>
              {outcome && (
                <Alert
                  variant={outcome === "failed" ? "destructive" : "default"}
                  data-testid={`invoice-share-email-${outcome}`}
                >
                  <AlertDescription>
                    {outcome === "sent"
                      ? formatMessage(t["invoices.shareEmailSent"], { to })
                      : outcome === "not_configured"
                        ? t["invoices.shareEmailNotConfigured"]
                        : outcome === "queued"
                          ? t["invoices.shareEmailQueued"]
                          : t["invoices.shareEmailFailed"]}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
