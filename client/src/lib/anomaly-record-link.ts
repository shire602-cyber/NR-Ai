// Step 1 / F8: an anomaly finding names the record it is about and links to it. The API sends the
// record's own number / merchant (`relatedLabel`); the page links by record type and id.

export interface AnomalyRecordRef {
  relatedType?: string | null;
  relatedId?: string | null;
  relatedLabel?: string | null;
  relatedLabelAr?: string | null;
  relatedDate?: string | null;
}

/** Where the record of an alert opens, by its type; null for a type with no page. */
export function anomalyRecordHref(
  type: string | null | undefined,
  id: string | null | undefined
): string | null {
  if (!type || !id) return null;
  switch (type) {
    case "invoice":
      return `/invoices?open=${encodeURIComponent(id)}`;
    case "journal_entry":
      return `/journal/${encodeURIComponent(id)}`;
    case "vendor_bill":
      return `/bill-pay/${encodeURIComponent(id)}/edit`;
    case "account":
      return `/accounts/${encodeURIComponent(id)}/ledger`;
    case "receipt":
      return "/receipts";
    default:
      return null;
  }
}

/**
 * The record an alert is about: its number or merchant (the Arabic account name in Arabic mode)
 * and its page. Null when the server could not name it (record gone or another company's), so the
 * row shows the plain record type instead of a dead link.
 */
export function anomalyRecordRef(
  anomaly: AnomalyRecordRef,
  locale: string
): { label: string; href: string | null } | null {
  const label = (locale === "ar" && anomaly.relatedLabelAr) || anomaly.relatedLabel;
  if (!label) return null;
  return { label, href: anomalyRecordHref(anomaly.relatedType, anomaly.relatedId) };
}
