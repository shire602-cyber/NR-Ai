import cron from 'node-cron';
import { storage } from '../storage';
import { createLogger } from '../config/logger';
import { assertPeriodNotLocked } from './period-lock.service';
import { UAE_VAT_RATE, ACCOUNT_CODES } from '../constants';

const log = createLogger('scheduler');

/**
 * Background scheduler for the Client Engagement Automation Engine.
 *
 * Scans for engagement triggers (overdue invoices, upcoming due dates)
 * and creates in-app notifications prompting the user to send WhatsApp
 * messages. No messages are sent automatically -- all WhatsApp sends
 * remain manual via wa.me links.
 *
 * 5-Level Escalation Engine:
 *   Level 1 (Day -3): Gentle reminder — normal priority
 *   Level 2 (Day  0): Due today alert — high priority
 *   Level 3 (Day +7): First follow-up — high priority
 *   Level 4 (Day +14): Second follow-up — urgent priority
 *   Level 5 (Day +30): Final notice — urgent priority
 *
 * UAE weekend skipping: If a trigger date falls on Friday or Saturday,
 * the reminder fires on the preceding Thursday instead.
 */

// ---------------------------------------------------------------------------
// Escalation level definitions
// ---------------------------------------------------------------------------

interface EscalationLevel {
  ruleType: string;
  /** Positive = days before due, negative = days after due */
  diffDays: number;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  titleFn: (inv: InvoiceInfo, overdueDays: number) => string;
  messageFn: (inv: InvoiceInfo, dueDate: Date) => string;
}

interface InvoiceInfo {
  id: string;
  number: string;
  total: number;
  customerName: string;
}

