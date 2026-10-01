// Pure maths for vendor credit notes (no I/O, unit-testable).
//
// A vendor credit note is the reverse of a vendor bill:
//   Dr  Accounts Payable                       total
//   Cr  expense/asset account per line         line amount
//   Cr  Input VAT (recoverable VAT)            vat_amount
// Reverse charge mirrors the bill's self-assessment in reverse:
//   Dr  Output VAT                             vat_amount
//   Cr  Input VAT                              vat_amount
//   Dr  Accounts Payable                       net only (the vendor charged no VAT)

import Decimal from "decimal.js";
import { computeBillLines, type BillLineInput } from "./bill-line-math";

export const VENDOR_CREDIT_PREFIX = "VCN-";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface VendorCreditTotals {
  lines: ReturnType<typeof computeBillLines>["lines"];
  subtotal: string;
  vatAmount: string;
  /** What reduces the amount owed: net only under reverse charge. */
  total: string;
}

export function computeCreditTotals(
  lines: readonly BillLineInput[],
  reverseCharge: boolean
): VendorCreditTotals {
  const computed = computeBillLines(lines);
  const subtotal = new Decimal(computed.subtotal);
  const vat = new Decimal(computed.vatAmount);
  return {
    lines: computed.lines,
    subtotal: computed.subtotal,
    vatAmount: computed.vatAmount,
    total: (reverseCharge ? subtotal : subtotal.plus(vat)).toFixed(2),
  };
}

export interface CreditPostingInput {
  lines: Array<{ accountId: string; amount: number; description: string }>;
  vatAmount: number;
  fxRate: number;
  reverseCharge: boolean;
  accounts: { apId: string; inputVatId?: string | null; outputVatId?: string | null };
  ref: string;
  vendorName: string;
}

export interface CreditPostingLine {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
}

export function buildVendorCreditLines(input: CreditPostingInput): CreditPostingLine[] {
  const { accounts, ref, vendorName } = input;
  const fx = input.fxRate > 0 ? input.fxRate : 1;
  const vat = round2(input.vatAmount * fx);
  const out: CreditPostingLine[] = [];

  for (const line of input.lines) {
    out.push({
      accountId: line.accountId,
      debit: 0,
      credit: round2(line.amount * fx),
      description: `Vendor credit ${ref} - ${line.description}`.slice(0, 255),
    });
  }
  // Rebalance off the actual expense credits (per-line rounding can drift a fils).
  const net = round2(out.reduce((s, l) => s + l.credit, 0));

  const hasInputVat = vat > 0 && !!accounts.inputVatId;
  if (hasInputVat) {
    out.push({
      accountId: accounts.inputVatId!,
      debit: 0,
      credit: vat,
      description: `Input VAT - Vendor credit ${ref}`,
    });
  }

  if (input.reverseCharge) {
    if (vat > 0 && accounts.outputVatId) {
      out.push({
        accountId: accounts.outputVatId,
        debit: vat,
        credit: 0,
        description: `Reverse-charge output VAT - Vendor credit ${ref}`,
      });
    }
    out.push({
      accountId: accounts.apId,
      debit: net,
      credit: 0,
      description: `A/P - ${vendorName} - Vendor credit ${ref}`,
    });
  } else {
    out.push({
      accountId: accounts.apId,
      debit: round2(hasInputVat ? net + vat : net),
      credit: 0,
      description: `A/P - ${vendorName} - Vendor credit ${ref}`,
    });
  }
  return out;
}

/** The most that can be applied: the smaller of credit remaining and bill due, 2dp, never negative. */
export function remainingApplicable(creditRemaining: string | number, billDue: string | number): string {
  const r = new Decimal(creditRemaining);
  const d = new Decimal(billDue);
  const m = Decimal.min(r, d);
  return (m.isNegative() ? new Decimal(0) : m).toFixed(2);
}

/** Next number in the per-company VCN- sequence given the highest existing one. */
export function nextVendorCreditNumber(highest: string | null | undefined): string {
  const match = highest ? /^VCN-(\d+)$/.exec(highest) : null;
  const next = match ? Number(match[1]) + 1 : 1;
  return `${VENDOR_CREDIT_PREFIX}${String(next).padStart(4, "0")}`;
}
