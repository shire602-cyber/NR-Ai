// Test helper: run ONE cycle of the recurring-invoice generator for a single
// company, in a separate process. Used by review-fixes-6.test.mjs, which is a
// plain node script and cannot import TypeScript. Reads DATABASE_URL etc. from
// the environment; prints one JSON line.
import { generateDueRecurringInvoices } from "../../../server/services/scheduler.service";

async function main() {
  const companyId = process.argv[2];
  if (!companyId) throw new Error("usage: run-recurring.ts <companyId>");
  const summary = await generateDueRecurringInvoices({ companyId });
  console.log("RESULT " + JSON.stringify(summary ?? {}));
  process.exit(0);
}
main().catch((err) => {
  console.error("HELPER_FAILED", err);
  process.exit(1);
});
