/**
 * Job Registry
 * ─────────────
 * Registers all scheduled jobs with the central scheduler.
 * Import this module during bootstrap to wire everything up.
 *
 * Job schedule (UAE time, Asia/Dubai UTC+4):
 * ─────────────────────────────────────────
 * 09:00  Document/filing reminders (P3)
 * 09:15  Payment reminders — overdue invoices (P4)
 * 10:00  News ingestion from UAE sources (P5)
 * Every 5 min: Message queue processor
 * 23:59  Reset daily WhatsApp message counter
 *
 * IMPORTANT: Handlers must NOT catch their own errors.
 * The scheduler's executeJob() handles error tracking, status updates,
 * and fail counts. Inner try/catch blocks would swallow errors and
 * mark failed jobs as "completed".
 */

import { registerJob } from '../index';
import { createLogger } from '../../config/logger';

const log = createLogger('jobs');

/**
 * Register all background jobs.
 * Called once during server bootstrap.
 */
export function registerAllJobs(): void {
  log.info('Registering all background jobs...');

  // ── P3: Document / Filing Reminders ─────────────────────────
  registerJob({
    name: 'document_reminders',
    description: 'Send document submission reminders for upcoming compliance deadlines',
    cronExpression: '0 9 * * *', // Daily at 9:00 AM UAE
    handler: async () => {
      const { runDocumentReminders } = await import('./documentReminders');
      await runDocumentReminders();
    },
    enabled: true,
  });

  // ── P4: Payment Reminders ───────────────────────────────────
  registerJob({
    name: 'payment_reminders',
    description: 'Send payment reminders for overdue service invoices',
    cronExpression: '15 9 * * *', // Daily at 9:15 AM UAE
    handler: async () => {
      const { runPaymentReminders } = await import('./paymentReminders');
      await runPaymentReminders();
    },
    enabled: true,
  });

  // ── P5: News Ingestion ──────────────────────────────────────
  registerJob({
    name: 'news_ingestion',
    description: 'Fetch and process tax/compliance news from UAE sources',
    cronExpression: '0 10 * * *', // Daily at 10:00 AM UAE
    handler: async () => {
      const { runNewsIngestion } = await import('./newsIngestion');
      await runNewsIngestion();
    },
    enabled: true,
    timeoutMs: 15 * 60 * 1000, // 15 minutes (involves AI + HTTP)
  });

  // ── Daily Reset: WhatsApp message counter ───────────────────
  // No inner try/catch — let errors propagate to the scheduler
  registerJob({
    name: 'whatsapp_daily_reset',
    description: 'Reset the daily WhatsApp message counter at midnight',
    cronExpression: '59 23 * * *', // Daily at 11:59 PM UAE
    handler: async () => {
      const { storage } = await import('../../storage');
      await storage.resetWhatsappDailyCounter();
      log.info('WhatsApp daily message counter reset');
    },
    enabled: true,
  });

  // ── Message Queue Processor ─────────────────────────────────
  // No inner try/catch — let errors propagate to the scheduler
  registerJob({
    name: 'message_queue_processor',
    description: 'Process queued outbound WhatsApp messages with rate limiting',
    cronExpression: '*/5 * * * *', // Every 5 minutes
    handler: async () => {
      const { processMessageQueue } = await import('../../services/messageQueue');
      await processMessageQueue();
    },
    enabled: true,
  });

  log.info('All background jobs registered');
}
