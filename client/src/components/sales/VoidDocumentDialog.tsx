import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayYmd, uaeDayOf, formatCalendarDate } from "@/lib/calendar-date";
import { useTranslation } from "@/lib/i18n";
import { messages } from "./SalesShared.i18n";

export interface VoidTarget {
  id: string;
  number: string;
  date?: string | Date | null;
  invoiceType?: string | null;
}

interface Props {
  target: VoidTarget | null;
  pending?: boolean;
  onClose: () => void;
  /** `date` is undefined when the default was kept: the server then picks the document's own date (or the first open day). */
  onConfirm: (target: VoidTarget, date: string | undefined) => void;
}

/** What the reversal date of a void means, and a way to change it: the default is decided by the server. */
export function VoidDocumentDialog({ target, pending, onClose, onConfirm }: Props) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const documentDay = target ? uaeDayOf(target.date) : "";
  const [date, setDate] = useState("");
  useEffect(() => setDate(documentDay), [documentDay, target?.id]);
  const changed = !!date && date !== documentDay;
  const valid = !date || (date >= documentDay && date <= todayYmd());
  const isCreditNote = target?.invoiceType === "credit_note";

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="void-document-dialog">
        <DialogHeader>
          <DialogTitle>{isCreditNote ? tr("voidCreditNoteTitle", { number: target?.number ?? "" }) : tr("voidInvoiceTitle", { number: target?.number ?? "" })}</DialogTitle>
          <DialogDescription>{tr("voidDocumentHelp")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="void-date">{tr("voidDateLabel")}</Label>
          <Input
            id="void-date"
            type="date"
            dir="ltr"
            min={documentDay || undefined}
            max={todayYmd()}
            value={date}
            aria-invalid={!valid}
            onChange={(e) => setDate(e.target.value)}
            data-testid="input-void-date"
          />
          <p className="text-xs text-muted-foreground" data-testid="void-date-hint">
            {changed ? tr("voidDateChosen", { date: formatCalendarDate(date, locale) }) : tr("voidDateDefault", { date: formatCalendarDate(documentDay, locale) })}
          </p>
          {!valid && (
            <p role="alert" className="text-xs text-destructive">{tr("voidDateProblem")}</p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>{tr("cancel")}</Button>
          <Button variant="destructive" disabled={!valid || pending} onClick={() => target && onConfirm(target, changed ? date : undefined)} data-testid="button-confirm-void">
            {tr("voidConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
