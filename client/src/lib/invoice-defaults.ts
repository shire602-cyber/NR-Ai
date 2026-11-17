/**
 * X6a (council REQUIRED 2): the blank invoice line a new invoice starts with.
 *
 * Only a VAT-registered supplier may charge VAT. A company without a TRN is treated as not VAT
 * registered: its new lines start at 0% and "out of scope", and the server refuses to issue a
 * document that charges VAT while the company has no TRN (SUPPLIER_TRN_REQUIRED). A company with
 * a TRN starts at the standard rate, as before.
 */
export interface BlankInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatSupplyType: "standard_rated" | "out_of_scope";
  discountPercent: number;
  marginScheme: boolean;
  marginPurchaseCost: number;
}

/** True when the company has a TRN, i.e. it may issue tax invoices that charge VAT. */
export function isVatRegisteredCompany(
  company: { trnVatNumber?: string | null } | null | undefined
): boolean {
  return Boolean((company?.trnVatNumber ?? "").trim());
}

export function blankInvoiceLine(vatRegistered: boolean, standardRate = 0.05): BlankInvoiceLine {
  return {
    description: "",
    quantity: 1,
    unitPrice: 0,
    vatRate: vatRegistered ? standardRate : 0,
    vatSupplyType: vatRegistered ? "standard_rated" : "out_of_scope",
    discountPercent: 0,
    marginScheme: false,
    marginPurchaseCost: 0,
  };
}

/** A line the user has not touched yet (safe to swap for the company's default). */
export function isUntouchedBlankLine(
  line: { description?: string; unitPrice?: number | string } | null | undefined
): boolean {
  if (!line) return true;
  return !(line.description ?? "").trim() && Number(line.unitPrice ?? 0) === 0;
}
