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
  // X6d: with the mandate in force and a reportable (B2B) invoice, show the report-by date and
  // the reporting/delivery state; outside scope nothing is shown beyond an existing document.
  const showPills = !!compliance.data?.mandateApplies && !!pill?.reportingRequired;
  if (!doc && !invoice.einvoiceStatus && !showPills) return null;
  const delivery: DeliveryStatus =
    (doc?.deliveryStatus as DeliveryStatus | null) ??
    deliveryFromLegacyStatus(doc?.status ?? invoice.einvoiceStatus);
  const reporting: ReportingStatus =
    (doc?.reportingStatus as ReportingStatus | null) ??
    (doc?.status === "cleared" || invoice.einvoiceStatus === "cleared" ? "reported" : "pending");
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
              tone={pill.overdue ? "danger" : REPORTING_TONE[pill.reporting]}
              data-testid={`einvoice-reportby-${invoice.id}`}
            >
              {pill.reporting === "reported" || pill.reporting === "report_failed"
                ? t[reportingLabelKey(pill.reporting)]
                : pill.reportBy
                  ? formatMessage(
                      pill.overdue ? t["launchProof.reportOverdueShort"] : t["einvoicing.reportBy"],
                      { date: formatDate(pill.reportBy, locale) }
                    )
                  : t[reportingLabelKey(pill.reporting)]}
            </StatusBadge>
            <StatusBadge
              tone={DELIVERY_TONE[pill.delivery]}
              data-testid={`einvoice-delivery-${invoice.id}`}
            >
              {pill.delivery === "validated"
                ? t["einvoicing.delivery_validated_short"]
                : t[deliveryLabelKey(pill.delivery)]}
            </StatusBadge>
          </span>
        ) : (
          <EInvoiceTrackBadges delivery={delivery} reporting={reporting} />
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
