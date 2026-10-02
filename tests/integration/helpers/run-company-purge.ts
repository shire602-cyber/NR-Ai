// Test helper: run ONE pass of the daily company purge/erase job in a separate process, because
// the integration suite is a plain node script that cannot import TypeScript. Prints one JSON line.
import { runCompanyPurge } from "../../../server/services/company-deletion";

async function main() {
  const summary = await runCompanyPurge();
  console.log("RESULT " + JSON.stringify(summary));
  process.exit(0);
}
main().catch((err) => {
  console.error("HELPER_FAILED", err);
  process.exit(1);
});
