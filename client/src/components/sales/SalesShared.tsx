import { StatusBadge } from "@/components/ui/status-badge";
import { quoteStatusTone } from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";

// Small badges shared by the sales screens (the strings live in SalesShared.i18n.ts).

/** Marks the new document kinds in invoice lists: an advance (or deposit) invoice and a late-fee invoice. */
export function InvoiceTypeBadge({ invoiceType, className }: { invoiceType: string | null | undefined; className?: string }) {
  const tr = messages.useT();
  if (invoiceType === "advance") {
    return (
      <StatusBadge tone="accent" className={className} data-testid="invoice-type-advance">
        {tr("typeAdvance")}
      </StatusBadge>
    );
  }
  if (invoiceType === "late_fee") {
    return (
      <StatusBadge tone="warning" className={className} data-testid="invoice-type-late-fee">
        {tr("typeLateFee")}
      </StatusBadge>
    );
  }
  return null;
}

/** Quote lifecycle badge: draft, sent, accepted, declined, expired, converted. */
export function QuoteStatusBadge({ status }: { status: string }) {
  const tr = messages.useT();
  const label =
    status === "draft" ? tr("quoteDraft")
    : status === "sent" ? tr("quoteSent")
    : status === "accepted" ? tr("quoteAccepted")
    : status === "declined" ? tr("quoteDeclined")
    : status === "expired" ? tr("quoteExpired")
    : status === "converted" ? tr("quoteConverted")
    : status;
  return (
    <StatusBadge tone={quoteStatusTone(status)} data-testid={`quote-status-${status}`}>
      {label}
    </StatusBadge>
  );
}
