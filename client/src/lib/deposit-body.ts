/**
 * Customer deposit request bodies (STEP1 F1). Money on the wire is a major-unit (AED) decimal
 * string: the server validator `zPositiveFils` converts it to integer fils exactly once. Never
 * convert to fils here (that booked AED 1,050 as 105,000 and made "Apply" fail with 409).
 */
export const toWireAmount = (v: string) => v.trim();

export function depositBody(form: {
  customerName: string;
  date: string;
  amount: string;
  vatTreatment: string;
  paymentAccountId: string;
  reference: string;
}) {
  return {
    customerName: form.customerName,
    date: form.date,
    amount: toWireAmount(form.amount),
    vatTreatment: form.vatTreatment,
    paymentAccountId: form.paymentAccountId,
    reference: form.reference || null,
  };
}

export const applyBody = (invoiceId: string, amount: string) => ({
  invoiceId,
  amount: toWireAmount(amount),
});
