/**
 * E1: e-invoice cell for the invoice list (two-track badges; opens the status sheet) and the
 * "E-invoice" origin tag for bills that arrived as structured e-invoices. One shared query
 * per company (react-query dedupes it across rows).
 */
import { useMemo, useState } from "react";
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
  type DeliveryStatus,
  type ReportingStatus,
} from "./einvoice-meta";
import { EInvoiceSheet, EInvoiceTrackBadges } from "./EInvoiceStatus";
import { useEInvoiceCompliance, useEInvoiceDocuments } from "./use-einvoice";

export function EInvoiceListCell({
  companyId,
  invoice,
  onEdit,
}: {
  companyId: string | null | undefined;
  invoice: { id: string; number?: string | null; einvoiceStatus?: string | null };
  onEdit?: () => void;
}) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(false);
  const docs = useEInvoiceDocuments(companyId);
  const compliance = useEInvoiceCompliance(companyId);
  const pill = useMemo(
    () => compliance.data?.items.find((p) => p.invoiceId === invoice.id),
    [compliance.data, invoice.id]
  );
  const doc = useMemo(
    () => docs.data?.items.find((d) => d.invoiceId === invoice.id),
    [docs.data, invoice.id]
  );
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
              tone={pill.overdue && !confirmationUnavailable ? "danger" : REPORTING_TONE[reporting]}
              data-testid={`einvoice-reportby-${invoice.id}`}
            >
              {confirmationUnavailable || reporting === "reported" || reporting === "report_failed"
                ? t[reportingLabelKey(reporting, confirmationUnavailable)]
                : pill.reportBy
                  ? formatMessage(
                      pill.overdue ? t["launchProof.reportOverdueShort"] : t["einvoicing.reportBy"],
                      { date: formatDate(pill.reportBy, locale) }
                    )
                  : t[reportingLabelKey(reporting)]}
            </StatusBadge>
            <StatusBadge
              tone={acknowledgement === "received" ? "info" : DELIVERY_TONE[delivery]}
              data-testid={`einvoice-delivery-${invoice.id}`}
            >
              {delivery === "validated"
                ? t["einvoicing.delivery_validated_short"]
                : t[deliveryLabelKey(delivery, queuedForSubmission, acknowledgement)]}
            </StatusBadge>
          </span>
        ) : (
          <EInvoiceTrackBadges
            delivery={delivery}
            reporting={reporting}
            queuedForSubmission={queuedForSubmission}
            acknowledgement={acknowledgement}
            confirmationUnavailable={confirmationUnavailable}
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
