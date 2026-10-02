// Final settlement maths. Pure: no database.
//
// One journal entry on the termination date:
//   Dr 2036 Gratuity Provision   provision used
//   Dr 5028 Gratuity Expense     true-up when positive (Cr 5028 when the provision was over-accrued)
//   Dr 5020 Salaries             unused leave paid out
//   Cr 1080 Employee Loans       loan still owed, recovered from the settlement
//   Cr 2034 Deductions Payable   other deductions
//   Cr 2030 Salaries Payable     the net the employee is owed
// which balances because true-up = gratuity - provision used and net = gratuity + leave - loan - other.

import Decimal from "decimal.js";

const r2 = (v: Decimal.Value): number => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

export interface SettlementInput {
  /** From the gratuity calculator (0 for a GCC national or under one year of service). */
  gratuityAmount: number;
  /** The employee's gratuity accrued in approved payroll runs. */
  provisionDefault: number;
  /** Balance of the company's 2036 provision account. */
  provisionBalance: number;
  provisionOverride?: number | null;
  basic: number;
  leaveDays: number;
  loanOutstanding: number;
  otherDeductions: number;
}

export type SettlementResult =
  | {
      ok: true;
      gratuityAmount: number;
      provisionUsed: number;
      gratuityTrueUp: number;
      leaveEncashment: number;
      loanRecovered: number;
      otherDeductions: number;
      netPayable: number;
    }
  | { ok: false; code: "PROVISION_EXCEEDS_BALANCE" | "SETTLEMENT_NEGATIVE" | "INVALID_AMOUNT"; message: string };

export function computeSettlement(input: SettlementInput): SettlementResult {
  const balance = Math.max(0, input.provisionBalance);
  let provisionUsed: number;
  if (input.provisionOverride !== undefined && input.provisionOverride !== null) {
    if (!(input.provisionOverride >= 0)) return { ok: false, code: "INVALID_AMOUNT", message: "The provision used cannot be negative." };
    if (input.provisionOverride > balance + 0.005) {
      return {
        ok: false,
        code: "PROVISION_EXCEEDS_BALANCE",
        message: `The provision used (${input.provisionOverride.toFixed(2)}) is more than the gratuity provision account holds (${balance.toFixed(2)}).`,
      };
    }
    provisionUsed = r2(input.provisionOverride);
  } else {
    provisionUsed = r2(Math.min(Math.max(0, input.provisionDefault), balance));
  }
  const gratuityAmount = r2(input.gratuityAmount);
  const gratuityTrueUp = r2(new Decimal(gratuityAmount).minus(provisionUsed));
  const leaveEncashment = r2(new Decimal(input.basic).div(30).times(Math.max(0, input.leaveDays)));
  const loanRecovered = r2(input.loanOutstanding);
  const otherDeductions = r2(input.otherDeductions);
  const netPayable = r2(new Decimal(gratuityAmount).plus(leaveEncashment).minus(loanRecovered).minus(otherDeductions));
  if (netPayable < 0) {
    return {
      ok: false,
      code: "SETTLEMENT_NEGATIVE",
      message: "The deductions are more than the employee is owed. Recover part of the loan in cash first, or reduce the deductions.",
    };
  }
  return { ok: true, gratuityAmount, provisionUsed, gratuityTrueUp, leaveEncashment, loanRecovered, otherDeductions, netPayable };
}
