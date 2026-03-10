/**
 * Payment Reminders Job
 * ─────────────────────
 * Scans for overdue service invoices and queues
 * WhatsApp payment reminder messages to clients.
 *
 * Runs daily at 9:15 AM UAE time.
 *
 * Production fixes:
 * - Batch company loading (no N+1)
 * - Batch reminder log loading (no N+1)
 * - Errors propagate to scheduler for accurate tracking
 * - Null-safe amount formatting
 * - Shared locale utilities
 */

import { createLogger } from '../../config/logger';
import { storage } from '../../storage';
import { enqueueTemplatedMessage } from '../../services/messageQueue';
import {
  mapLocaleToLanguage,
  cleanPhone,
  formatDate,
  buildCompanyMap,
} from '../../utils/locale';
import type { ReminderLog } from '@shared/schema';

const log = createLogger('job:payment-reminders');

/** Maximum number of reminders per invoice */
const MAX_REMINDERS_PER_INVOICE = 5;
/** Minimum days between reminders for the same invoice */
const MIN_DAYS_BETWEEN_REMINDERS = 3;

/**
 * Main handler: scan and send payment reminders for overdue invoices.
 * Errors propagate to the scheduler for correct failure tracking.
 */
export async function runPaymentReminders(): Promise<void> {
  log.info('Starting payment reminder scan...');

  let remindersQueued = 0;

  const overdueInvoices = await storage.getOverdueServiceInvoices();
  log.info({ count: overdueInvoices.length }, 'Found overdue service invoices');

  if (overdueInvoices.length === 0) {
    log.info('No overdue invoices, skipping');
    return;
  }

  // ── Batch-load companies into a map for O(1) lookup ──────
  const companyMap = await buildCompanyMap();

  // ── Batch-load all service_invoice reminder logs (fixes N+1) ──
  const allInvoiceReminders = await storage.getReminderLogsByEntityType('service_invoice');
  const remindersByInvoice = new Map<string, ReminderLog[]>();
  for (const r of allInvoiceReminders) {
    if (!r.relatedEntityId) continue;
    const arr = remindersByInvoice.get(r.relatedEntityId) || [];
    arr.push(r);
    remindersByInvoice.set(r.relatedEntityId, arr);
  }

  for (const invoice of overdueInvoices) {
    try {
      const company = companyMap.get(invoice.companyId);
      if (!company || !company.contactPhone) {
        continue;
      }

      const phone = cleanPhone(company.contactPhone);
      if (!phone) continue;

      const language = mapLocaleToLanguage(company.locale);

      // Calculate days overdue
      const daysOverdue = Math.ceil(
        (Date.now() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      // ── Efficient dedup from pre-loaded reminder logs ──
      const invoiceReminders = remindersByInvoice.get(invoice.id) || [];

      // Max reminders per invoice
      if (invoiceReminders.length >= MAX_REMINDERS_PER_INVOICE) {
        log.debug({ invoiceId: invoice.id, sent: invoiceReminders.length }, 'Max reminders reached');
        continue;
      }

      // Throttle: don't send more than one per 3 days
      const lastReminder = invoiceReminders
        .filter(l => l.sentAt || l.createdAt)
        .sort((a, b) => {
          const dateA = new Date(a.sentAt ?? a.createdAt).getTime();
          const dateB = new Date(b.sentAt ?? b.createdAt).getTime();
          return dateB - dateA;
        })[0];

      if (lastReminder) {
        const lastDate = new Date(lastReminder.sentAt ?? lastReminder.createdAt);
        const daysSinceLast = Math.ceil(
          (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceLast < MIN_DAYS_BETWEEN_REMINDERS) {
          continue;
        }
      }

      // Queue the payment reminder (null-safe amount)
      const amount = (invoice.total ?? 0).toFixed(2);

      await enqueueTemplatedMessage({
        templateName: 'payment_reminder',
        language,
        recipientPhone: phone,
        recipientName: company.name,
        placeholders: {
          clientName: company.name,
          invoiceNumber: invoice.invoiceNumber,
          amount,
          dueDate: formatDate(invoice.dueDate),
          daysOverdue: String(daysOverdue),
        },
        companyId: company.id,
        relatedEntityType: 'service_invoice',
        relatedEntityId: invoice.id,
        priority: daysOverdue > 14 ? 1 : daysOverdue > 7 ? 2 : 3,
      });

      // Update invoice status to overdue if not already
      if (invoice.status !== 'overdue') {
        await storage.updateServiceInvoice(invoice.id, { status: 'overdue' });
      }

      // Log the reminder
      await storage.createReminderLog({
        companyId: company.id,
        reminderType: 'payment_followup',
        relatedEntityType: 'service_invoice',
        relatedEntityId: invoice.id,
        recipientPhone: company.contactPhone,
        channel: 'whatsapp',
        status: 'pending',
        attemptNumber: invoiceReminders.length + 1,
      });

      remindersQueued++;
      log.info(
        { companyName: company.name, invoiceNumber: invoice.invoiceNumber, daysOverdue },
        'Payment reminder queued'
      );
    } catch (err: any) {
      log.error({ invoiceId: invoice.id, error: err.message }, 'Failed to queue payment reminder');
    }
  }

  log.info({ remindersQueued }, 'Payment reminder scan complete');
}

