import { Landmark } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  DELIVERY_TONE,
  REPORTING_TONE,
  deliveryOutcomeLabel,
  reportingLabelKey,
  reportingObligationUnknown,
  trackOutcomeLabel,
  type DeliveryStatus,
  type RecipientAcknowledgement,
  type ReportingStatus,
} from "./einvoice-meta";
import "./einvoice-theme.css";

export function EInvoiceTrackBadges({
  delivery,
  reporting,
  className,
  testId,
  showReportingLabel = false,
  queuedForSubmission = false,
  acknowledgement = null,
  deliveryConfirmationUnavailable = false,
  confirmationUnavailable = false,
  obligationKnown,
  environment,
}: {
  delivery: DeliveryStatus;
  reporting: ReportingStatus;
  className?: string;
  testId?: string;
  queuedForSubmission?: boolean;
  acknowledgement?: RecipientAcknowledgement;
  deliveryConfirmationUnavailable?: boolean;
  confirmationUnavailable?: boolean;
  obligationKnown?: boolean;
  environment?: string | null;
  /** Spell the FTA reporting state out ("FTA: Pending") instead of the icon-only mark. */
  showReportingLabel?: boolean;
}) {
  const { t } = useTranslation();
  // The list cell is narrow: "Validated, not sent" reads "Not sent" there.
  const deliveryText =
    delivery === "validated"
      ? t["einvoicing.delivery_validated_short"]
      : deliveryOutcomeLabel(t, delivery, {
          queuedForSubmission,
          acknowledgement,
          confirmationUnavailable: deliveryConfirmationUnavailable,
          environment,
        });
  const reportingConfirmed = reporting === "reported" && !confirmationUnavailable;
  const obligationUnknown = reportingObligationUnknown(reporting, obligationKnown);
  const reportingKey = reportingLabelKey(reporting, confirmationUnavailable, obligationKnown);
  const reportingText = trackOutcomeLabel(t, reportingKey, reportingConfirmed, environment);
  const reportingChipKey =
    obligationUnknown || confirmationUnavailable
      ? reportingKey
      : reporting === "pending" &&
          (delivery === "draft" || delivery === "validated" || queuedForSubmission)
        ? "einvoicing.ftaChip_not_sent"
        : `einvoicing.ftaChip_${reporting}`;
  const showReportingText =
    showReportingLabel || obligationUnknown || (reportingConfirmed && environment !== "production");
  return (
    <span
      className={cn("inline-flex min-w-0 max-w-full flex-wrap items-center gap-1", className)}
      data-testid={testId}
    >
      <StatusBadge
        className="einvoice-status-badge"
        tone={
          deliveryConfirmationUnavailable
            ? "neutral"
            : acknowledgement === "received"
              ? "info"
              : DELIVERY_TONE[delivery]
        }
        title={`${t["einvoicing.trackDelivery"]}: ${deliveryText}`}
      >
        <span className="sr-only">{t["einvoicing.trackDelivery"]}: </span>
        {deliveryText}
      </StatusBadge>
      {(reporting !== "not_required" || obligationUnknown) && (
        <StatusBadge
          tone={obligationUnknown ? "neutral" : REPORTING_TONE[reporting]}
          title={`${t["einvoicing.trackReporting"]}: ${reportingText}`}
          className={showReportingText ? "einvoice-status-badge" : "px-1.5"}
          data-testid={showReportingLabel ? "einvoice-fta-chip" : undefined}
        >
          {/* Always keep a test environment or unknown obligation visible on the badge. */}
          <Landmark aria-hidden className="h-3 w-3" />
          {showReportingText ? (
            <span>{trackOutcomeLabel(t, reportingChipKey, reportingConfirmed, environment)}</span>
          ) : (
            <span className="sr-only">
              {t["einvoicing.trackReporting"]}: {reportingText}
            </span>
          )}
        </StatusBadge>
      )}
    </span>
  );
}
