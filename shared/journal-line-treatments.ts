/**
 * WQ3 (9.4 / 9.16): the per-line treatments a manual journal line can carry. Pure and
 * client-safe (no drizzle / zod), so the journal grid, the validators, the route and the CT
 * workpaper read the same lists.
 *
 * VAT treatment of a line (the line amount is the net amount):
 *   standard      the server adds the VAT leg itself at the company's standard rate: a debit
 *                 line gets an input VAT leg (1050), a credit line an output VAT leg (2020).
 *                 The leg is flagged `systemVat`, so the control-account gate still refuses any
 *                 VAT line the user picks by hand (B1 / C1).
 *   zero_rated    no VAT leg; a credit (income) line is a zero-rated supply (VAT 201 Box 4).
 *   exempt        no VAT leg; a credit (income) line is an exempt supply (VAT 201 Box 5).
 *   out_of_scope  no VAT leg and no VAT 201 box.
 *
 * Corporate-tax treatment of a line (FDL 47/2022), read by the CT workpaper:
 *   deductible      an explicit "fully deductible": overrides an account tax tag for this line.
 *   non_deductible  `ctDisallowedPct`% of the expense is added back (50 for client
 *                   entertainment, Art. 32; 100 for fines, Art. 33).
 *   exempt_income   the income is deducted from taxable income (Art. 22-24).
 */

export const JOURNAL_LINE_VAT_TREATMENTS = [
  "standard",
  "zero_rated",
  "exempt",
  "out_of_scope",
] as const;
export type JournalLineVatTreatment = (typeof JOURNAL_LINE_VAT_TREATMENTS)[number];

export const JOURNAL_LINE_CT_TREATMENTS = ["deductible", "non_deductible", "exempt_income"] as const;
export type JournalLineCtTreatment = (typeof JOURNAL_LINE_CT_TREATMENTS)[number];

export const JOURNAL_LINE_CONTACT_TYPES = ["customer", "vendor"] as const;
export type JournalLineContactType = (typeof JOURNAL_LINE_CONTACT_TYPES)[number];

/** Default non-deductible share when none is given (fully disallowed). */
export const DEFAULT_CT_DISALLOWED_PCT = 100;

/** Account types a CT treatment applies to (exempt income on income lines, the rest on expenses). */
export function ctTreatmentFitsAccount(
  treatment: JournalLineCtTreatment,
  accountType: string
): boolean {
  if (treatment === "exempt_income") return accountType === "income";
  if (treatment === "non_deductible") return accountType === "expense";
  return accountType === "income" || accountType === "expense";
}

/**
 * The VAT leg a standard-rated line adds, in fils: `round(net * rate)`, half away from zero.
 * `rate` is a fraction (0.05 UAE, 0.15 KSA).
 */
export function journalLineVatFils(netFils: number, rate: number): number {
  return Math.round(Math.abs(netFils) * rate) * Math.sign(netFils);
}
