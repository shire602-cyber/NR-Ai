/**
 * VAT-return-to-ledger reconciliation (W4-E, R12-03, R12-08b). Pure.
 *
 * The return's output VAT (Box 12 = Box 8 VAT + adjustments) and recoverable input VAT
 * (Box 13 = Box 11 VAT + adjustments) are compared with the movement on the VAT control
 * accounts (output 2020, input 1050, plus any account flagged is_vat_account) for the period,
 * by source. Return-only items that never post to the ledger (partial-exemption
 * apportionment, tourist refunds, corrections) are listed as EXPLAINED differences; anything
 * else is UNEXPLAINED and blocks "ready to submit" unless overridden with a reason.
 * Zero tolerance: figures are integer fils.
 */
import { inputEffect, outputEffect, type BoxDelta, type Vat201Fils } from "./vat-boxes";

export type ReconCategory = string;

export function categoryForSource(source: string | null | undefined): ReconCategory {
  switch (source) {
    case "invoice":
      return "sales";
    case "bill":
    case "bill_reversal":
    case "vendor_debit_note":
      return "purchases";
    case "receipt":
      return "receipts";
    case "vat_bad_debt_relief":
      return "bad_debt_relief";
    case "fixed_asset":
      return "fixed_asset_disposals";
    default:
      return `journal:${source || "manual"}`;
  }
}

export interface ReconRow {
  category: ReconCategory;
  engineOutputFils: number;
  ledgerOutputFils: number;
  outputDifferenceFils: number;
  engineInputFils: number;
  ledgerInputFils: number;
  inputDifferenceFils: number;
  /** True for return-only adjustments that are not expected in the ledger. */
  explained: boolean;
  label: string;
}

export interface VatReconciliation {
  basis: "vat_control_accounts";
  hasVatAccounts: boolean;
  returnOutputVatFils: number;
  ledgerOutputVatFils: number;
  outputDifferenceFils: number;
  explainedOutputFils: number;
  unexplainedOutputFils: number;
  returnInputVatFils: number;
  ledgerInputVatFils: number;
  inputDifferenceFils: number;
  explainedInputFils: number;
  unexplainedInputFils: number;
  hasUnexplainedDifference: boolean;
  byCategory: ReconRow[];
  /** AED view of the headline figures. */
  aed: Record<string, number>;
}

const LABELS: Record<string, string> = {
  sales: "Sales invoices, debit and credit notes",
  purchases: "Vendor bills and debit notes",
  receipts: "Posted receipts",
  bad_debt_relief: "Bad-debt relief claims",
  fixed_asset_disposals: "Fixed-asset acquisitions (input VAT) and disposals",
  partial_exemption: "Partial-exemption apportionment (not posted)",
  return_adjustments: "Return adjustments: tourist refunds, imports, corrections (not posted)",
};

export function buildReconciliation(input: {
  boxes: Vat201Fils;
  contributions: Array<{ boxes: BoxDelta; category: ReconCategory; inLedger: boolean }>;
  ledgerByCategory: Map<ReconCategory, { output: number; input: number }>;
  hasVatAccounts: boolean;
}): VatReconciliation {
  const engine = new Map<ReconCategory, { output: number; input: number; inLedger: boolean }>();
  let explainedOutput = 0;
  let explainedInput = 0;
  for (const c of input.contributions) {
    const o = outputEffect(c.boxes);
    const i = inputEffect(c.boxes);
    const agg = engine.get(c.category) ?? { output: 0, input: 0, inLedger: c.inLedger };
    agg.output += o;
    agg.input += i;
    engine.set(c.category, agg);
    if (!c.inLedger) {
      explainedOutput += o;
      explainedInput += i;
    }
  }
  const cats = new Set<ReconCategory>([...engine.keys(), ...input.ledgerByCategory.keys()]);
  const rows: ReconRow[] = [...cats].sort().map((category) => {
    const e = engine.get(category) ?? { output: 0, input: 0, inLedger: true };
    const l = input.ledgerByCategory.get(category) ?? { output: 0, input: 0 };
    return {
      category,
      engineOutputFils: e.output,
      ledgerOutputFils: l.output,
      outputDifferenceFils: e.output - l.output,
      engineInputFils: e.input,
      ledgerInputFils: l.input,
      inputDifferenceFils: e.input - l.input,
      explained: !e.inLedger,
      label:
        LABELS[category] ??
        (category.startsWith("journal:")
          ? `Journal entries (${category.slice(8)}) on VAT accounts`
          : category),
    };
  });
  const ledgerOutput = [...input.ledgerByCategory.values()].reduce((s, v) => s + v.output, 0);
  const ledgerInput = [...input.ledgerByCategory.values()].reduce((s, v) => s + v.input, 0);
  const outDiff = input.boxes.box12TotalDueTax - ledgerOutput;
  const inDiff = input.boxes.box13RecoverableTax - ledgerInput;
  const unexplainedOutput = outDiff - explainedOutput;
  const unexplainedInput = inDiff - explainedInput;
  const aed = (f: number) => (Object.is(f / 100, -0) ? 0 : f / 100);
  return {
    basis: "vat_control_accounts",
    hasVatAccounts: input.hasVatAccounts,
    returnOutputVatFils: input.boxes.box12TotalDueTax,
    ledgerOutputVatFils: ledgerOutput,
    outputDifferenceFils: outDiff,
    explainedOutputFils: explainedOutput,
    unexplainedOutputFils: unexplainedOutput,
    returnInputVatFils: input.boxes.box13RecoverableTax,
    ledgerInputVatFils: ledgerInput,
    inputDifferenceFils: inDiff,
    explainedInputFils: explainedInput,
    unexplainedInputFils: unexplainedInput,
    hasUnexplainedDifference: unexplainedOutput !== 0 || unexplainedInput !== 0,
    byCategory: rows,
    aed: {
      returnOutputVat: aed(input.boxes.box12TotalDueTax),
      ledgerOutputVat: aed(ledgerOutput),
      outputDifference: aed(outDiff),
      unexplainedOutput: aed(unexplainedOutput),
      returnInputVat: aed(input.boxes.box13RecoverableTax),
      ledgerInputVat: aed(ledgerInput),
      inputDifference: aed(inDiff),
      unexplainedInput: aed(unexplainedInput),
    },
  };
}
