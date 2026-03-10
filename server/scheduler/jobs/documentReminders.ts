/**
 * Document Submission Reminders Job
 * ──────────────────────────────────
 * Scans for upcoming compliance task deadlines and expiring documents,
 * then queues WhatsApp reminders to the relevant client companies.
 *
 * Runs daily at 9:00 AM UAE time.
 *
 * What it does:
 * 1. Batch-loads all relevant companies (no N+1 queries)
 * 2. Finds compliance tasks due within the next 7 days
 * 3. Finds documents expiring within their reminder window
 * 4. Queues personalized WhatsApp messages via the message queue
 * 5. Marks tasks/documents as reminded to avoid duplicates
 * 6. Logs everything to reminderLogs for audit trail
 */

import { createLogger } from '../../config/logger';
import { storage } from '../../storage';
import { enqueueTemplatedMessage } from '../../services/messageQueue';
import {
  mapLocaleToLanguage,
  cleanPhone,
  formatDate,
  daysUntil,
  priorityFromDays,
  buildCompanyMap,
} from '../../utils/locale';

const log = createLogger('job:document-reminders');

const COMPLIANCE_DAYS_AHEAD = 7;
const DOCUMENT_EXPIRY_DAYS_AHEAD = 30;

/**
 * Main handler: scan and send document/filing reminders.
 */
export async function runDocumentReminders(): Promise<void> {
  log.info('Starting document reminder scan...');

  let remindersQueued = 0;

  // ── Batch-load companies into a map for O(1) lookup ──────────
  const companyMap = await buildCompanyMap();

  // ── 1. Compliance Tasks (VAT filings, tax deadlines, etc.) ──
  try {
    const upcomingTasks = await storage.getUpcomingComplianceTasks(COMPLIANCE_DAYS_AHEAD);
    log.info({ count: upcomingTasks.length }, 'Found upcoming compliance tasks');

    for (const task of upcomingTasks) {
      try {
        const company = companyMap.get(task.companyId);
        if (!company || !company.contactPhone) {
          continue;
        }

        const phone = cleanPhone(company.contactPhone);
        if (!phone) continue;

        const language = mapLocaleToLanguage(company.locale);
        const remaining = daysUntil(task.dueDate);
        if (remaining < 0) continue; // Already past due

        const dueDate = formatDate(task.dueDate);

        await enqueueTemplatedMessage({
          templateName: 'document_reminder',
          language,
          recipientPhone: phone,
          recipientName: company.name,
          placeholders: {
            clientName: company.name,
            documentType: task.title,
            dueDate,
            daysRemaining: String(remaining),
          },
          companyId: company.id,
          relatedEntityType: 'compliance_task',
          relatedEntityId: task.id,
          priority: priorityFromDays(remaining),
        });

        // Mark the task as reminded
        await storage.updateComplianceTask(task.id, {
          reminderSent: true,
        });

        // Log the reminder
        await storage.createReminderLog({
          companyId: company.id,
          reminderType: 'document_submission',
          relatedEntityType: 'compliance_task',
          relatedEntityId: task.id,
          recipientPhone: company.contactPhone,
          channel: 'whatsapp',
          status: 'pending',
          attemptNumber: 1,
        });

        remindersQueued++;
        log.info(
          { companyName: company.name, taskTitle: task.title, daysRemaining: remaining },
          'Compliance task reminder queued'
        );
      } catch (err: any) {
        log.error({ taskId: task.id, error: err.message }, 'Failed to queue compliance reminder');
      }
    }
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to scan compliance tasks');
  }

  // ── 2. Expiring Documents (trade licenses, certificates, etc.) ──
  try {
    const expiringDocs = await storage.getExpiringDocuments(DOCUMENT_EXPIRY_DAYS_AHEAD);
    log.info({ count: expiringDocs.length }, 'Found expiring documents');

    for (const doc of expiringDocs) {
      try {
        // Skip if expiryDate is null (shouldn't happen given the query, but be safe)
        if (!doc.expiryDate) continue;

        const company = companyMap.get(doc.companyId);
        if (!company || !company.contactPhone) continue;

        const phone = cleanPhone(company.contactPhone);
        if (!phone) continue;

        const language = mapLocaleToLanguage(company.locale);
        const remaining = daysUntil(doc.expiryDate);
        if (remaining < 0) continue;

        // Only send if within the document's custom reminder window
        if (doc.reminderDays && remaining > doc.reminderDays) {
          continue;
        }

        const expiryDate = formatDate(doc.expiryDate);

        await enqueueTemplatedMessage({
          templateName: 'document_reminder',
          language,
          recipientPhone: phone,
          recipientName: company.name,
          placeholders: {
            clientName: company.name,
            documentType: doc.name,
            dueDate: expiryDate,
            daysRemaining: String(remaining),
          },
          companyId: company.id,
          relatedEntityType: 'document',
          relatedEntityId: doc.id,
          priority: remaining <= 7 ? 2 : 5,
        });

        await storage.updateDocument(doc.id, {
          reminderSent: true,
        });

        await storage.createReminderLog({
          companyId: company.id,
          reminderType: 'document_expiry',
          relatedEntityType: 'document',
          relatedEntityId: doc.id,
          recipientPhone: company.contactPhone,
          channel: 'whatsapp',
          status: 'pending',
          attemptNumber: 1,
        });

        remindersQueued++;
        log.info(
          { companyName: company.name, docName: doc.name, daysUntilExpiry: remaining },
          'Document expiry reminder queued'
        );
      } catch (err: any) {
        log.error({ docId: doc.id, error: err.message }, 'Failed to queue document expiry reminder');
      }
    }
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to scan expiring documents');
  }

  log.info({ remindersQueued }, 'Document reminder scan complete');
}

