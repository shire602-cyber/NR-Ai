import { useEffect, useState } from "react";
import { todayYmd as uaeToday } from "@/lib/calendar-date";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PaymentAccountSelect } from "./PaymentAccountSelect";
import { messages } from "./RecordPaymentDialog.i18n";

interface Props {
  companyId: string;
  runId: string | null;
  onClose: () => void;
}

const todayYmd = () => uaeToday();

/** The step after approval: the bank has paid, so Salaries Payable (2030) is cleared against the chosen bank account. */
export function RecordPaymentDialog({ companyId, runId, onClose }: Props) {
  const tr = messages.useT();
  const { toast } = useToast();
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayYmd());

  useEffect(() => {
    if (runId) {
      setAccountId("");
      setDate(todayYmd());
    }
  }, [runId]);

  const pay = useMutation({
    mutationFn: () => apiRequest("POST", `/api/payroll-runs/${runId}/record-payment`, { paymentAccountId: accountId, date }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/payroll-runs`] });
      queryClient.invalidateQueries({ queryKey: [`/api/payroll-runs/${runId}/items`] });
      toast({ title: tr("recorded"), description: tr("recordedBody") });
      onClose();
    },
    onError: (error: Error) => toast({ title: tr("failed"), description: error?.message, variant: "destructive" }),
  });

  return (
    <Dialog open={!!runId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("title")}</DialogTitle>
          <DialogDescription>{tr("help")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">{tr("account")}</label>
            <PaymentAccountSelect companyId={companyId} value={accountId} onChange={setAccountId} placeholder={tr("accountPlaceholder")} testId="select-payroll-payment-account" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">{tr("date")}</label>
            <Input type="date" value={date} max={todayYmd()} onChange={(e) => setDate(e.target.value)} data-testid="input-payroll-payment-date" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>{tr("cancel")}</Button>
          <Button onClick={() => pay.mutate()} disabled={!accountId || !date || pay.isPending} data-testid="button-confirm-payroll-payment">
            {pay.isPending ? tr("saving") : tr("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
