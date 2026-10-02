// Test helper: run ONE cycle of a Phase 8 D1 job for a single company, in a separate process (the integration
// suite is a plain node script and cannot import TypeScript). Reads DATABASE_URL etc. from the environment and
// prints one JSON line.
//   run-sales-jobs.ts <late-fees|quote-expiry|recurring> <companyId>
import { generateDueRecurringInvoices } from "../../../server/services/scheduler.service";
import { runLateFeeJob } from "../../../server/services/late-fee.service";
import { expireDueQuotes } from "../../../server/services/quote-acceptance.service";

async function main() {
  const [job, companyId] = process.argv.slice(2);
  if (!job || !companyId) throw new Error("usage: run-sales-jobs.ts <late-fees|quote-expiry|recurring> <companyId>");
  let summary: unknown;
  if (job === "late-fees") summary = await runLateFeeJob({ companyId });
  else if (job === "quote-expiry") summary = { expired: await expireDueQuotes({ companyId }) };
  else if (job === "recurring") summary = await generateDueRecurringInvoices({ companyId });
  else throw new Error("unknown job " + job);
  console.log("RESULT " + JSON.stringify(summary ?? {}));
  process.exit(0);
}
main().catch((err) => {
  console.error("HELPER_FAILED", err);
  process.exit(1);
});
