/**
 * E1: e-invoice cell for the invoice list (two-track badges; opens the status sheet) and the
 * "E-invoice" origin tag for bills that arrived as structured e-invoices. One shared query
 * per company (react-query dedupes it across rows).
 */
import { useMemo, useState } from "react";
import { FileCode } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { useTranslation } from "@/lib/i18n";
import {
  deliveryFromLegacyStatus,
  type DeliveryStatus,
  type ReportingStatus,
} from "./einvoice-meta";
import { EInvoiceSheet, EInvoiceTrackBadges } from "./EInvoiceStatus";
import { useEInvoiceDocuments } from "./use-einvoice";

export function EInvoiceListCell({
  companyId,
  invoice,
  onEdit,
}: {
  companyId: string | null | undefined;
  invoice: { id: string; number?: string | null; einvoiceStatus?: string | null };
  onEdit?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const docs = useEInvoiceDocuments(companyId);
  const doc = useMemo(
    () => docs.data?.items.find((d) => d.invoiceId === invoice.id),
    [docs.data, invoice.id]
  );
  if (!doc && !invoice.einvoiceStatus) return null;
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
        <EInvoiceTrackBadges delivery={delivery} reporting={reporting} />
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
