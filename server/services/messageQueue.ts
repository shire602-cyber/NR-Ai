/**
 * Message Queue Service
 * ─────────────────────
 * FIFO queue with rate limiting for outbound WhatsApp messages.
 *
 * Features:
 * - Business hours enforcement (from DB settings, not hardcoded)
 * - Configurable delay between messages
 * - Daily message cap
 * - Retry logic with exponential backoff (max 3 attempts)
 * - Priority-based ordering
 * - Template placeholder resolution (regex-safe)
 * - Stale "sending" recovery
 * - Path validation for document attachments
 */

import path from 'path';
import { createLogger } from '../config/logger';
import { storage } from '../storage';
import { sendWhatsAppWebMessage, sendWhatsAppWebDocument, isWhatsAppConnected } from './whatsappWeb';
import { resolveTemplatePlaceholders } from '../utils/locale';
import type { InsertMessageQueue } from '@shared/schema';

const log = createLogger('message-queue');

// ── Configuration ───────────────────────────────────────────────

const DEFAULT_DELAY_MS = 3000;
const MAX_BATCH_SIZE = 20;
const RETRY_BASE_DELAY_MS = 60_000; // 1 minute base retry delay
const STALE_SENDING_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/** Allowed base directories for document attachments (no shared dirs like /tmp) */
export const ALLOWED_DOCUMENT_DIRS = [
  path.resolve(process.cwd(), 'uploads'),
  path.resolve(process.cwd(), 'documents'),
  path.resolve(process.cwd(), 'invoices'),
];

/**
 * Check if a resolved file path is within allowed directories.
 * Exported for testing.
 */
export function isPathAllowed(filePath: string): boolean {
  const resolvedPath = path.resolve(filePath);
  return ALLOWED_DOCUMENT_DIRS.some(dir =>
    resolvedPath.startsWith(dir + path.sep) || resolvedPath === dir
  );
}

// ── Core Functions ──────────────────────────────────────────────

/**
 * Add a message to the queue.
 * Returns the queue item ID.
 */
export async function enqueueMessage(
  message: Omit<InsertMessageQueue, 'id' | 'createdAt'>
): Promise<string> {
  const item = await storage.createMessageQueueItem({
    ...message,
    status: 'queued',
    attempts: 0,
  });

  log.info(
    { id: item.id, phone: message.recipientPhone, type: message.messageType },
    'Message enqueued'
  );

  return item.id;
}

/**
 * Add a templated message to the queue.
 * Resolves template placeholders before queuing.
 */
export async function enqueueTemplatedMessage(opts: {
  templateName: string;
  language: string;
  recipientPhone: string;
  recipientName?: string;
  placeholders: Record<string, string>;
  companyId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  priority?: number;
  scheduledFor?: Date;
}): Promise<string> {
  // Fetch the template
  let template = await storage.getMessageTemplate(opts.templateName, opts.language);

  // Fall back to English if not found (with recursion guard)
  if (!template && opts.language !== 'en') {
    template = await storage.getMessageTemplate(opts.templateName, 'en');
    if (template) {
      log.warn({ template: opts.templateName, language: opts.language }, 'Template not found, using English fallback');
    }
  }

  if (!template) {
    throw new Error(`Message template '${opts.templateName}' not found for language '${opts.language}' or 'en'`);
  }

  // Resolve placeholders using safe literal replacement (no regex injection)
  const body = resolveTemplatePlaceholders(template.body, opts.placeholders);

  return enqueueMessage({
    recipientPhone: opts.recipientPhone,
    recipientName: opts.recipientName,
    messageType: 'text',
    content: body,
    companyId: opts.companyId,
    templateId: template.id,
    relatedEntityType: opts.relatedEntityType,
    relatedEntityId: opts.relatedEntityId,
    priority: opts.priority ?? 5,
    scheduledFor: opts.scheduledFor,
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
  });
}

/**
 * Process the message queue.
 * Called by the scheduler every 5 minutes.
 * Sends messages with rate limiting and business hours enforcement.
 */
