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
  deliveryLabelKey,
  recipientAcknowledgement,
  reportingLabelKey,
  trackOutcomeLabel,
  type DeliveryStatus,
  type EInvoiceListEvidence,
  type ReportingStatus,
} from "./einvoice-meta";
import { EInvoiceSheet, EInvoiceTrackBadges } from "./EInvoiceStatus";

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
  const showPills = !!pill?.reportingRequired;
  if (!doc && !invoice.einvoiceStatus && !showPills) return null;
  const storedDelivery: DeliveryStatus =
    pill?.delivery ??
    doc?.deliveryStatus ??
    deliveryFromLegacyStatus(doc?.status ?? invoice.einvoiceStatus);
  const queuedForSubmission = (doc?.status ?? invoice.einvoiceStatus) === "queued";
  const acknowledgement = recipientAcknowledgement(doc?.provider, doc?.providerStatus);
  const delivery =
    doc?.provider === "acube" && storedDelivery === "delivered" && !acknowledgement
      ? "queued"
      : storedDelivery;
  const storedReporting: ReportingStatus =
    pill?.reporting ?? (doc?.reportingStatus as ReportingStatus | null) ?? "pending";
  const confirmationUnavailable =
    doc?.provider === "acube" &&
    !!doc.providerMessageId &&
    (storedReporting === "pending" || storedReporting === "reported");
  const reporting = confirmationUnavailable ? "pending" : storedReporting;
  const obligationKnown = pill?.reportingObligationKnown ?? doc?.reportingObligationKnown;
  const deadline = reporting === "pending" ? pill?.reportBy : null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ms-1.5 inline-flex items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={`einvoice-cell-${invoice.id}`}
      >
        <span className="sr-only">{t["einvoicing.statusAction"]}: </span>
        {showPills && pill ? (
          <span
            className="inline-flex flex-wrap items-center gap-1"
            data-testid={`einvoice-compliance-${invoice.id}`}
          >
            <StatusBadge
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
                    reporting === "reported",
                    doc?.environment
                  )}
            </StatusBadge>
            {deadline && confirmationUnavailable && (
              <StatusBadge tone="neutral">{t["einvoicing.reportingUnconfirmed"]}</StatusBadge>
            )}
            <StatusBadge
              tone={acknowledgement === "received" ? "info" : DELIVERY_TONE[delivery]}
              data-testid={`einvoice-delivery-${invoice.id}`}
            >
              {delivery === "validated"
                ? t["einvoicing.delivery_validated_short"]
                : trackOutcomeLabel(
                    t,
                    deliveryLabelKey(delivery, queuedForSubmission, acknowledgement),
                    delivery === "delivered",
                    doc?.environment
                  )}
            </StatusBadge>
          </span>
        ) : (
          <EInvoiceTrackBadges
            delivery={delivery}
            reporting={reporting}
            queuedForSubmission={queuedForSubmission}
            acknowledgement={acknowledgement}
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
