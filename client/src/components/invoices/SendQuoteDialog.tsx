import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface SendQuoteOutcome {
  sent: boolean;
  status: string;
  quoteStatus: string;
}

/**
 * WQ1 (7.5): email a quote. The server attaches the PDF and, for a quote with a contact, a
 * customer-portal link to accept or decline it; the message goes through the email outbox, so
 * without an email provider it is queued and the toast says so (never "sent").
 */
export function SendQuoteDialog({
  quote,
  companyId,
  defaultEmail,
  onClose,
}: {
  quote: { id: string; number: string } | null;
  companyId: string | undefined;
  defaultEmail?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [to, setTo] = useState(defaultEmail ?? "");
  const [message, setMessage] = useState("");
  const send = useMutation({
    mutationFn: (): Promise<SendQuoteOutcome> =>
      apiRequest("POST", `/api/quotes/${quote!.id}/send-email`, {
        to: to.trim(),
        ...(message.trim() ? { message: message.trim() } : {}),
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "quotes"] });
      toast(
        r.sent
          ? {
              title: t["invoices.quoteSend.sentTitle"],
              description: formatMessage(t["invoices.quoteSend.sentBody"], { to: to.trim() }),
            }
          : {
              title: t["invoices.quoteSend.queuedTitle"],
              description:
                r.status === "blocked_no_provider"
                  ? t["invoices.quoteSend.noProvider"]
                  : t["invoices.quoteSend.queuedBody"],
            }
      );
      onClose();
    },
    onError: (error: Error) =>
      toast({
        variant: "destructive",
        title: t["invoices.quoteSend.failed"],
        description: error?.message,
      }),
  });
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  return (
    <Dialog open={!!quote} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-send-quote">
        <DialogHeader>
          <DialogTitle>
            {formatMessage(t["invoices.quoteSend.title"], { number: quote?.number ?? "" })}
          </DialogTitle>
          <DialogDescription>{t["invoices.quoteSend.desc"]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="send-quote-to">{t["invoices.quoteSend.to"]}</Label>
            <Input
              id="send-quote-to"
              type="email"
              ltr
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-send-quote-to"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="send-quote-message">{t["invoices.quoteSend.message"]}</Label>
            <Textarea
              id="send-quote-message"
              dir="auto"
              rows={4}
              maxLength={5000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t["invoices.quoteSend.messagePlaceholder"]}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t["invoices.quoteSend.cancel"]}
          </Button>
          <Button
            type="button"
            disabled={!valid || send.isPending}
            onClick={() => send.mutate()}
            data-testid="button-send-quote"
          >
            <Send className="h-4 w-4" aria-hidden />
            {t["invoices.quoteSend.send"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
