/**
 * Which row actions an invoice offers. A draft is not issued yet: it has no payments, no e-invoice
 * and nothing to credit, so those actions are hidden until it is issued (X6b).
 */
export function invoiceRowActions(invoice: {
  status?: string | null;
  invoiceType?: string | null;
}) {
  const issued = invoice.status !== "draft";
  return {
    // A credit note is not paid: it reduces the invoice it credits (E1, J1-r2).
    canRecordPayment: issued && invoice.invoiceType !== "credit_note",
    canGenerateEinvoice: issued,
    canCreateCreditNote: issued && invoice.invoiceType !== "credit_note",
  };
}
