// Test helper: run the scheduled-report tick (Phase 8 D4) in a separate process, optionally several ticks AT ONCE, to prove
// one run per slot across instances. Reads DATABASE_URL etc. from the environment; prints one JSON line.
//   npx tsx tests/integration/helpers/run-report-schedules.ts [parallelTicks]
import { runDueReportSchedules } from "../../../server/reports/schedule";

async function main() {
  const parallel = Math.max(1, Number(process.argv[2]) || 1);
  const results = await Promise.all(Array.from({ length: parallel }, () => runDueReportSchedules()));
  console.log("RESULT " + JSON.stringify({ claimed: results.map((r) => r.claimed) }));
  process.exit(0);
}
main().catch((err) => {
  console.error("HELPER_FAILED", err);
  process.exit(1);
});
