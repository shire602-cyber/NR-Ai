/**
 * Statuses the invoice status dropdown may offer (mirrors PATCH /invoices/:id/status):
 * draft -> sent | void, sent -> void. paid / partial are results of recording payments (row menu
 * "Add payment"), never set by hand, so they are not offered; terminal states offer nothing.
 * The current status comes first so the control still shows it.
 */
export type InvoiceStatusTarget = "draft" | "sent" | "void";

export function invoiceStatusTargets(invoice: { status: string }): InvoiceStatusTarget[] {
  if (invoice.status === "draft") return ["draft", "sent", "void"];
  if (invoice.status === "sent") return ["sent", "void"];
  return [];
}
