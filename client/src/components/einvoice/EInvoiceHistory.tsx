import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDate } from "@/lib/format-date";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  deliveryOutcomeLabel,
  errorKey,
  reportingLabelKey,
  trackOutcomeLabel,
  sourceKey,
  type DeliveryStatus,
  type EInvoiceStatusView,
  type ReportingStatus,
} from "./einvoice-meta";

function eventLabel(e: EInvoiceStatusView["events"][number], t: Record<string, string>) {
  if (e.track === "validation") {
    return e.to === "passed" ? t["einvoicing.historyValidated"] : t["einvoicing.historyInvalid"];
  }
  const track =
    e.track === "delivery" ? t["einvoicing.trackDelivery"] : t["einvoicing.trackReporting"];
  const label =
    e.track === "delivery"
      ? deliveryOutcomeLabel(t, e.to as DeliveryStatus, {
          queuedForSubmission: e.to === "queued" && e.providerStatus === null,
          acknowledgement: e.recipientAcknowledgement,
          confirmationUnavailable: e.confirmationUnavailable,
          environment: e.environment,
        })
      : trackOutcomeLabel(
          t,
          reportingLabelKey(e.to as ReportingStatus, e.confirmationUnavailable),
          e.to === "reported" || e.to === "report_failed",
          e.environment
        );
  return `${track}: ${label ?? e.to}`;
}

export default function EInvoiceHistory({
  view,
  open,
  onOpenChange,
}: {
  view: EInvoiceStatusView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useTranslation();
  const timeFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-AE-u-nu-latn" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={locale === "ar" ? "left" : "right"}
        className="einvoice-surface w-full overflow-y-auto sm:max-w-md"
        data-testid="einvoice-history"
      >
        <SheetHeader>
          <SheetTitle>{t["einvoicing.historyTitle"]}</SheetTitle>
          <SheetDescription>{t["einvoicing.historyDescription"]}</SheetDescription>
        </SheetHeader>
        {view.events.length === 0 ? (
          <p className="mt-6 text-small text-muted-foreground">{t["einvoicing.historyEmpty"]}</p>
        ) : (
          <ol className="mt-6 space-y-4 border-s border-border ps-4">
            {view.events.map((e) => {
              const err = errorKey(e.code);
              const failed =
                e.to === "rejected" ||
                e.to === "delivery_failed" ||
                e.to === "report_failed" ||
                (e.track === "validation" && e.to === "failed");
              return (
                <li key={e.id} className="relative">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -start-[1.3rem] top-1.5 h-2 w-2 rounded-full",
                      failed ? "bg-danger" : "bg-muted-foreground"
                    )}
                  />
                  <p className="text-small font-medium">{eventLabel(e, t)}</p>
                  <p className="text-caption text-muted-foreground">
                    {e.at ? `${formatDate(e.at, locale)} · ${timeFmt.format(new Date(e.at))}` : ""}
                    {" · "}
                    {t[sourceKey(e.source)] ?? e.source}
                    {e.providerStatus ? (
                      <>
                        {" · "}
                        <span dir="ltr" className="[unicode-bidi:isolate]">
                          {e.providerStatus}
                        </span>
                      </>
                    ) : null}
                  </p>
                  {(err || e.message) && failed && (
                    <p className="mt-1 text-caption text-danger-subtle-foreground">
                      {err ? t[err] : e.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </SheetContent>
    </Sheet>
  );
}
