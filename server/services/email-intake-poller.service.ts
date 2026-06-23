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
  type NormalizedIntakeAttachment,
} from "./email-intake";
import { extractReceiptToOcr } from "./ocr-extraction.service";
import { runAutopilot, type OcrReceipt, type AutopilotResult } from "./receipt-autopilot.service";

const log = createLogger("email-intake");

export interface PollSummary {
  ran: boolean;
  reason?: string;
  messagesFetched: number;
  messagesIngested: number;
  messagesIgnored: number;
  documentsStored: number;
  duplicatesSkipped: number;
  /** Receipts created by the autopilot from ingested documents (P2). */
  receiptsCreated: number;
  autoPosted: number;
  queuedForReview: number;
}

const EMPTY: PollSummary = {
  ran: false,
  messagesFetched: 0,
  messagesIngested: 0,
  messagesIgnored: 0,
  documentsStored: 0,
  duplicatesSkipped: 0,
  receiptsCreated: 0,
  autoPosted: 0,
  queuedForReview: 0,
};

/** Injectable seams so the orchestration is testable without a model or DB. */
export interface PollDeps {
  extract: (args: { content: Buffer; mimeType: string }) => Promise<OcrReceipt | null>;
  autopilot: (companyId: string, uploadedBy: string, ocr: OcrReceipt) => Promise<AutopilotResult>;
}

const defaultDeps: PollDeps = {
  extract: (a) => extractReceiptToOcr(a),
  autopilot: runAutopilot,
};

/**
 * Run a single poll for one firm. `accessibleCompanyIds` scopes which client
 * companies' sender mappings are eligible (firm_owner = all clients).
 */
export async function pollEmailIntakeOnce(args: {
  accessibleCompanyIds: string[];
  since: Date;
  /** The firm user receipts are attributed to (created_by on auto-posts). */
  uploadedBy?: string;
  deps?: PollDeps;
}): Promise<PollSummary> {
  const deps = args.deps ?? defaultDeps;
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
        const doc = await storage.createEmailIntakeDocument({
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
          continue;
        }
        seen.add(att.sha256);
        summary.documentsStored++;

        // P2: OCR + autopilot for processable, non-duplicate attachments. Bytes
        // are still in memory here, so nothing extra is persisted to disk.
        await processAttachment({
          att,
          docId: doc.id,
          companyId: normalized.companyId,
          uploadedBy: args.uploadedBy ?? matched.id,
          deps,
          summary,
        });
      }
      // done vs partially_processed: any pending doc means OCR didn't complete.
      await storage.updateEmailIntakeMessageStatus(stored.id, "done");
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

/**
 * OCR one attachment and run the receipt autopilot, linking the created receipt
 * back to the intake document. Resilient: a failure here marks the doc 'error'
 * and leaves the rest of the batch unaffected. Non-processable attachments
 * (unsupported type) are marked 'skipped'.
 */
async function processAttachment(args: {
  att: NormalizedIntakeAttachment;
  docId: string;
  companyId: string;
  uploadedBy: string;
  deps: PollDeps;
  summary: PollSummary;
}): Promise<void> {
  const { att, docId, companyId, uploadedBy, deps, summary } = args;
  if (!att.processable) {
    await storage.updateEmailIntakeDocument(docId, { ocrStatus: "skipped" });
    return;
  }
  try {
    const ocr = await deps.extract({ content: att.content, mimeType: att.mimeType });
    if (!ocr) {
      // No provider configured, or extraction declined — leave for retry/manual.
      await storage.updateEmailIntakeDocument(docId, { ocrStatus: "pending" });
      return;
    }
    const result = await deps.autopilot(companyId, uploadedBy, ocr);
    await storage.updateEmailIntakeDocument(docId, {
      ocrStatus: "processed",
      receiptId: result.receiptId,
    });
    summary.receiptsCreated++;
    if (result.autoPosted) summary.autoPosted++;
    if (result.queuedForReview) summary.queuedForReview++;
  } catch (err) {
    log.warn({ err, docId }, "attachment OCR/autopilot failed");
    await storage.updateEmailIntakeDocument(docId, { ocrStatus: "error" });
  }
}
