// Provider-agnostic mailbox seam for email document intake.
//
// The pipeline never talks to a specific mailbox API directly — it depends only
// on EmailIntakeSource. This keeps the first mailbox choice from being
// load-bearing, lets the routing/dedup/persist flow be tested with a mock (no
// live mailbox or OAuth needed), and means adding Gmail/IMAP/an inbound-webhook
// provider later is a new adapter, not a rewrite.
//
// To add a real source (Gmail API, IMAP, Mailgun/Postmark inbound webhook):
// implement EmailIntakeSource and register it in getEmailIntakeSource. The owner
// connects the mailbox in the provider's own consent screen; tokens are stored
// in the existing encrypted vault. No credentials are handled in code here.
//
// See docs/EMAIL_INTAKE_PILOT.md.

import type { RawInboundMessage } from "./email-intake";

export interface EmailIntakeSource {
  readonly name: string;
  /** Whether a real mailbox is wired. When false, fetchNewMessages returns []. */
  readonly configured: boolean;
  /**
   * Fetch messages received since `since` (exclusive). Implementations should be
   * idempotent at the message level — the caller de-dups on providerMessageId.
   */
  fetchNewMessages(since: Date): Promise<RawInboundMessage[]>;
}

/**
 * Default source until a real mailbox is connected: reports unconfigured and
 * yields nothing. Lets the whole feature ship behind a flag with zero external
 * dependency, exactly like MockEInvoiceProvider.
 */
export class UnconfiguredEmailIntakeSource implements EmailIntakeSource {
  readonly name = "unconfigured";
  readonly configured = false;
  async fetchNewMessages(): Promise<RawInboundMessage[]> {
    return [];
  }
}

/** Feature flag — the whole intake feature is off unless explicitly enabled. */
export function isEmailIntakeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EMAIL_INTAKE_ENABLED === "true";
}

/** True once a real mailbox provider is configured (for integration-status). */
export function isEmailIntakeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.EMAIL_INTAKE_WEBHOOK_SECRET) return true; // inbound-webhook adapter wired
  const name = (env.EMAIL_INTAKE_PROVIDER || "").toLowerCase();
  return name !== "" && name !== "unconfigured";
}

/**
 * Select the active mailbox source. Returns the unconfigured source until a real
 * adapter is implemented and selected via EMAIL_INTAKE_PROVIDER. Register real
 * adapters here as they land (gmail / imap / inbound-webhook).
 */
export function getEmailIntakeSource(env: NodeJS.ProcessEnv = process.env): EmailIntakeSource {
  const name = (env.EMAIL_INTAKE_PROVIDER || "unconfigured").toLowerCase();
  switch (name) {
    case "unconfigured":
      return new UnconfiguredEmailIntakeSource();
    // case "gmail":   return new GmailIntakeSource(env);
    // case "imap":    return new ImapIntakeSource(env);
    // case "inbound": return new InboundWebhookIntakeSource(env);
    default:
      throw new Error(
        `Unknown EMAIL_INTAKE_PROVIDER "${name}". Implement an EmailIntakeSource adapter and register it in getEmailIntakeSource.`
      );
  }
}
