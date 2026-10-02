// Test helper: which tables would the company export silently miss? Prints one JSON line.
import { exportCoverage } from "../../../server/services/company-export";

async function main() {
  console.log("RESULT " + JSON.stringify(await exportCoverage()));
  process.exit(0);
}
main().catch((err) => {
  console.error("HELPER_FAILED", err);
  process.exit(1);
});
