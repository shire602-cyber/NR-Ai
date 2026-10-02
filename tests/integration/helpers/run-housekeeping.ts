// Test helper: the other daily platform sweeps (export expiry, dead sessions, idempotency keys,
// API request log), in a separate process. Prints one JSON line.
import { expireOldExports, failStaleExports } from "../../../server/services/company-export";
import { purgeDeadSessions } from "../../../server/services/sessions";
import { purgeExpiredIdempotencyKeys } from "../../../server/api-v1/idempotency";
import { purgeOldRequestLog } from "../../../server/api-v1/request-log";

async function main() {
  const out = {
    staleExports: await failStaleExports(),
    expiredExports: await expireOldExports(),
    deadSessions: await purgeDeadSessions(),
    idempotency: await purgeExpiredIdempotencyKeys(),
    requestLog: await purgeOldRequestLog(),
  };
  console.log("RESULT " + JSON.stringify(out));
  process.exit(0);
}
main().catch((err) => {
  console.error("HELPER_FAILED", err);
  process.exit(1);
});
