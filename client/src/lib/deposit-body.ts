/**
 * Customer deposit request bodies and form validation (STEP1 F1). Money on the wire is a
 * major-unit (AED) decimal string: the server validator `zPositiveFils` converts it to integer
 * fils exactly once. Never convert to fils here (that booked AED 1,050 as 105,000 and made
 * "Apply" fail with 409).
 */
export const toWireAmount = (v: string) => v.trim();

export interface DepositForm {
  contactId: string;
  date: string;
  amount: string;
  vatTreatment: string;
  paymentAccountId: string;
  reference: string;
}

/** The customer is picked from the contacts: the server fills the name and TRN from the contact. */
export function depositBody(form: DepositForm) {
  return {
    contactId: form.contactId,
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

export type DepositField = "contactId" | "date" | "amount" | "paymentAccountId";

/** Field-level problems (a catalog-key suffix per field), empty when the form can be submitted. */
export function validateDeposit(
  form: DepositForm
): Partial<Record<DepositField, "required" | "amount">> {
  const errors: Partial<Record<DepositField, "required" | "amount">> = {};
  if (!form.contactId) errors.contactId = "required";
  if (!form.date) errors.date = "required";
  if (!form.paymentAccountId) errors.paymentAccountId = "required";
  const amount = form.amount.trim();
  if (!amount) errors.amount = "required";
  else if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) errors.amount = "amount";
  return errors;
}

export function validateApply(
  invoiceId: string,
  amount: string
): { invoice?: true; amount?: true } {
  const errors: { invoice?: true; amount?: true } = {};
  if (!invoiceId) errors.invoice = true;
  if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0) errors.amount = true;
  return errors;
}
