// F07 — realised FX on foreign-currency receipts, hand-calculated.
// USD 1,000 invoice booked at 3.6725 → A/R AED 3,672.50 (VAT ignored: zero-rated sale).
import { describe, expect, it } from "vitest";
import { allocatePayment, buildPaymentJournalLines } from "../../server/services/invoice-lifecycle";
import { toBase } from "../../server/services/invoice-posting.service";

const ids = { bank: "BANK", ar: "AR", credit: "CREDIT", gain: "GAIN", loss: "LOSS" };
const net = (lines: { accountId: string; debit: number; credit: number }[]) =>
  Object.fromEntries(lines.map((l) => [l.accountId, Math.round((l.debit - l.credit) * 100) / 100]));

function receipt(amount: number, payRate: number) {
  const a = allocatePayment({ amount, remaining: 1000 });
  const built = buildPaymentJournalLines({
    appliedToReceivable: a.appliedToReceivable,
    customerCredit: a.customerCredit,
    invoiceRate: 3.6725,
    paymentRate: payRate,
    paymentAccountId: ids.bank,
    receivableAccountId: ids.ar,
    customerCreditAccountId: ids.credit,
    fxGainAccountId: ids.gain,
    fxLossAccountId: ids.loss,
    // Settles in full: the live caller clears the exact A/R residual on the ledger.
    receivableCreditAedOverride: 3672.5,
  });
  if (!built.ok) throw new Error(built.message);
  return built;
}

describe("F07 B: foreign receipts", () => {
  it("(a) full payment at 3.6800: bank 3,680.00, A/R cleared 3,672.50, FX gain 7.50", () => {
    const { lines, realisedFx } = receipt(1000, 3.68);
    expect(realisedFx).toBe(7.5);
    expect(net(lines)).toEqual({ BANK: 3680, AR: -3672.5, GAIN: -7.5 });
  });

  it("(b) full payment at 3.6600: bank 3,660.00, A/R cleared 3,672.50, FX loss 12.50", () => {
    const { lines, realisedFx } = receipt(1000, 3.66);
    expect(realisedFx).toBe(-12.5);
    expect(net(lines)).toEqual({ BANK: 3660, AR: -3672.5, LOSS: 12.5 });
  });

  it("(c) USD 1,100 at 3.6800: A/R 3,672.50, FX gain 7.50, customer credit USD 100 = AED 368.00", () => {
    const { lines } = receipt(1100, 3.68);
    expect(net(lines)).toEqual({ BANK: 4048, AR: -3672.5, CREDIT: -368, GAIN: -7.5 });
  });

  it("(d) refund of the USD 100 credit at 3.6900 clears AED 368.00; cash 369.00; difference 1.00", () => {
    // Mirrors refundCustomerCredit: liability at the credit's booked rate, cash at the refund rate.
    const liab = toBase(10000, "3.68");
    const cash = toBase(10000, "3.69");
    expect(liab).toBe(36800);
    expect(cash).toBe(36900);
    expect(liab - cash).toBe(-100); // < 0 → debit FX loss 1.00 (fxLine in invoice-payment.service)
  });
});