export async function processMessageQueue(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  recovered: number;
}> {
  const stats = { processed: 0, sent: 0, failed: 0, skipped: 0, recovered: 0 };

  // Check if WhatsApp is connected
  if (!isWhatsAppConnected()) {
    log.warn('WhatsApp Web is not connected, skipping queue processing');
    return stats;
  }

  // Load session settings from DB
  const session = await storage.getWhatsappWebSession();
  const businessHoursStart = session?.businessHoursStart ?? 9;
  const businessHoursEnd = session?.businessHoursEnd ?? 18;
  const dailyLimit = session?.dailyMessageLimit ?? 100;
  const delayMs = session?.messageDelayMs ?? DEFAULT_DELAY_MS;

  // Check business hours (from DB settings, not hardcoded)
  if (!isWithinBusinessHours(businessHoursStart, businessHoursEnd)) {
    log.info({ start: businessHoursStart, end: businessHoursEnd }, 'Outside business hours, skipping');
    return stats;
  }

  // Check daily limit
  if (session && session.messagesSentToday >= dailyLimit) {
    log.info({ sent: session.messagesSentToday, limit: dailyLimit }, 'Daily limit reached');
    return stats;
  }

  // ── Recover stale "sending" messages ─────────────────────────
  stats.recovered = await recoverStaleSendingMessages();

  // Get queued messages (ordered by priority then creation time)
  const queuedMessages = await storage.getQueuedMessages(MAX_BATCH_SIZE);

  if (queuedMessages.length === 0) {
    return stats;
  }

  log.info({ count: queuedMessages.length }, 'Processing message queue');

  for (const item of queuedMessages) {
    stats.processed++;

    // Check if scheduled for later
    if (item.scheduledFor && new Date(item.scheduledFor) > new Date()) {
      stats.skipped++;
      continue;
    }

    // Re-check daily limit using tracked count (avoids N DB queries per batch)
    const sentSoFar = (session?.messagesSentToday ?? 0) + stats.sent;
    if (sentSoFar >= dailyLimit) {
      log.info({ sent: sentSoFar, limit: dailyLimit }, 'Daily limit reached during processing, stopping');
      break;
    }

    // Mark as sending
    await storage.updateMessageQueueItem(item.id, {
      status: 'sending',
      attempts: item.attempts + 1,
    });

    try {
      let result;

      if (item.messageType === 'document' && item.mediaUrl) {
        // ── Validate file path before reading (prevent path traversal) ──
        const resolvedPath = path.resolve(item.mediaUrl);
        const allowed = isPathAllowed(item.mediaUrl);

        if (!allowed) {
          log.error(
            { id: item.id, path: item.mediaUrl },
            'Document path outside allowed directories — rejecting'
          );
          await storage.updateMessageQueueItem(item.id, {
            status: 'failed',
            lastError: 'Document path not in allowed directory',
          });
          stats.failed++;
          continue;
        }

        // Use async file reading (don't block event loop)
        const fs = await import('fs/promises');
        try {
          const buffer = await fs.readFile(resolvedPath);
          result = await sendWhatsAppWebDocument(
            item.recipientPhone,
            Buffer.from(buffer),
            item.mediaFileName || 'document.pdf',
            item.content
          );
        } catch (fsErr: any) {
          log.error({ id: item.id, path: resolvedPath, error: fsErr.message }, 'Failed to read document file');
          await storage.updateMessageQueueItem(item.id, {
            status: 'failed',
            lastError: `File read error: ${fsErr.message}`,
          });
          stats.failed++;
          continue;
        }
      } else {
        result = await sendWhatsAppWebMessage(item.recipientPhone, item.content);
      }

      if (result.success) {
        await storage.updateMessageQueueItem(item.id, {
          status: 'sent',
          sentAt: new Date(),
        });
        stats.sent++;
        log.info(
          { id: item.id, phone: item.recipientPhone, messageId: result.messageId },
          'Message sent from queue'
        );
      } else {
        const shouldRetry = item.attempts + 1 < item.maxAttempts;
        await storage.updateMessageQueueItem(item.id, {
          status: shouldRetry ? 'queued' : 'failed',
          lastError: result.error || 'Unknown error',
          scheduledFor: shouldRetry
            ? new Date(Date.now() + RETRY_BASE_DELAY_MS * Math.pow(2, item.attempts))
            : undefined,
        });

        if (!shouldRetry) {
          stats.failed++;
          log.error(
            { id: item.id, phone: item.recipientPhone, error: result.error, attempts: item.attempts + 1 },
            'Message permanently failed after max retries'
          );
        } else {
          log.warn(
            { id: item.id, phone: item.recipientPhone, error: result.error, attempt: item.attempts + 1 },
            'Message send failed, will retry'
          );
        }
      }
    } catch (error: any) {
      // Unexpected error — mark as failed to release from "sending" state
      await storage.updateMessageQueueItem(item.id, {
        status: 'failed',
        lastError: error.message || 'Unexpected error',
      });
      stats.failed++;
      log.error({ id: item.id, error: error.message }, 'Unexpected error processing queue item');
    }

    // Rate limiting delay between messages
    await sleep(delayMs);
  }

  log.info(stats, 'Message queue processing complete');
  return stats;
}

/**
 * Cancel a queued message.
 */
export async function cancelQueuedMessage(id: string): Promise<boolean> {
  const item = await storage.getMessageQueueItem(id);
  if (!item || item.status !== 'queued') {
    return false;
  }

  await storage.updateMessageQueueItem(id, { status: 'cancelled' });
  log.info({ id }, 'Queued message cancelled');
  return true;
}

/**
 * Get queue statistics for the admin dashboard.
 */
export async function getQueueStats(): Promise<{
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  cancelled: number;
}> {
  return storage.getMessageQueueStats();
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Check if current time is within business hours.
 * Uses configurable hours from the DB session.
 * Exported for testing.
 */
export function isWithinBusinessHours(startHour: number, endHour: number): boolean {
  const now = new Date();
  const uaeOffset = 4 * 60; // UAE is UTC+4
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const uaeMinutes = utcMinutes + uaeOffset;
  const uaeHour = Math.floor(uaeMinutes / 60) % 24;
  return uaeHour >= startHour && uaeHour < endHour;
}

/**
 * Recover messages stuck in "sending" status (from a previous crash).
 * Messages in "sending" state older than STALE_SENDING_THRESHOLD_MS
 * are reset to "queued" so they can be retried.
 */
async function recoverStaleSendingMessages(): Promise<number> {
  try {
    const recovered = await storage.recoverStaleSendingMessages(STALE_SENDING_THRESHOLD_MS);
    if (recovered > 0) {
      log.warn(
        { recoveredCount: recovered },
        'Recovered stale messages from "sending" state back to "queued"'
      );
    }
    return recovered;
  } catch (err: any) {
    log.warn({ error: err.message }, 'Failed to recover stale sending messages');
    return 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
