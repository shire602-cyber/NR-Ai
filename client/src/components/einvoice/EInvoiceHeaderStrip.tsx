/**
 * R1 (CTO final review, item 19): e-invoice state in the invoice editor header, not only in the
 * list drawer. Two-track chips (delivery to the customer, FTA reporting) with the report-by date,
 * and, when the document is not ready, an amber banner that names the missing field with a "Fix"
 * link. "Details" opens the full status sheet (checklist, history, resubmit).
 */
import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { einvoiceFieldHint } from "@/lib/einvoice-issues";
import { EInvoiceSheet, EInvoiceTrackBadges } from "./EInvoiceStatus";
import { errorKey, fieldLabelKey, rejectionSummary } from "./einvoice-meta";
import { useEInvoiceStatus } from "./use-einvoice";

/** Form control to focus for a validation issue field, or null when the fix is elsewhere. */
function focusTargetFor(field: string): string | null {
  switch (field) {
    case "invoice.customerName":
      return "input-customer-name";
    case "invoice.customerTrn":
      return "input-customer-trn";
    case "customer.address":
      return "select-invoice-contact";
    default:
      return null;
  }
}

export function EInvoiceHeaderStrip({
  invoiceId,
  invoiceNumber,
}: {
  invoiceId: string;
  invoiceNumber?: string | null;
}) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(false);
  const status = useEInvoiceStatus(invoiceId);
  const view = status.data;
  if (!view?.tracks) return null;
  const { delivery, reporting } = view.tracks;
  const first = view.issues[0];
  const firstLabelKey = first ? fieldLabelKey(first.field) : null;
  const firstLabel = first ? (firstLabelKey ? t[firstLabelKey] : first.field) : "";
  const reportMeta =
    reporting.required &&
    !reporting.confirmationUnavailable &&
    reporting.status !== "reported" &&
    reporting.reportBy
      ? formatMessage(
          reporting.overdue ? t["einvoicing.reportByPassed"] : t["einvoicing.reportBy"],
          {
            date: formatDate(reporting.reportBy, locale),
          }
        )
      : null;
  const rejection = rejectionSummary(view.rejection);
  const rejectionText = rejection
    ? rejection.message ||
      (errorKey(rejection.errorCode)
        ? t[errorKey(rejection.errorCode) as string]
        : t["einvoicing.err_unknown"])
    : null;
  const target = first ? focusTargetFor(first.field) : null;
  const fixHref = first ? einvoiceFieldHint(first.field, { contactId: view.contactId }).href : null;

  const fix = () => {
    const el = target
      ? (document.querySelector(`[data-testid="${target}"]`) as HTMLElement | null)
      : null;
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.focus({ preventScroll: true });
    } else {
      setOpen(true);
    }
  };

  return (
    <div className="space-y-3" data-testid="einvoice-header-strip">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-small font-medium text-foreground">
          {t["einvoicing.headerTitle"]}
        </span>
        <EInvoiceTrackBadges
          delivery={delivery.status}
          reporting={reporting.status}
          queuedForSubmission={view.submissionState === "queued"}
          acknowledgement={view.transmission.recipientAcknowledgement}
          confirmationUnavailable={reporting.confirmationUnavailable}
          showReportingLabel
        />
        {reportMeta && (
          <span
            className={
              reporting.overdue
                ? "text-caption font-medium text-warning-subtle-foreground"
                : "text-caption text-muted-foreground"
            }
            data-testid="einvoice-header-reportby"
          >
            {reportMeta}
          </span>
        )}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="ms-auto h-auto p-0"
          onClick={() => setOpen(true)}
          data-testid="einvoice-header-details"
        >
          {t["einvoicing.headerDetails"]}
        </Button>
      </div>
      {rejection && (
        <div
          className="flex items-center gap-3 rounded-lg border border-danger/40 bg-danger-subtle p-3"
          role="alert"
          data-testid="einvoice-header-rejection"
        >
          <XCircle aria-hidden className="h-4 w-4 shrink-0 text-danger" />
          <p className="min-w-0 flex-1 truncate text-small text-danger-subtle-foreground">
            <span className="font-medium">
              {view.tracks.delivery.status === "rejected"
                ? t["einvoicing.headerRejected"]
                : t["einvoicing.headerDeliveryFailed"]}
              {": "}
            </span>
            <span dir="auto" title={rejectionText ?? undefined}>
              {rejectionText}
            </span>
            {(rejection.field || rejection.rule) && (
              <span className="text-caption text-muted-foreground">
                {" ("}
                <span dir="ltr" className="[unicode-bidi:isolate]">
                  {rejection.field ?? rejection.rule}
                </span>
                {")"}
              </span>
            )}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
            data-testid="einvoice-header-resubmit"
          >
            {t[view.rejection?.resubmittable ? "einvoicing.resubmit" : "einvoicing.headerDetails"]}
          </Button>
        </div>
      )}
      {first && (
        <div
          className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning-subtle p-3"
          role="status"
          data-testid="einvoice-header-issue"
        >
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-small text-warning-subtle-foreground">
            {view.issues.length === 1
              ? formatMessage(t["einvoicing.headerIssueOne"], { field: firstLabel })
              : formatMessage(t["einvoicing.headerIssueMany"], {
                  field: firstLabel,
                  count: view.issues.length - 1,
                })}
          </p>
          {fixHref ? (
            <Button asChild size="sm" variant="outline">
              <Link href={fixHref} data-testid="einvoice-header-fix">
                {t["einvoicing.headerFix"]}
              </Link>
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={fix}
              data-testid="einvoice-header-fix"
            >
              {t["einvoicing.headerFix"]}
            </Button>
          )}
        </div>
      )}
      {open && (
        <EInvoiceSheet
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  );
}
