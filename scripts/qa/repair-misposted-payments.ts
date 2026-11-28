#!/usr/bin/env -S npx tsx
// X5 (J1 D1): payments posted to a header or the generic "1020 Bank Accounts" account instead
// of the company's own bank account GL (e.g. 1021), which the bank statement could never match.
//
// Default: READ ONLY. Lists every affected bill / invoice payment with the account it should
// have used (the primary bank account's GL) and whether a bank line is already matched to it.
//
// --apply: reverses each unmatched finding through the settlement seam (bills.reversePayment /
// invoices.reversePayment, a ledger-kernel reversal) and records it again on the same date,
// amount, rate and reference against the bank account GL (bills.recordPayment /
// invoices.recordPayment). Matched payments and payments in a locked period are skipped.
// Take a backup first (docs/release/DEPLOY-RUNBOOK.md).
//
// Usage:
//   DATABASE_URL=postgres://... npx tsx scripts/qa/repair-misposted-payments.ts [--company <uuid>] [--json]
//   DATABASE_URL=postgres://... npx tsx scripts/qa/repair-misposted-payments.ts --company <uuid> --apply [--actor <user uuid>]

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const UUID = /^[0-9a-f-]{36}$/i;
const companyId = value("--company");
const actorId = value("--actor");
if (companyId !== null && !UUID.test(companyId)) {
  console.error("--company must be a uuid");
  process.exit(2);
}
if (actorId !== null && !UUID.test(actorId)) {
  console.error("--actor must be a uuid");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

const { findMispostedPayments, repairMispostedPayments } =
  await import("../../server/services/payment-account-repair.service");
const { closePool } = await import("../../server/db");

try {
  const findings = await findMispostedPayments(companyId);
  if (!flag("--apply")) {
    if (flag("--json")) console.log(JSON.stringify(findings, null, 2));
    else {
      console.log(`${findings.length} mis-posted payment(s) (read-only; pass --apply to repair)`);
      for (const f of findings) {
        console.log(
          `${f.companyId} ${f.kind} ${f.paymentId} ${f.date} ${f.amount} on ${f.postedAccountCode}` +
            ` (${f.reason}) -> ${f.targetAccountId ?? "no bank account"}${f.matched ? " [matched]" : ""}`
        );
      }
    }
  } else {
    if (!companyId) {
      console.error("--apply needs --company <uuid> (repair one company at a time)");
      process.exit(2);
    }
    const outcomes = await repairMispostedPayments(findings, { actorId });
    console.log(JSON.stringify(outcomes, null, 2));
  }
} finally {
  await closePool();
}
