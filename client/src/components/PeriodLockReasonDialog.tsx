import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMessage, useTranslation } from "@/lib/i18n";
import {
  MIN_LOCK_REASON_LENGTH,
  registerLockReasonPrompter,
  type SoftLockInfo,
} from "@/lib/period-lock-reason";

/**
 * X5 (J1 D3): asks an owner / accountant for the reason to post into a soft-locked period.
 * apiRequest replays the refused request with the reason (lib/period-lock-reason.ts).
 */
export function PeriodLockReasonDialog() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<SoftLockInfo | null>(null);
  const [reason, setReason] = useState("");
  const resolver = useRef<((value: string | null) => void) | null>(null);

  useEffect(
    () =>
      registerLockReasonPrompter(
        (next) =>
          new Promise<string | null>((resolve) => {
            resolver.current?.(null);
            resolver.current = resolve;
            setReason("");
            setInfo(next);
          })
      ),
    []
  );

  const finish = (value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setInfo(null);
  };

  const valid = reason.trim().length >= MIN_LOCK_REASON_LENGTH;
  const description = info?.lockedThrough
    ? formatMessage(t["components.periodLock.descriptionThrough"], { date: info.lockedThrough })
    : t["components.periodLock.description"];

  return (
    <Dialog open={!!info} onOpenChange={(open) => !open && finish(null)}>
      <DialogContent size="md" data-testid="dialog-period-lock-reason">
        <DialogHeader>
          <DialogTitle>{t["components.periodLock.title"]}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) finish(reason.trim());
          }}
        >
          <Label htmlFor="period-lock-reason">{t["components.periodLock.reasonLabel"]}</Label>
          <Textarea
            id="period-lock-reason"
            data-testid="input-period-lock-reason"
            dir="auto"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t["components.periodLock.reasonPlaceholder"]}
            autoFocus
          />
          <p className="text-sm text-muted-foreground">{t["components.periodLock.auditNote"]}</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              {t["components.periodLock.cancel"]}
            </Button>
            <Button type="submit" disabled={!valid} data-testid="button-period-lock-post">
              {t["components.periodLock.post"]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
