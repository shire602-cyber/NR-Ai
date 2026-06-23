// Orchestrates one intake poll: fetch raw messages from the configured mailbox
// source, route each by sender → company, gate (allowlist + DKIM), de-dup
// attachments by content hash, and persist the message + document rows.
//
// OCR hand-off (creating `receipts` from each processable attachment) lands in
// P2; P1 stops at durable, de-duplicated ingestion. With the unconfigured source
// (the default) this is a safe no-op: fetchNewMessages returns [].
//
// See docs/EMAIL_INTAKE_PILOT.md.

import { storage } from "../storage";
import { createLogger } from "../config/logger";
import {
  getEmailIntakeSource,
  isEmailIntakeEnabled,
} from "./email-intake-provider";
import {
  evaluateSenderGate,
  matchSenderToCompany,
  normalizeInboundMessage,
  type EmailSourceRef,
} from "./email-intake";

const log = createLogger("email-intake");

export interface PollSummary {
  ran: boolean;
  reason?: string;
  messagesFetched: number;
  messagesIngested: number;
  messagesIgnored: number;
  documentsStored: number;
  duplicatesSkipped: number;
}

const EMPTY: PollSummary = {
  ran: false,
  messagesFetched: 0,
  messagesIngested: 0,
  messagesIgnored: 0,
  documentsStored: 0,
  duplicatesSkipped: 0,
};

/**
 * Run a single poll for one firm. `accessibleCompanyIds` scopes which client
 * companies' sender mappings are eligible (firm_owner = all clients).
 */
export async function pollEmailIntakeOnce(args: {
  accessibleCompanyIds: string[];
  since: Date;
}): Promise<PollSummary> {
  if (!isEmailIntakeEnabled()) return { ...EMPTY, reason: "feature_disabled" };

  const source = getEmailIntakeSource();
  if (!source.configured) return { ...EMPTY, reason: "mailbox_not_configured" };

  const sources = await storage.listActiveEmailSourcesForCompanies(args.accessibleCompanyIds);
  const refs: EmailSourceRef[] = sources.map((s) => ({
    id: s.id,
    companyId: s.companyId,
    senderEmail: s.senderEmail,
    status: s.status as EmailSourceRef["status"],
    requireDkimPass: s.requireDkimPass,
  }));

  const raw = await source.fetchNewMessages(args.since);
  const summary: PollSummary = { ...EMPTY, ran: true, messagesFetched: raw.length };
  // Per-company dedup sets, lazily loaded.
  const hashCache = new Map<string, Set<string>>();

  for (const msg of raw) {
    const matched = matchSenderToCompany(msg.fromHeader, refs);
    const gate = evaluateSenderGate({ source: matched, dkimPass: msg.dkimPass });
    if (!gate.ingest || !matched) {
      summary.messagesIgnored++;
      continue;
    }

    try {
      const normalized = normalizeInboundMessage(msg, matched);
      const stored = await storage.createEmailIntakeMessage({
        companyId: normalized.companyId,
        sourceId: normalized.sourceId,
        providerMessageId: normalized.providerMessageId,
        fromEmail: normalized.fromEmail,
        subject: normalized.subject,
        receivedAt: normalized.receivedAt,
        attachmentCount: normalized.attachments.length,
        status: "received",
      } as any);

      let seen = hashCache.get(normalized.companyId);
      if (!seen) {
        seen = new Set(await storage.getEmailIntakeHashesForCompany(normalized.companyId));
        hashCache.set(normalized.companyId, seen);
      }

      for (const att of normalized.attachments) {
        const duplicate = seen.has(att.sha256);
        await storage.createEmailIntakeDocument({
          messageId: stored.id,
          companyId: normalized.companyId,
          filename: att.filename,
          mimeType: att.mimeType,
          byteSize: att.byteSize,
          sha256: att.sha256,
          docKind: att.docKind,
          ocrStatus: duplicate ? "skipped" : "pending",
          isDuplicate: duplicate,
        } as any);
        if (duplicate) {
          summary.duplicatesSkipped++;
        } else {
          seen.add(att.sha256);
          summary.documentsStored++;
        }
      }
      summary.messagesIngested++;
    } catch (err) {
      // Idempotency: a unique-constraint hit on provider_message_id means we
      // already ingested this email — treat as ignored, not an error.
      summary.messagesIgnored++;
      log.warn({ err, providerMessageId: msg.providerMessageId }, "intake message skipped");
    }
  }

  log.info(summary, "email intake poll complete");
  return summary;
}
