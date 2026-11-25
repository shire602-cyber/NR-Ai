/**
 * X6d: "Ask Najma Al Raeda" handoff. Opens a dialog that shows exactly what will be sent (topic,
 * period and key figures), lets the customer add a note, and stores the request in-app through
 * POST /api/companies/:id/najma-handoff. No email provider is connected for this, so the success
 * state says the request is saved in Muhasib and shows the firm contact (Sara, support@muhasib.ai).
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { apiRequest } from "@/lib/queryClient";

export type HandoffTopic = "vat201" | "corporate_tax" | "year_end_close" | "einvoice";

export interface HandoffFigure {
  label: string;
  value: string;
}

interface HandoffResult {
  id: string;
  storedInApp: boolean;
  emailSent: boolean;
  contact: { name: string; email: string };
}

export const NAJMA_SUPPORT_EMAIL = "support@muhasib.ai";

export function AskNajmaButton({
  companyId,
  topic,
  period,
  reference,
  figures = [],
  size = "sm",
  variant = "outline",
  testId = "button-ask-najma",
}: {
  companyId: string | null | undefined;
  topic: HandoffTopic;
  /** Human period label, e.g. "2026-01-01 to 2026-03-31". */
  period?: string;
  /** Return, invoice or document number the request is about. */
  reference?: string;
  figures?: HandoffFigure[];
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "default";
  testId?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const send = useMutation<HandoffResult>({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/najma-handoff`, {
        topic,
        ...(period ? { period } : {}),
        ...(reference ? { reference } : {}),
        figures,
        ...(note.trim() ? { note: note.trim() } : {}),
        page: typeof window !== "undefined" ? window.location.pathname : undefined,
      }),
  });
  if (!companyId) return null;
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      send.reset();
      setNote("");
    }
  };
  const done = send.data;
  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        onClick={() => setOpen(true)}
        data-testid={testId}
      >
        <LifeBuoy aria-hidden className="me-1.5 h-4 w-4" />
        {t["launchProof.askNajma"]}
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent data-testid="ask-najma-dialog">
          <DialogHeader>
            <DialogTitle>{t["launchProof.askTitle"]}</DialogTitle>
            <DialogDescription>
              {done ? t["launchProof.askSavedLead"] : t["launchProof.askIntro"]}
            </DialogDescription>
          </DialogHeader>
          {done ? (
            <div className="space-y-2 text-small" data-testid="ask-najma-sent">
              <p className="font-medium text-foreground">{t["launchProof.askSaved"]}</p>
              <p className="text-muted-foreground">
                {formatMessage(t["launchProof.askSavedBody"], {
                  id: done.id.slice(0, 8),
                  name: t["launchProof.contactName"],
                  email: done.contact.email,
                })}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <dl
                className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-small"
                data-testid="ask-najma-summary"
              >
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t["launchProof.askTopic"]}</dt>
                  <dd className="font-medium">{t[`launchProof.topic_${topic}`]}</dd>
                </div>
                {period && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t["launchProof.askPeriod"]}</dt>
                    <dd className="font-medium tabular-nums" dir="ltr">
                      {period}
                    </dd>
                  </div>
                )}
                {reference && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{t["launchProof.askReference"]}</dt>
                    <dd className="font-medium tabular-nums" dir="ltr">
                      {reference}
                    </dd>
                  </div>
                )}
                {figures.map((f) => (
                  <div key={f.label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd className="font-medium tabular-nums" dir="ltr">
                      {f.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <label className="block space-y-1 text-small">
                <span className="text-muted-foreground">{t["launchProof.askNote"]}</span>
                <Textarea
                  value={note}
                  maxLength={1000}
                  onChange={(e) => setNote(e.target.value)}
                  data-testid="ask-najma-note"
                />
              </label>
              <p className="text-caption text-muted-foreground">
                {formatMessage(t["launchProof.askNoEmail"], {
                  name: t["launchProof.contactName"],
                  email: NAJMA_SUPPORT_EMAIL,
                })}
              </p>
              {send.isError && (
                <p role="alert" className="text-small text-destructive">
                  {formatMessage(t["launchProof.askFailed"], { email: NAJMA_SUPPORT_EMAIL })}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            {done ? (
              <Button type="button" onClick={() => close(false)}>
                {t["launchProof.askClose"]}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => close(false)}>
                  {t["launchProof.askCancel"]}
                </Button>
                <Button
                  type="button"
                  onClick={() => send.mutate()}
                  disabled={send.isPending}
                  data-testid="ask-najma-send"
                >
                  {t["launchProof.askSend"]}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
