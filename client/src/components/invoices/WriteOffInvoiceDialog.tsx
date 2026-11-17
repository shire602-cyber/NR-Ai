import { useState } from "react";
import { uaeToday } from "@shared/uae-date";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";

/**
 * A3 (H1): write off an uncollectible invoice (IFRS 9.5.4.4). The server posts
 * Dr bad-debt expense / Cr receivables and settles the invoice; VAT bad-debt relief
 * (Art. 64) is claimed separately from the VAT page once the conditions are met.
 */
export function WriteOffInvoiceDialog(props: {
  invoice: { id: string; number: string } | null;
  companyId: string | undefined;
  onClose: () => void;
}) {
  return <WriteOffInvoiceDialogBody key={props.invoice?.id ?? "none"} {...props} />;
}

function WriteOffInvoiceDialogBody({
  invoice,
  companyId,
  onClose,
}: {
  invoice: { id: string; number: string } | null;
  companyId: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [date, setDate] = useState(() => uaeToday());
  const [reason, setReason] = useState("");

  const writeOff = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/invoices/${invoice!.id}/write-off`, {
        date,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "invoices"] });
      toast({
        title: t["invoices.writeOffDone"],
        description: formatMessage(t["invoices.writeOffDoneBody"], {
          number: invoice?.number ?? "",
        }),
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t["invoices.writeOffFailed"],
        description: error?.message,
      });
    },
  });

  return (
    <Dialog open={!!invoice} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {formatMessage(t["invoices.writeOffTitle"], { number: invoice?.number ?? "" })}
          </DialogTitle>
          <DialogDescription>{t["invoices.writeOffDescription"]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="write-off-date">{t["invoices.writeOffDate"]}</Label>
            <DatePicker id="write-off-date" value={date} onChange={setDate} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="write-off-reason">{t["invoices.writeOffReason"]}</Label>
            <Textarea
              id="write-off-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid="input-write-off-reason"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t["invoices.writeOffCancel"]}
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 3 || !date || writeOff.isPending}
            onClick={() => writeOff.mutate()}
            data-testid="button-confirm-write-off"
          >
            {t["invoices.writeOffConfirm"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
