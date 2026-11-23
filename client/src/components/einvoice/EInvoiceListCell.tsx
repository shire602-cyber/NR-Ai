/**
 * E1: e-invoice cell for the invoice list (two-track badges; opens the status sheet) and the
 * "E-invoice" origin tag for bills that arrived as structured e-invoices. The list passes
 * each row's evidence from its page query.
 */
import { useState } from "react";
import { FileCode } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import {
  DELIVERY_TONE,
  REPORTING_TONE,
  deliveryFromLegacyStatus,
  deliveryOutcomeLabel,
  recipientAcknowledgement,
  reportingLabelKey,
  reportingOutcomeConfirmed,
  trackOutcomeLabel,
  type DeliveryStatus,
  type EInvoiceListEvidence,
  type ReportingStatus,
} from "./einvoice-meta";
import { EInvoiceSheet } from "./EInvoiceSheet";
import { EInvoiceTrackBadges } from "./EInvoiceTrackBadges";

export function EInvoiceListCell({
  invoice,
  evidence,
  onEdit,
}: {
  invoice: { id: string; number?: string | null; einvoiceStatus?: string | null };
  evidence?: EInvoiceListEvidence;
  onEdit?: () => void;
}) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(false);
  const { pill, doc } = evidence ?? {};
  if (pill?.delivery === "not_applicable" || doc?.deliveryStatus === "not_applicable") {
    return (
      <StatusBadge tone="neutral" data-testid={`einvoice-cell-${invoice.id}`}>
        {t["einvoicing.reporting_not_required"]}
      </StatusBadge>
    );
  }
  const showPills = !!pill?.reportingRequired;
  if (!doc && !invoice.einvoiceStatus && !showPills) return null;
  const storedStatus = doc?.status ?? invoice.einvoiceStatus;
  const projectedDelivery = pill?.delivery ?? doc?.deliveryStatus;
  const storedDelivery: DeliveryStatus =
    projectedDelivery ?? deliveryFromLegacyStatus(storedStatus);
  const queuedForSubmission = storedStatus === "queued";
  const providerAcknowledgement = recipientAcknowledgement(doc?.provider, doc?.providerStatus);
  const deliveryConfirmationUnavailable =
    pill?.deliveryConfirmationUnavailable ||
    doc?.deliveryConfirmationUnavailable ||
    (!projectedDelivery && (storedStatus === "accepted" || storedStatus === "cleared")) ||
    (storedDelivery === "delivered" && (!providerAcknowledgement || !doc?.providerMessageId));
  const delivery = deliveryConfirmationUnavailable ? "queued" : storedDelivery;
  const acknowledgement = delivery === "delivered" ? providerAcknowledgement : null;
  const storedReporting: ReportingStatus =
    pill?.reporting ?? (doc?.reportingStatus as ReportingStatus | null) ?? "pending";
  const confirmationUnavailable =
    doc?.provider === "acube" &&
    !!doc.providerMessageId &&
    (storedReporting === "pending" || storedReporting === "reported");
  const reporting = confirmationUnavailable ? "pending" : storedReporting;
  const obligationKnown = pill?.reportingObligationKnown ?? doc?.reportingObligationKnown ?? false;
  const deadline = reporting === "pending" ? pill?.reportBy : null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ms-1.5 inline-flex min-w-0 max-w-full items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={`einvoice-cell-${invoice.id}`}
      >
        <span className="sr-only">{t["einvoicing.statusAction"]}: </span>
        {showPills && pill ? (
          <span
            className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1"
            data-testid={`einvoice-compliance-${invoice.id}`}
          >
            <StatusBadge
              className="einvoice-status-badge"
              tone={pill.overdue && deadline ? "danger" : REPORTING_TONE[reporting]}
              data-testid={`einvoice-reportby-${invoice.id}`}
            >
              {deadline
                ? formatMessage(
                    pill.overdue ? t["launchProof.reportOverdueShort"] : t["einvoicing.reportBy"],
                    { date: formatDate(deadline, locale) }
                  )
                : trackOutcomeLabel(
                    t,
                    reportingLabelKey(reporting, confirmationUnavailable, obligationKnown),
                    reportingOutcomeConfirmed(reporting, confirmationUnavailable),
                    doc?.environment
                  )}
            </StatusBadge>
            {deadline && confirmationUnavailable && (
              <StatusBadge className="einvoice-status-badge" tone="neutral">
                {t["einvoicing.reportingUnconfirmed"]}
              </StatusBadge>
            )}
            <StatusBadge
              className="einvoice-status-badge"
              tone={
                deliveryConfirmationUnavailable
                  ? "neutral"
                  : acknowledgement === "received"
                    ? "info"
                    : DELIVERY_TONE[delivery]
              }
              data-testid={`einvoice-delivery-${invoice.id}`}
            >
              {delivery === "validated"
                ? t["einvoicing.delivery_validated_short"]
                : deliveryOutcomeLabel(t, delivery, {
                    queuedForSubmission,
                    acknowledgement,
                    confirmationUnavailable: deliveryConfirmationUnavailable,
                    environment: doc?.environment,
                  })}
            </StatusBadge>
          </span>
        ) : (
          <EInvoiceTrackBadges
            delivery={delivery}
            reporting={reporting}
            queuedForSubmission={queuedForSubmission}
            acknowledgement={acknowledgement}
            deliveryConfirmationUnavailable={deliveryConfirmationUnavailable}
            confirmationUnavailable={confirmationUnavailable}
            obligationKnown={obligationKnown}
            environment={doc?.environment}
          />
        )}
      </button>
      {open && (
        <EInvoiceSheet
          invoiceId={invoice.id}
          invoiceNumber={invoice.number}
          open={open}
          onOpenChange={setOpen}
          onEdit={
            onEdit
              ? () => {
                  setOpen(false);
                  onEdit();
                }
              : undefined
          }
        />
      )}
    </>
  );
}

/** "E-invoice" tag on a bill created from a received structured e-invoice. */
export function EInvoiceOriginTag({ origin }: { origin?: string | null }) {
  const { t } = useTranslation();
  if (origin !== "einvoice") return null;
  return (
    <StatusBadge tone="info" className="ms-2 gap-1" data-testid="bill-einvoice-tag">
      <FileCode aria-hidden className="h-3 w-3" />
      {t["einvoicing.originTag"]}
    </StatusBadge>
  );
}
