import { UAE_VAT_RATE } from '../constants';

export interface VatReturnInvoice {
  id: string;
  exchangeRate?: number | null;
}

export interface VatReturnInvoiceLine {
  invoiceId: string;
  quantity: number;
  unitPrice: number;
  vatRate?: number | null;
  vatSupplyType?: string | null;
}

export interface VatReturnReceipt {
  amount?: number | null;
  vatAmount?: number | null;
  exchangeRate?: number | null;
  reverseCharge?: boolean | null;
}

export interface VatReturnTotals {
  standardRatedAmount: number;
  standardRatedVat: number;
  zeroRatedAmount: number;
  exemptAmount: number;
  ordinaryExpenses: number;
  ordinaryInputVatGross: number;
  reverseChargeAmount: number;
  reverseChargeVatGross: number;
}

const fxOf = (rec: { exchangeRate?: number | null }): number =>
  Number(rec.exchangeRate ?? 1) || 1;

// Aggregate sales and purchases into FTA VAT 201 box totals. All inputs are
// expressed in their own transaction currency; outputs are converted to the
// company's base currency (AED) via each record's exchangeRate. The FTA
// requires the return to be filed in AED, so this conversion is mandatory
// when the company transacts in non-AED currencies.
export function aggregateVatReturnTotals(
  invoices: VatReturnInvoice[],
  linesByInvoiceId: Map<string, VatReturnInvoiceLine[]>,
  receipts: VatReturnReceipt[],
): VatReturnTotals {
  let standardRatedAmount = 0;
  let standardRatedVat = 0;
  let zeroRatedAmount = 0;
  let exemptAmount = 0;

  for (const invoice of invoices) {
    const fx = fxOf(invoice);
    const lines = linesByInvoiceId.get(invoice.id) ?? [];

    for (const line of lines) {
      const lineAmount = line.quantity * line.unitPrice * fx;
      const lineVat = lineAmount * (line.vatRate ?? UAE_VAT_RATE);
      const supplyType = line.vatSupplyType ?? 'standard_rated';

      if (supplyType === 'zero_rated' || line.vatRate === 0) {
        zeroRatedAmount += lineAmount;
      } else if (supplyType === 'exempt') {
        exemptAmount += lineAmount;
      } else {
        standardRatedAmount += lineAmount;
        standardRatedVat += lineVat;
      }
    }
  }

  const ordinaryReceipts = receipts.filter(r => !r.reverseCharge);
  const reverseChargeReceipts = receipts.filter(r => r.reverseCharge);

  const ordinaryExpenses = ordinaryReceipts.reduce(
    (sum, r) => sum + (r.amount ?? 0) * fxOf(r),
    0,
  );
  const ordinaryInputVatGross = ordinaryReceipts.reduce(
    (sum, r) => sum + (r.vatAmount ?? 0) * fxOf(r),
    0,
  );
  const reverseChargeAmount = reverseChargeReceipts.reduce(
    (sum, r) => sum + (r.amount ?? 0) * fxOf(r),
    0,
  );
  const reverseChargeVatGross = reverseChargeReceipts.reduce(
    (sum, r) => sum + (r.vatAmount ?? 0) * fxOf(r),
    0,
  );

  return {
    standardRatedAmount,
    standardRatedVat,
    zeroRatedAmount,
    exemptAmount,
    ordinaryExpenses,
    ordinaryInputVatGross,
    reverseChargeAmount,
    reverseChargeVatGross,
  };
}
