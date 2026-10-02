import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Send } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { salesErrorMessage } from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";

interface SendResult {
  quote: { id: string; status: string };
  shareUrl: string;
  emailed: boolean;
  emailError?: string | null;
}

interface Props {
  quote: { id: string; number: string } | null;
  companyId: string;
  defaultEmail?: string | null;
  onClose: () => void;
}

/** Send a draft quote: mint the public link, and email it when an address is given. The link is shown either way. */
export function QuoteSendDialog({ quote, companyId, defaultEmail, onClose }: Props) {
  const tr = messages.useT();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);
  const [copied, setCopied] = useState(false);

  const send = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/quotes/${quote!.id}/send`, {
        ...(email.trim() ? { email: email.trim() } : defaultEmail ? { email: defaultEmail } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
      }) as Promise<SendResult>,
    onSuccess: (r) => {
      setResult(r);
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "quotes"] });
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: tr("quoteSendFailed"), description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) }),
  });

  const absoluteUrl = result ? (result.shareUrl.startsWith("http") ? result.shareUrl : `${window.location.origin}${result.shareUrl}`) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: "destructive", title: tr("copyFailed") });
    }
  };
  const close = () => {
    setResult(null);
    setEmail("");
    setMessage("");
    onClose();
  };

  return (
    <Dialog open={quote !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("sendQuoteTitle", { number: quote?.number ?? "" })}</DialogTitle>
          <DialogDescription>{result ? tr("sendQuoteDone") : tr("sendQuoteHelp")}</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            {result.emailed ? (
              <Alert data-testid="quote-emailed">
                <AlertDescription>{tr("quoteEmailed")}</AlertDescription>
              </Alert>
            ) : (
              <Alert data-testid="quote-not-emailed">
                <AlertDescription>{result.emailError ? tr("quoteNotEmailedReason", { reason: result.emailError }) : tr("quoteNotEmailed")}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="quote-share-url">{tr("quoteShareLink")}</Label>
              <div className="flex gap-2">
                <Input id="quote-share-url" readOnly dir="ltr" value={absoluteUrl} className="font-mono text-xs" data-testid="input-quote-share-url" />
                <Button type="button" variant="outline" size="icon" onClick={copy} aria-label={tr("copyLink")} data-testid="button-copy-quote-link">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={close}>{tr("done")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="quote-send-email">{tr("sendToEmail")}</Label>
              <Input id="quote-send-email" type="email" dir="ltr" placeholder={defaultEmail ?? tr("sendToEmailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-quote-send-email" />
              <p className="text-xs text-muted-foreground">{tr("sendToEmailHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote-send-message">{tr("sendMessage")}</Label>
              <Textarea id="quote-send-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} data-testid="input-quote-send-message" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                {tr("cancel")}
              </Button>
              <Button onClick={() => send.mutate()} disabled={send.isPending} data-testid="button-confirm-send-quote">
                <Send className="me-2 h-4 w-4" />
                {send.isPending ? tr("loading") : tr("sendQuote")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
