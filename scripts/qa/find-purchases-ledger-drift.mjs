#!/usr/bin/env node
// Read-only drift report for the procure-to-pay sub-ledger (W3-B: R04-01, R04-02, R11-04).
//
// Lists, without changing anything:
//   - bills_on_5130:        posted bill journals that debit 5130 (Loss on Asset Disposal in the
//                           seeded chart) for lines with no account and no category — the old
//                           GENERAL_EXPENSE_CODE fallback. Proposal: reverse + repost to 5000.
//   - paid_before_approval: bills with payments but no posted bill journal (paid while pending),
//                           so A/P carries a debit balance. Proposal: post the bill journal on
//                           bill_date (approve), keeping the existing payment journals.
//   - edited_after_approval: approved/partial/paid bills whose total_amount differs from the A/P
//                           credit of their posted bill journal (converted at the bill rate).
//                           Proposal: reverse the bill journal and repost from the current lines.
//   - duplicate_claim_numbers: expense claims sharing a claim_number (old COUNT(*)+1 race); the
//                           unique index in 0096 is only created when none exist.
//   - claims_paid_without_cash: paid expense claims with no reimbursement journal (R04-03).
//
// The repair proposal is a dry-run plan (reverse + repost through the ledger kernel); this script
// never writes. Usage: DATABASE_URL=postgres://... node scripts/qa/find-purchases-ledger-drift.mjs [--json] [--fail-on-findings]
// Exit code is 0 unless the database cannot be read; with --fail-on-findings it is 1 when any of the
// five lists is non-empty (proposals are derived from them and not counted twice).

