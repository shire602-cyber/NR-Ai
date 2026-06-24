// Pure logic for the email document-intake pipeline (firm-internal pilot).
//
// Side-effect free so the routing / dedup / gating decisions are unit-tested
// without a mailbox or a DB. The poller fetches raw messages from an
// EmailIntakeSource (see email-intake-provider.ts), normalises them here, routes
// each by sender → company, gates on allowlist + DKIM, de-dups attachments by
// content hash, then hands files to the existing OCR pipeline.
//
// See docs/EMAIL_INTAKE_PILOT.md.

import crypto from "node:crypto";

export type EmailSourceStatus = "active" | "paused";

/** A sender→company link row (subset used by the pure router). */
export interface EmailSourceRef {
  id: string;
  companyId: string;
  senderEmail: string; // stored already-normalised
  status: EmailSourceStatus;
  requireDkimPass: boolean;
}

export type DocKind = "invoice" | "receipt" | "statement" | "unknown";

export interface RawAttachment {
  filename: string;
  mimeType: string;
  /** Raw bytes. base64 string or Buffer — hashAttachment accepts either. */
  content: Buffer | string;
}

export interface RawInboundMessage {
  providerMessageId: string;
  /** Full From header, e.g. `"Acme LLC <billing@acme.ae>"` or a bare address. */
  fromHeader: string;
  subject: string;
  receivedAt: Date;
  /** Whether the provider reported a DKIM pass for this message. */
  dkimPass?: boolean;
  attachments: RawAttachment[];
}

/** Lowercase + trim an email for stable matching/storage. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Pull the bare address out of a From header.
 * `"Acme LLC <billing@acme.ae>"` → `billing@acme.ae`; a bare address is returned
 * as-is (normalised). Returns "" when no address is found.
 */
export function extractSenderAddress(fromHeader: string): string {
  if (!fromHeader) return "";
  const angle = fromHeader.match(/<([^>]+)>/);
  const candidate = angle ? angle[1] : fromHeader;
  const m = candidate.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/);
  return m ? normalizeEmail(m[0]) : "";
}

/**
 * Route a sender to a linked company. Only `active` sources match; unknown or
 * paused senders return null (caller logs + ignores — never auto-creates a link,
 * so a stranger can't poison a ledger).
 */
export function matchSenderToCompany(
  fromHeader: string,
  sources: EmailSourceRef[]
): EmailSourceRef | null {
  const sender = extractSenderAddress(fromHeader);
  if (!sender) return null;
  return sources.find((s) => s.status === "active" && s.senderEmail === sender) ?? null;
}

export interface SenderGateResult {
  ingest: boolean;
  reason: "ok" | "unknown_sender" | "source_paused" | "dkim_failed";
}

/**
 * Decide whether a matched message may be ingested. Allowlist (matched source)
 * + optional DKIM authenticity, since a From header is spoofable.
 */
export function evaluateSenderGate(args: {
  source: EmailSourceRef | null;
  dkimPass?: boolean;
}): SenderGateResult {
  const { source, dkimPass } = args;
  if (!source) return { ingest: false, reason: "unknown_sender" };
  if (source.status !== "active") return { ingest: false, reason: "source_paused" };
  if (source.requireDkimPass && dkimPass !== true) {
    return { ingest: false, reason: "dkim_failed" };
  }
  return { ingest: true, reason: "ok" };
}

/** SHA-256 hex of attachment content (dedup key). Accepts Buffer or base64. */
export function hashAttachment(content: Buffer | string): string {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, "base64");
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * A repeat content hash for the same company is a duplicate (same invoice
 * emailed twice, or emailed and also picked up by the bank feed). `seenHashes`
 * is the set of hashes already stored for that company.
 */
export function isDuplicateAttachment(hash: string, seenHashes: Set<string>): boolean {
  return seenHashes.has(hash);
}

/** Heuristic document-kind from filename + mime. Refined later by OCR content. */
export function classifyDocKind(filename: string, mimeType: string): DocKind {
  const name = (filename || "").toLowerCase();
  if (/statement|stmt|bank/.test(name)) return "statement";
  if (/invoice|inv[-_ ]|tax|bill/.test(name)) return "invoice";
  if (/receipt|rcpt|pos/.test(name)) return "receipt";
  if (mimeType?.startsWith("image/")) return "receipt"; // photo of a receipt is the common case
  return "unknown";
}

/** Attachment mime types we will attempt to OCR; others are skipped. */
const PROCESSABLE_MIME = /^(image\/(png|jpe?g|webp|heic|tiff)|application\/pdf)$/i;
export function isProcessableAttachment(a: { mimeType: string; filename: string }): boolean {
  if (PROCESSABLE_MIME.test(a.mimeType)) return true;
  return /\.(png|jpe?g|webp|heic|tiff?|pdf)$/i.test(a.filename || "");
}

export interface NormalizedIntakeAttachment {
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  docKind: DocKind;
  processable: boolean;
  content: Buffer;
}

export interface NormalizedIntakeMessage {
  providerMessageId: string;
  companyId: string;
  sourceId: string;
  fromEmail: string;
  subject: string;
  receivedAt: Date;
  attachments: NormalizedIntakeAttachment[];
}

/**
 * Normalise a routed raw message into the internal shape the persistence +
 * OCR steps consume. Assumes the caller already matched a source and passed the
 * sender gate.
 */
export function normalizeInboundMessage(
  raw: RawInboundMessage,
  source: EmailSourceRef
): NormalizedIntakeMessage {
  const attachments: NormalizedIntakeAttachment[] = raw.attachments.map((a) => {
    const buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content, "base64");
    return {
      filename: a.filename,
      mimeType: a.mimeType,
      byteSize: buf.byteLength,
      sha256: hashAttachment(buf),
      docKind: classifyDocKind(a.filename, a.mimeType),
      processable: isProcessableAttachment(a),
      content: buf,
    };
  });
  return {
    providerMessageId: raw.providerMessageId,
    companyId: source.companyId,
    sourceId: source.id,
    fromEmail: extractSenderAddress(raw.fromHeader),
    subject: raw.subject ?? "",
    receivedAt: raw.receivedAt,
    attachments,
  };
}
