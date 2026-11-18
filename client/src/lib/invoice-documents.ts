/**
 * WQ1: helpers of the invoice editor's documents parts (terms label, attachments upload, the
 * sent / viewed log's honest email status).
 */
import { formatMessage } from "./i18n";
import { apiRequest } from "./queryClient";
import { daysFromTerms } from "@shared/sales-documents";

/** The label of a terms code ("Due on receipt", "Net 30"). */
export function paymentTermsLabel(t: Record<string, string>, terms: string): string {
  if (terms === "due_on_receipt") return t["invoices.terms.dueOnReceipt"];
  const days = daysFromTerms(terms);
  return days === null ? terms : formatMessage(t["invoices.terms.net"], { days });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Upload one file to a saved invoice. */
export async function uploadInvoiceAttachment(invoiceId: string, file: File) {
  return apiRequest("POST", `/api/invoices/${invoiceId}/attachments`, {
    fileName: file.name.slice(0, 255),
    data: await fileToDataUrl(file),
  });
}

export function attachmentSizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

/** The honest label of an email's outbox status: only a provider-accepted email is "sent". */
export function emailStatusKey(item: { status: string | null; sent: boolean }): string {
  if (item.sent) return "invoices.activity.statusSent";
  if (item.status === "blocked_no_provider") return "invoices.activity.statusNoProvider";
  if (item.status === "failed" || item.status === "dead" || item.status === "bounced")
    return "invoices.activity.statusFailed";
  return "invoices.activity.statusQueued";
}
