/**
 * server/outbox — the durable email outbox (W4-D). See outbox.ts for the lifecycle.
 *
 *   enqueueEmail(...)          insert (never sends)
 *   deliverOutboxMessage(id)   one immediate attempt
 *   processOutbox()            worker tick (registered as job "email.outboxDelivery")
 *
 * Application code normally calls server/services/email.service.sendEmail, which enqueues and
 * makes the first attempt.
 */
import { listJobs, registerJob } from "../platform/job-registry";
import { processOutbox } from "./outbox";
import { createLogger } from "../config/logger";

export * from "./outbox";
export {
  activeProviderName,
  hasResendConfigLive,
  hasSmtpConfigLive,
  setEmailTransportOverride,
  EmailTransportError,
  type EmailTransport,
  type OutgoingAttachment,
  type OutgoingEmail,
} from "./providers";
export { parseResendEvent, parseSmtpDsn, verifySvixSignature } from "./webhooks";
export { registerOutboxRoutes } from "./routes";

const log = createLogger("email-outbox");

/** Register the delivery worker (every minute). Idempotent. */
export function registerOutboxJob(): void {
  if (listJobs().some((j) => j.name === "email.outboxDelivery")) return;
  registerJob({
    name: "email.outboxDelivery",
    cron: "* * * * *",
    description: "Deliver queued emails; retry with backoff; dead-letter after max attempts",
    run: async () => {
      const counts = await processOutbox();
      if (Object.keys(counts).length) log.info(counts, "Outbox delivery tick");
    },
  });
}