const ESCALATION_LEVELS: EscalationLevel[] = [
  {
    ruleType: 'due_in_3_days',
    diffDays: 3, // due date is 3 days away
    priority: 'normal',
    titleFn: (inv) => `Payment reminder: Invoice #${inv.number} due in 3 days`,
    messageFn: (inv, dueDate) =>
      `Friendly reminder: Invoice #${inv.number} for AED ${inv.total.toFixed(2)} is due on ${formatDate(dueDate)}.`,
  },
  {
    ruleType: 'due_today',
    diffDays: 0,
    priority: 'high',
    titleFn: (inv) => `Payment due today: Invoice #${inv.number}`,
    messageFn: (inv, _dueDate) =>
      `Invoice #${inv.number} for AED ${inv.total.toFixed(2)} is due today. Please arrange payment.`,
  },
  {
    ruleType: 'overdue_7_days',
    diffDays: -7,
    priority: 'high',
    titleFn: (inv) => `Overdue: Invoice #${inv.number} (7 days)`,
    messageFn: (inv, _dueDate) =>
      `Follow-up: Invoice #${inv.number} (AED ${inv.total.toFixed(2)}) is now 7 days overdue. Please process payment at your earliest convenience.`,
  },
  {
    ruleType: 'overdue_14_days',
    diffDays: -14,
    priority: 'urgent',
    titleFn: (inv) => `Overdue: Invoice #${inv.number} (14 days)`,
    messageFn: (inv, _dueDate) =>
      `Second notice: Invoice #${inv.number} (AED ${inv.total.toFixed(2)}) is 14 days overdue. Immediate attention required.`,
  },
  {
    ruleType: 'overdue_30_days',
    diffDays: -30,
    priority: 'urgent',
    titleFn: (inv) => `Final notice: Invoice #${inv.number} (30 days overdue)`,
    messageFn: (inv, _dueDate) =>
      `Final notice: Invoice #${inv.number} (AED ${inv.total.toFixed(2)}) is 30 days overdue. Please contact us immediately to resolve this outstanding balance.`,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * If the given date falls on a UAE weekend (Friday = 5, Saturday = 6),
 * shift it back to the preceding Thursday (day 4).
 */
function skipUAEWeekend(date: Date): Date {
  const adjusted = new Date(date);
  const day = adjusted.getDay();
  if (day === 5) {
    // Friday → shift back 1 day to Thursday
    adjusted.setDate(adjusted.getDate() - 1);
  } else if (day === 6) {
    // Saturday → shift back 2 days to Thursday
    adjusted.setDate(adjusted.getDate() - 2);
  }
  return adjusted;
}

/**
 * Format a date for display in notification messages (en-AE locale).
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-AE');
}

/**
 * Normalize a phone number for wa.me links. Mirrors the client-side
 * formatter in client/src/lib/whatsapp-templates.ts so links generated
 * server-side and client-side stay consistent.
 *
 * Rules:
 *   - 10 digits starting "05"  → strip leading 0, prefix "971" (UAE mobile)
 *   - 9 digits starting "5"    → prefix "971" (UAE mobile w/o 0)
 *   - leading "00"             → drop (international prefix)
 *   - leading "0"              → drop (national prefix)
 *   - result must be 8..15 digits (E.164); otherwise return ""
 */
function normalizePhone(phone: string): string {
  let cleaned = (phone || '').replace(/[^\d]/g, '');
  if (!cleaned) return '';
  if (cleaned.length === 10 && cleaned.startsWith('05')) {
    cleaned = '971' + cleaned.substring(1);
  } else if (cleaned.length === 9 && cleaned.startsWith('5')) {
    cleaned = '971' + cleaned;
  } else if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  if (cleaned.length < 8 || cleaned.length > 15) return '';
  return cleaned;
}

/**
 * Build a pre-filled wa.me link for the given phone and message text.
 * Returns null if phone is not available.
 */
function buildWhatsAppLink(phone: string | undefined | null, message: string): string | null {
  if (!phone || phone.trim() === '') return null;
  const normalized = normalizePhone(phone);
  // normalizePhone returns "" for unusable inputs (too short/long, invalid).
  if (!normalized || normalized.length < 8) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

// ---------------------------------------------------------------------------
// Scheduler entry point
// ---------------------------------------------------------------------------

export function initScheduler() {
  log.info('Initializing background scheduler...');

  // Run every hour: scan for payment-related engagement triggers
  cron.schedule('0 * * * *', async () => {
    try {
      log.info('Running hourly payment reminder scan...');
      await scanPaymentReminders();
      log.info('Hourly payment reminder scan complete');
    } catch (err) {
      log.error({ err }, 'Scheduler error during payment reminder scan');
    }
  });

  // Run every 30 minutes: autonomous GL classification scan
  cron.schedule('*/30 * * * *', async () => {
    try {
      log.info('Running autonomous GL classification scan...');
      const { scanAndClassifyAllCompanies } = await import('../services/autonomous-gl.service');
      await scanAndClassifyAllCompanies();
      log.info('Autonomous GL classification scan complete');
    } catch (err: any) {
      // If the module doesn't exist yet, log and skip gracefully
      if (err?.code === 'MODULE_NOT_FOUND' || err?.code === 'ERR_MODULE_NOT_FOUND') {
        log.info('autonomous-gl.service not available yet — skipping GL scan');
      } else {
        log.error({ err }, 'Scheduler error during autonomous GL scan');
      }
    }
  });

  // Run daily at 06:00 UTC: generate recurring invoices that are due
  cron.schedule('0 6 * * *', async () => {
    try {
      log.info('Running daily recurring invoice generation...');
      await generateDueRecurringInvoices();
      log.info('Daily recurring invoice generation complete');
    } catch (err) {
      log.error({ err }, 'Scheduler error during recurring invoice generation');
    }
  });

  log.info('Scheduler initialized — payment scans hourly, GL scans every 30min, recurring invoices daily at 06:00 UTC');
}

// ---------------------------------------------------------------------------
// Invoice date computation
// ---------------------------------------------------------------------------

/**
 * Computes the due date for an invoice based on its issue date and
 * the customer's payment terms (default 30 days).
 */
function computeDueDate(invoiceDate: Date, paymentTerms: number): Date {
  const due = new Date(invoiceDate);
  due.setDate(due.getDate() + paymentTerms);
  return due;
}

/**
 * Builds a unique key for deduplicating reminder logs so the same
 * reminder is not created twice for the same invoice + rule.
 */
function reminderKey(invoiceId: string, rule: string): string {
  return `${rule}::${invoiceId}`;
}

// ---------------------------------------------------------------------------
// Payment reminder scanning
// ---------------------------------------------------------------------------

/**
 * Scans all companies for invoices that match engagement rules and
 * creates notifications for the company owner(s).
 */
async function scanPaymentReminders() {
  const companies = await storage.getAllCompanies();

  for (const company of companies) {
    try {
      await scanCompanyPaymentReminders(company.id);
    } catch (err) {
      log.error({ err, companyId: company.id }, 'Error scanning reminders for company');
    }
  }
}

/**
 * For a single company, check all unpaid invoices against the 5-level
 * escalation engine and create notifications where appropriate.
 *
 * UAE weekend skipping is applied: if the trigger date for a given
 * escalation level falls on Friday or Saturday, the reminder fires
 * on the preceding Thursday instead.
 */
async function scanCompanyPaymentReminders(companyId: string) {
  const invoices = await storage.getInvoicesByCompanyId(companyId);
  const customers = await storage.getCustomerContactsByCompanyId(companyId);
  const existingLogs = await storage.getReminderLogsByCompanyId(companyId);
  const companyUsers = await storage.getCompanyUsersByCompanyId(companyId);

  // Build a set of already-sent reminder keys for dedup
  const sentKeys = new Set<string>();
  for (const rl of existingLogs) {
    if (rl.relatedEntityId && rl.reminderType) {
      sentKeys.add(reminderKey(rl.relatedEntityId, rl.reminderType));
    }
  }

  // Build a lookup of customer name -> customer
  const customerByName = new Map<string, typeof customers[number]>();
  for (const c of customers) {
    customerByName.set(c.name, c);
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Filter to unpaid invoices
  const unpaid = invoices.filter(
    (inv) => inv.status !== 'paid' && inv.status !== 'void'
  );

  for (const inv of unpaid) {
    const customer = customerByName.get(inv.customerName);
    const paymentTerms = customer?.paymentTerms ?? 30;
    const dueDate = computeDueDate(new Date(inv.date), paymentTerms);
    const dueDateStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

    // Evaluate each escalation level
    for (const level of ESCALATION_LEVELS) {
      // Compute the target trigger date for this level.
      // For due_in_3_days (diffDays = 3): trigger when today is 3 days before due.
      // For overdue_7_days (diffDays = -7): trigger when today is 7 days after due.
      const triggerDate = new Date(dueDateStart);
      triggerDate.setDate(triggerDate.getDate() - level.diffDays);

      // Apply UAE weekend skipping — if the trigger falls on Fri/Sat, shift to Thu
      const adjustedTrigger = skipUAEWeekend(triggerDate);
      const adjustedTriggerStart = new Date(
        adjustedTrigger.getFullYear(),
        adjustedTrigger.getMonth(),
        adjustedTrigger.getDate()
      );

      // Check if today matches the adjusted trigger date
      if (todayStart.getTime() !== adjustedTriggerStart.getTime()) {
        continue;
      }

      const invoiceInfo: InvoiceInfo = {
        id: inv.id,
        number: inv.number,
        total: inv.total,
        customerName: inv.customerName,
      };

      const overdueDays = Math.abs(level.diffDays);
      const title = level.titleFn(invoiceInfo, overdueDays);
      const baseMessage = level.messageFn(invoiceInfo, dueDateStart);

      // Build the WhatsApp wa.me link if the customer has a phone number.
      // Prefer the dedicated WhatsApp number when set; fall back to phone.
      const customerPhone = customer?.whatsappNumber?.trim() || customer?.phone;
      const waLink = buildWhatsAppLink(customerPhone, baseMessage);
      const message = waLink
        ? `${baseMessage}\n\nSend reminder: ${waLink}`
        : baseMessage;

      await maybeCreateReminder({
        companyId,
        companyUsers,
        invoice: invoiceInfo,
        ruleType: level.ruleType,
        sentKeys,
        title,
        message,
        priority: level.priority,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Reminder creation with dedup
// ---------------------------------------------------------------------------

interface ReminderParams {
  companyId: string;
  companyUsers: { userId: string }[];
  invoice: { id: string; number: string; total: number };
  ruleType: string;
  sentKeys: Set<string>;
  title: string;
  message: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
}

/**
 * Creates a notification + reminder log if one hasn't already been sent
 * for this invoice + rule combination.
 */
async function maybeCreateReminder(params: ReminderParams) {
  const key = reminderKey(params.invoice.id, params.ruleType);
  if (params.sentKeys.has(key)) {
    return; // Already sent this reminder
  }

  // Create a notification for each user associated with the company
  for (const cu of params.companyUsers) {
    try {
      await storage.createNotification({
        userId: cu.userId,
        companyId: params.companyId,
        type: 'payment_due',
        title: params.title,
        message: params.message,
        priority: params.priority,
        relatedEntityType: 'invoice',
        relatedEntityId: params.invoice.id,
        actionUrl: `/invoices`,
        isRead: false,
        isDismissed: false,
      });
    } catch (err) {
      log.error({ err, userId: cu.userId, invoiceId: params.invoice.id }, 'Failed to create notification');
    }
  }

  // Log the reminder to prevent duplicates
  try {
    await storage.createReminderLog({
      companyId: params.companyId,
      reminderType: params.ruleType,
      relatedEntityType: 'invoice',
      relatedEntityId: params.invoice.id,
      channel: 'in_app',
      status: 'sent',
      attemptNumber: 1,
      sentAt: new Date(),
    });
  } catch (err) {
    log.error({ err, invoiceId: params.invoice.id }, 'Failed to create reminder log');
  }

  params.sentKeys.add(key);
  log.info(
    { companyId: params.companyId, invoiceId: params.invoice.id, rule: params.ruleType },
    `Created payment reminder notification`
  );
}

// ---------------------------------------------------------------------------
// Recurring invoice generation
// ---------------------------------------------------------------------------

/**
 * Advances a date by the given recurring interval.
 */
function advanceByInterval(date: Date, interval: string): Date {
  const next = new Date(date);
  switch (interval) {
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    case 'quarterly':
      next.setMonth(next.getMonth() + 3);
      break;
    case 'yearly':
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

/**
 * Reads the `recurring_invoices` table for active templates whose
 * `next_run_date` has arrived, generates a fresh invoice for each (with the
 * matching revenue-recognition journal entry), and advances the template's
 * `next_run_date` atomically.
 *
 * Idempotency: each template row is "claimed" via a CAS update on
 * next_run_date. If two cron invocations overlap, only one will succeed in
 * the claim and proceed to generate. The other will see the row's
 * next_run_date already advanced and fall out of the due query on the next
 * pass.
 *
 * Why we no longer scan invoices.is_recurring: that approach was a parallel
 * subsystem that the recurring-invoices.routes.ts API never wrote to, so
 * recurring schedules created through the UI were never picked up.
 */
async function generateDueRecurringInvoices() {
  const dueTemplates = await storage.getDueRecurringInvoices();
  log.info({ count: dueTemplates.length }, 'Recurring invoice templates due for generation');

  const today = new Date();

  for (const template of dueTemplates) {
    try {
      // Skip and disable if past end date.
      if (template.endDate && new Date(template.endDate) < today) {
        await storage.updateRecurringInvoice(template.id, { isActive: false } as any);
        log.info({ templateId: template.id }, 'Recurring template past endDate — disabled');
        continue;
      }

      // Parse line items from the template.
      let templateLines: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        vatRate?: number;
        vatSupplyType?: string;
      }>;
      try {
        templateLines = JSON.parse(template.linesJson);
      } catch (err) {
        log.error({ err, templateId: template.id }, 'Recurring template has invalid linesJson — skipping');
        continue;
      }
      if (!Array.isArray(templateLines) || templateLines.length === 0) {
        log.warn({ templateId: template.id }, 'Recurring template has no lines — skipping');
        continue;
      }

      // Compute totals up front for the new invoice.
      let subtotal = 0;
      let vatAmount = 0;
      for (const line of templateLines) {
        const lineTotal = line.quantity * line.unitPrice;
        subtotal += lineTotal;
        vatAmount += lineTotal * (line.vatRate ?? UAE_VAT_RATE);
      }
      const total = subtotal + vatAmount;

      const invoiceDate = new Date();
      const expectedNextRunDate = new Date(template.nextRunDate);
      const advancedNextRunDate = advanceByInterval(expectedNextRunDate, template.frequency);

      // Skip generation if the target invoice date is in a locked period —
      // the resulting invoice would be impossible to post a JE for, and
      // future-dated invoices for closed periods break VAT/CT reporting.
      try {
        await assertPeriodNotLocked(template.companyId, invoiceDate);
      } catch (err: any) {
        log.warn(
          { err: err?.message, templateId: template.id, companyId: template.companyId },
          'Skipping recurring invoice generation — target period is locked'
        );
        continue;
      }

      // Generate a unique invoice number scoped to this template.
      const newNumber = `R-${template.id.slice(0, 8)}-${expectedNextRunDate.toISOString().slice(0, 10)}`;

      // Create the invoice + lines first. We claim the template (CAS) only
      // after the invoice is durable, so a crash in the middle leaves the
      // template's next_run_date untouched and the next cron retries.
      const newInvoice = await storage.createInvoice({
        companyId: template.companyId,
        number: newNumber,
        customerName: template.customerName,
        customerTrn: template.customerTrn || undefined,
        date: invoiceDate,
        currency: template.currency,
        subtotal,
        vatAmount,
        total,
        status: 'sent',
        invoiceType: 'invoice',
      } as any);

      for (const line of templateLines) {
        await storage.createInvoiceLine({
          invoiceId: newInvoice.id,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          vatRate: line.vatRate ?? UAE_VAT_RATE,
          vatSupplyType: line.vatSupplyType || undefined,
        } as any);
      }

      // Try to claim the template. If we lose, another runner already
      // generated for this period — drop the just-created invoice to avoid
      // a duplicate.
      const claim = await storage.tryClaimRecurringInvoice(
        template.id,
        expectedNextRunDate,
        advancedNextRunDate,
        newInvoice.id,
      );
      if (!claim) {
        log.warn(
          { templateId: template.id, droppedInvoiceId: newInvoice.id },
          'Lost CAS race for recurring template — dropping duplicate invoice',
        );
        try {
          await storage.safeDeleteInvoice(newInvoice.id);
        } catch (cleanupErr) {
          log.error({ cleanupErr, invoiceId: newInvoice.id }, 'Failed to clean up duplicate recurring invoice');
        }
        continue;
      }

      // Post revenue-recognition journal entry. journal_entries.created_by
      // is NOT NULL FK → users.id, so we attribute system-generated entries
      // to a company owner. If none found, we leave the invoice unposted and
      // log loudly — accounting can post manually.
      try {
        const owners = await storage.getCompanyUsersByCompanyId(template.companyId);
        const owner = owners.find((u: any) => u.role === 'owner') ?? owners[0];
        if (!owner) {
          log.warn(
            { templateId: template.id, invoiceId: newInvoice.id },
            'Recurring invoice generated but no company user found for GL attribution — manual posting needed',
          );
        } else {
          const accounts = await storage.getAccountsByCompanyId(template.companyId);
          const accountsReceivable = accounts.find(a => a.code === ACCOUNT_CODES.AR && a.isSystemAccount);
          const salesRevenue = accounts.find(
            a => a.isSystemAccount && a.type === 'income' && (a.code === ACCOUNT_CODES.REVENUE || a.code === ACCOUNT_CODES.REVENUE_ALT),
          );
          const vatPayable = accounts.find(a => a.isVatAccount && a.vatType === 'output' && a.code === ACCOUNT_CODES.VAT_OUTPUT);

          if (accountsReceivable && salesRevenue) {
            const entryNumber = await storage.generateEntryNumber(template.companyId, invoiceDate);
            const lines: Array<{
              accountId: string;
              debit: number;
              credit: number;
              description: string;
            }> = [
              {
                accountId: accountsReceivable.id,
                debit: total,
                credit: 0,
                description: `Recurring invoice ${newInvoice.number}`,
              },
              {
                accountId: salesRevenue.id,
                debit: 0,
                credit: subtotal,
                description: `Recurring revenue ${newInvoice.number}`,
              },
            ];
            if (vatAmount > 0 && vatPayable) {
              lines.push({
                accountId: vatPayable.id,
                debit: 0,
                credit: vatAmount,
                description: `Recurring VAT ${newInvoice.number}`,
              });
            }
            await storage.createJournalEntry(
              {
                companyId: template.companyId,
                date: invoiceDate,
                memo: `Recurring sales invoice ${newInvoice.number} - ${template.customerName}`,
                entryNumber,
                status: 'posted',
                source: 'invoice',
                sourceId: newInvoice.id,
                createdBy: owner.userId,
                postedBy: owner.userId,
                postedAt: invoiceDate,
              } as any,
              lines as any,
            );
          } else {
            log.warn(
              { templateId: template.id, invoiceId: newInvoice.id },
              'Recurring invoice generated but GL accounts missing — manual posting needed',
            );
          }
        }
      } catch (jeErr) {
        log.error(
          { jeErr, templateId: template.id, invoiceId: newInvoice.id },
          'Recurring invoice created but failed to post GL — manual intervention required',
        );
      }

      log.info(
        { templateId: template.id, newInvoiceId: newInvoice.id, nextDate: advancedNextRunDate },
        'Generated recurring invoice from template',
      );
    } catch (err) {
      log.error({ err, templateId: template.id }, 'Failed to generate recurring invoice');
    }
  }
}