import pg from "pg";
import { findingsExitCode } from "./fail-on-findings.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}
const asJson = process.argv.includes("--json");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN READ ONLY");

  const billsOn5130 = (
    await client.query(`
      SELECT b.company_id, b.id AS bill_id, b.bill_number, je.id AS entry_id, je.entry_number,
             SUM(jl.debit)::text AS amount
        FROM vendor_bills b
        JOIN journal_entries je ON je.company_id = b.company_id AND je.source = 'bill'
                               AND je.source_id = b.id AND je.status = 'posted'
                               AND je.reversed_by_entry_id IS NULL
        JOIN journal_lines jl ON jl.entry_id = je.id
        JOIN accounts a ON a.id = jl.account_id AND a.code = '5130'
       WHERE COALESCE(b.category, '') = ''
         AND NOT EXISTS (SELECT 1 FROM bill_line_items li WHERE li.bill_id = b.id AND li.account_id = a.id)
       GROUP BY b.company_id, b.id, b.bill_number, je.id, je.entry_number
       ORDER BY b.company_id, b.bill_number`)
  ).rows;

  const paidBeforeApproval = (
    await client.query(`
      SELECT b.company_id, b.id AS bill_id, b.bill_number, b.status, b.amount_paid::text AS amount_paid
        FROM vendor_bills b
       WHERE EXISTS (SELECT 1 FROM bill_payments p WHERE p.bill_id = b.id)
         AND NOT EXISTS (
           SELECT 1 FROM journal_entries je
            WHERE je.company_id = b.company_id AND je.source = 'bill' AND je.source_id = b.id
              AND je.status = 'posted')
       ORDER BY b.company_id, b.bill_number`)
  ).rows;

  const editedAfterApproval = (
    await client.query(`
      SELECT b.company_id, b.id AS bill_id, b.bill_number, b.status,
             ROUND(b.total_amount * COALESCE(NULLIF(b.exchange_rate, 0), 1), 2)::text AS subledger_total,
             SUM(jl.credit - jl.debit)::text AS gl_ap_credit, je.id AS entry_id
        FROM vendor_bills b
        JOIN journal_entries je ON je.company_id = b.company_id AND je.source = 'bill'
                               AND je.source_id = b.id AND je.status = 'posted'
                               AND je.reversed_by_entry_id IS NULL
        JOIN journal_lines jl ON jl.entry_id = je.id
        JOIN accounts a ON a.id = jl.account_id AND a.code = '2010'
       WHERE b.status IN ('approved', 'partial', 'paid', 'overdue')
       GROUP BY b.company_id, b.id, b.bill_number, b.status, b.total_amount, b.exchange_rate, je.id
      HAVING ABS(ROUND(b.total_amount * COALESCE(NULLIF(b.exchange_rate, 0), 1), 2) - SUM(jl.credit - jl.debit)) >= 0.01
       ORDER BY b.company_id, b.bill_number`)
  ).rows;

  const duplicateClaimNumbers = (
    await client.query(`
      SELECT company_id, claim_number, COUNT(*)::int AS n
        FROM expense_claims WHERE claim_number IS NOT NULL
       GROUP BY company_id, claim_number HAVING COUNT(*) > 1
       ORDER BY company_id, claim_number`)
  ).rows;

  const claimsPaidWithoutCash = (
    await client.query(`
      SELECT c.company_id, c.id AS claim_id, c.claim_number, c.total_amount::text AS total_amount
        FROM expense_claims c
       WHERE c.status = 'paid'
         AND NOT EXISTS (
           SELECT 1 FROM journal_entries je
            WHERE je.company_id = c.company_id AND je.source = 'expense_claim_payment'
              AND je.source_id = c.id AND je.status = 'posted')
       ORDER BY c.company_id, c.claim_number`)
  ).rows;

  const proposals = [
    ...billsOn5130.map((r) => ({
      kind: "bills_on_5130",
      billId: r.bill_id,
      plan: [
        `reverseBySource(${r.company_id}, 'bill', ${r.bill_id})  // reverses ${r.entry_number}`,
        `postJournal(bill ${r.bill_id}, revision+1)  // uncategorised lines → 5000 General Expenses`,
      ],
    })),
    ...paidBeforeApproval.map((r) => ({
      kind: "paid_before_approval",
      billId: r.bill_id,
      plan: [`postJournal(bill ${r.bill_id} on bill_date)  // A/P credit; payments already posted`],
    })),
    ...editedAfterApproval.map((r) => ({
      kind: "edited_after_approval",
      billId: r.bill_id,
      plan: [
        `reverseBySource(${r.company_id}, 'bill', ${r.bill_id})  // GL ${r.gl_ap_credit} vs sub-ledger ${r.subledger_total}`,
        `postJournal(bill ${r.bill_id}, revision+1)  // from current lines`,
      ],
    })),
    ...claimsPaidWithoutCash.map((r) => ({
      kind: "claims_paid_without_cash",
      claimId: r.claim_id,
      plan: [`postJournal(Dr 2045 / Cr bank ${r.total_amount}, source expense_claim_payment)`],
    })),
  ];

  const report = {
    billsOn5130,
    paidBeforeApproval,
    editedAfterApproval,
    duplicateClaimNumbers,
    claimsPaidWithoutCash,
    proposals,
    note: "Dry run only. Nothing was changed. Apply repairs through the app (revise / approve / mark-paid) or the ledger kernel.",
  };
  process.exitCode = findingsExitCode(
    process.argv,
    {
      billsOn5130,
      paidBeforeApproval,
      editedAfterApproval,
      duplicateClaimNumbers,
      claimsPaidWithoutCash,
    },
    "find-purchases-ledger-drift"
  );
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Bills posted to 5130 without category:   ${billsOn5130.length}`);
    console.log(`Bills paid before approval (no journal):  ${paidBeforeApproval.length}`);
    console.log(`Bills edited after approval (GL ≠ A/P):   ${editedAfterApproval.length}`);
    console.log(`Duplicate expense-claim numbers:          ${duplicateClaimNumbers.length}`);
    console.log(`Paid claims without a cash journal:       ${claimsPaidWithoutCash.length}`);
    for (const p of proposals)
      console.log(`- ${p.kind} ${p.billId ?? p.claimId}\n    ${p.plan.join("\n    ")}`);
    console.log(report.note);
  }
  await client.query("ROLLBACK");
} finally {
  await client.end();
}
