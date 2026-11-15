import { sql, eq } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import {
  invoices as invoicesTable,
  invoiceLines as invoiceLinesTable,
  recurringInvoices as recurringInvoicesTable,
} from "../../shared/schema";
import { createLogger } from "../config/logger";
import { assertPeriodNotLocked } from "./period-lock.service";
import { allocateInvoiceNumber } from "./invoice-numbering.service";
import { salesLinesSchema, type SalesLineInput } from "../../shared/validators/invoices";
import { dueDateFromTerms, prepareSalesLines, termsFromDays } from "./invoice-lifecycle";
import { issueInvoice, resolveCustomerHeader } from "./invoice-posting.service";
import { getRate } from "./fx/rates";
import { fromFils, mulRate } from "../../shared/money";
import { isCapabilityLive } from "../../shared/capabilities";
import { generateInvoicePDF } from "./pdf-invoice.service";
import { sendInvoiceEmail } from "./email.service";
import { purgeExpiredAuthTokens } from "./auth-tokens.service";
import { scanDueReportDeliveries } from "./report-delivery-scheduler.service";
import { listJobs, registerJob, startRegisteredJobs } from "../platform/job-registry";

const log = createLogger("scheduler");

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
  priority: "low" | "normal" | "high" | "urgent";
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
    ruleType: "due_in_3_days",
    diffDays: 3, // due date is 3 days away
    priority: "normal",
    titleFn: (inv) => `Payment reminder: Invoice #${inv.number} due in 3 days`,
    messageFn: (inv, dueDate) =>
      `Friendly reminder: Invoice #${inv.number} for AED ${inv.total.toFixed(2)} is due on ${formatDate(dueDate)}.`,
  },
  {
    ruleType: "due_today",
    diffDays: 0,
    priority: "high",
    titleFn: (inv) => `Payment due today: Invoice #${inv.number}`,
    messageFn: (inv, _dueDate) =>
      `Invoice #${inv.number} for AED ${inv.total.toFixed(2)} is due today. Please arrange payment.`,
  },
  {
    ruleType: "overdue_7_days",
    diffDays: -7,
    priority: "high",
    titleFn: (inv) => `Overdue: Invoice #${inv.number} (7 days)`,
    messageFn: (inv, _dueDate) =>
      `Follow-up: Invoice #${inv.number} (AED ${inv.total.toFixed(2)}) is now 7 days overdue. Please process payment at your earliest convenience.`,
  },
  {
    ruleType: "overdue_14_days",
    diffDays: -14,
    priority: "urgent",
    titleFn: (inv) => `Overdue: Invoice #${inv.number} (14 days)`,
    messageFn: (inv, _dueDate) =>
      `Second notice: Invoice #${inv.number} (AED ${inv.total.toFixed(2)}) is 14 days overdue. Immediate attention required.`,
  },
  {
    ruleType: "overdue_30_days",
    diffDays: -30,
    priority: "urgent",
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
  return date.toLocaleDateString("en-AE");
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
  let cleaned = (phone || "").replace(/[^\d]/g, "");
  if (!cleaned) return "";
  if (cleaned.length === 10 && cleaned.startsWith("05")) {
    cleaned = "971" + cleaned.substring(1);
  } else if (cleaned.length === 9 && cleaned.startsWith("5")) {
    cleaned = "971" + cleaned;
  } else if (cleaned.startsWith("00")) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1);
  }
  if (cleaned.length < 8 || cleaned.length > 15) return "";
  return cleaned;
}

/**
 * Build a pre-filled wa.me link for the given phone and message text.
 * Returns null if phone is not available.
 */
function buildWhatsAppLink(phone: string | undefined | null, message: string): string | null {
  if (!phone || phone.trim() === "") return null;
  const normalized = normalizePhone(phone);
  // normalizePhone returns "" for unusable inputs (too short/long, invalid).
  if (!normalized || normalized.length < 8) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

// ---------------------------------------------------------------------------
// Scheduler entry point
// ---------------------------------------------------------------------------

/**
 * Built-in jobs owned by this module. Other modules call registerJob()
 * themselves (server/platform/job-registry.ts); initScheduler only starts
 * what is registered, each with per-job try/catch and overlap protection.
 */
function registerBuiltInJobs() {
  const builtIns = [
    {
      // Hourly: scan for payment-related engagement triggers
      name: "engagement.paymentReminderScan",
      cron: "0 * * * *",
      run: async () => {
        log.info("Running hourly payment reminder scan...");
        await scanPaymentReminders();
        log.info("Hourly payment reminder scan complete");
      },
    },
    {
      // Every 30 minutes: autonomous GL classification scan
      name: "gl.autonomousClassificationScan",
      cron: "*/30 * * * *",
      run: async () => {
        log.info("Running autonomous GL classification scan...");
        try {
          const { scanAndClassifyAllCompanies } = await import("../services/autonomous-gl.service");
          await scanAndClassifyAllCompanies();
          log.info("Autonomous GL classification scan complete");
        } catch (err: unknown) {
          const code = (err as { code?: unknown } | null)?.code;
          // If the module doesn't exist yet, log and skip gracefully
          if (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") {
            log.info("autonomous-gl.service not available yet — skipping GL scan");
            return;
          }
          throw err;
        }
      },
    },
    {
      // Daily at 06:00 UTC: generate recurring invoices that are due
      name: "invoices.recurringGeneration",
      cron: "0 6 * * *",
      run: async () => {
        log.info("Running daily recurring invoice generation...");
        await generateDueRecurringInvoices();
        log.info("Daily recurring invoice generation complete");
      },
    },
    {
      // Hourly: sweep expired auth tokens (blacklist, password reset, email verify)
      name: "auth.expiredTokenSweep",
      cron: "15 * * * *",
      run: async () => {
        const result = await purgeExpiredAuthTokens();
        if (result.blacklist + result.passwordReset + result.emailVerification > 0) {
          log.info(result, "Purged expired auth tokens");
        }
      },
    },
    {
      // Hourly: queue due report delivery subscriptions after readiness checks
      name: "reports.deliveryScan",
      cron: "20 * * * *",
      run: async () => {
        log.info("Running report delivery subscription scan...");
        await scanDueReportDeliveries();
        log.info("Report delivery subscription scan complete");
      },
    },
  ];
  const already = new Set(listJobs().map((j) => j.name));
  for (const job of builtIns) if (!already.has(job.name)) registerJob(job);
}

export function initScheduler() {
  log.info("Initializing background scheduler...");
  registerBuiltInJobs();
  const started = startRegisteredJobs();
  log.info(
    { jobs: started },
    "Scheduler initialized — payment scans hourly, GL scans every 30min, recurring invoices daily at 06:00 UTC, auth-token sweep hourly, report delivery scan hourly"
  );
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
      log.error({ err, companyId: company.id }, "Error scanning reminders for company");
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
  const customerByName = new Map<string, (typeof customers)[number]>();
  for (const c of customers) {
    customerByName.set(c.name, c);
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Filter to unpaid invoices
  const unpaid = invoices.filter((inv) => inv.status !== "paid" && inv.status !== "void");

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
      const message = waLink ? `${baseMessage}\n\nSend reminder: ${waLink}` : baseMessage;

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
  priority: "low" | "normal" | "high" | "urgent";
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
        type: "payment_due",
        title: params.title,
        message: params.message,
        priority: params.priority,
        relatedEntityType: "invoice",
        relatedEntityId: params.invoice.id,
        actionUrl: `/invoices`,
        isRead: false,
        isDismissed: false,
      });
    } catch (err) {
      log.error(
        { err, userId: cu.userId, invoiceId: params.invoice.id },
        "Failed to create notification"
      );
    }
  }

  // Log the reminder to prevent duplicates
  try {
    await storage.createReminderLog({
      companyId: params.companyId,
      reminderType: params.ruleType,
      relatedEntityType: "invoice",
      relatedEntityId: params.invoice.id,
      channel: "in_app",
      status: "sent",
      attemptNumber: 1,
      sentAt: new Date(),
    });
  } catch (err) {
    log.error({ err, invoiceId: params.invoice.id }, "Failed to create reminder log");
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
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;
    case "quarterly":
      next.setMonth(next.getMonth() + 3);
      break;
    case "yearly":
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
export async function generateDueRecurringInvoices(): Promise<number> {
  // Process one template at a time, holding a row lock per iteration so
  // concurrent cron runners can't pick the same template (SELECT ... FOR
  // UPDATE SKIP LOCKED). With SKIP LOCKED only one runner ever processes a
  // template, so the FTA sequential allocator can be used safely.
  //
  // `seen` prevents infinite loops: a skipped template (period lock, missing
  // rate, invalid lines disabled, ...) leaves next_run_date untouched, so the
  // SELECT would re-pick the same row in this tick.
  //
  // W3-A (R03-12, R03-23): lines are re-validated with the invoice line
  // contract, totals come from document-totals (fils, discounts, supply
  // types), the invoice carries the FX rate at generation (fx.getRate for the
  // company), and the revenue entry is posted through invoice-posting
  // (supply-type split, ledger kernel) — never with custom JE code. Each
  // template chooses draft vs auto-issue and optional auto-send; the outcome
  // is recorded honestly on the template (last_run_status / message).
  let processed = 0;
  const seen = new Set<string>();

  while (true) {
    type ProcessResult =
      | null
      | { skipped: true }
      | {
          skipped: false;
          template: typeof recurringInvoicesTable.$inferSelect;
          invoice: typeof invoicesTable.$inferSelect;
        };

    let result: ProcessResult;
    let claimed = false;
    try {
      result = await db.transaction(async (tx: typeof db) => {
        const template = await storage.fetchAndLockNextDueRecurringInvoice(tx, Array.from(seen));
        if (!template) return null;
        seen.add(template.id);
        claimed = true;
        const now = new Date();
        const note = async (status: string, message: string, disable = false) => {
          await tx
            .update(recurringInvoicesTable)
            .set({
              lastRunStatus: status,
              lastRunMessage: message,
              lastRunAt: now,
              ...(disable ? { isActive: false } : {}),
            })
            .where(eq(recurringInvoicesTable.id, template.id));
          return { skipped: true as const };
        };

        if (template.endDate && new Date(template.endDate) < now) {
          log.info({ templateId: template.id }, "Recurring template past endDate — disabled");
          return note("ended", "End date reached; template disabled", true);
        }

        let parsedLines: SalesLineInput[];
        try {
          parsedLines = salesLinesSchema.parse(JSON.parse(template.linesJson));
        } catch (err) {
          log.error(
            { err, templateId: template.id },
            "Recurring template has invalid lines — disabling"
          );
          return note("invalid", "Template lines are invalid; template disabled", true);
        }
        let prepared: ReturnType<typeof prepareSalesLines>;
        try {
          prepared = prepareSalesLines(
            parsedLines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              vatRate: l.vatRate,
              vatSupplyType: l.vatSupplyType ?? null,
              discountType: l.discountType ?? null,
              discountValue: l.discountValue ?? null,
              productId: l.productId ?? null,
              costCenterId: l.costCenterId ?? null,
            }))
          );
        } catch (err) {
          return note("invalid", `Template lines are invalid: ${(err as Error)?.message}`, true);
        }

        const dateIso = now.toISOString().slice(0, 10);
        const invoiceDate = new Date(`${dateIso}T00:00:00.000Z`);
        try {
          await assertPeriodNotLocked(template.companyId, invoiceDate);
        } catch (err) {
          log.warn(
            { err: (err as Error)?.message, templateId: template.id },
            "Skipping recurring invoice generation — target period is locked"
          );
          return note("period_locked", "Target period is locked; will retry");
        }

        const currency = (template.currency || "AED").toUpperCase();
        let rate = 1;
        if (currency !== "AED") {
          try {
            rate = (await getRate(template.companyId, currency, "AED", dateIso)).rate;
          } catch (err) {
            return note(
              "no_exchange_rate",
              `No ${currency}→AED rate for ${dateIso}: ${(err as Error)?.message ?? "missing"}; will retry`
            );
          }
        }

        let header;
        try {
          header = await resolveCustomerHeader(
            template.companyId,
            {
              contactId: template.contactId,
              customerName: template.customerName,
              customerTrn: template.customerTrn,
              customerAddress: template.customerAddress,
              paymentTerms: template.paymentTerms,
              placeOfSupplyEmirate: template.placeOfSupplyEmirate,
              date: dateIso,
            },
            { dueDateFromTerms, termsFromDays }
          );
        } catch {
          return note("invalid", "Template contact no longer exists; template disabled", true);
        }

        const { rows, totals } = prepared;
        const newNumber = await allocateInvoiceNumber(
          template.companyId,
          "invoice",
          invoiceDate,
          tx
        );
        const baseFils =
          totals.totalFils === 0
            ? 0
            : currency === "AED"
              ? totals.totalFils
              : mulRate(totals.totalFils, rate);
        const [insertedInvoice] = await tx
          .insert(invoicesTable)
          .values({
            companyId: template.companyId,
            number: newNumber,
            customerName: header.customerName,
            customerTrn: header.customerTrn,
            customerAddress: header.customerAddress,
            contactId: header.contactId,
            paymentTerms: header.paymentTerms,
            dueDate: header.dueDate ? new Date(`${header.dueDate}T00:00:00.000Z`) : null,
            placeOfSupplyEmirate: header.placeOfSupplyEmirate,
            date: invoiceDate,
            currency,
            exchangeRate: rate,
            baseCurrencyAmount: Number(fromFils(baseFils)),
            subtotal: Number(fromFils(totals.subtotalFils)),
            vatAmount: Number(fromFils(totals.vatFils)),
            total: Number(fromFils(totals.totalFils)),
            discountAmount: Number(fromFils(totals.discountFils)),
            status: "draft",
            invoiceType: "invoice",
          })
          .returning();
        for (const r of rows) {
          await tx.insert(invoiceLinesTable).values({
            invoiceId: insertedInvoice.id,
            description: r.description,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            vatRate: r.vatRate,
            vatSupplyType: r.vatSupplyType,
            discountType: r.discountType,
            discountValue: r.discountValue,
            discountAmount: r.discountAmount,
            netAmount: r.netAmount,
            productId: r.productId,
            costCenterId: r.costCenterId,
          });
        }

        const advancedNextRunDate = advanceByInterval(
          new Date(template.nextRunDate),
          template.frequency
        );
        await tx
          .update(recurringInvoicesTable)
          .set({
            nextRunDate: advancedNextRunDate,
            lastGeneratedInvoiceId: insertedInvoice.id,
            totalGenerated: sql`${recurringInvoicesTable.totalGenerated} + 1`,
            lastRunStatus: "generated",
            lastRunMessage: `Generated ${newNumber} as draft`,
            lastRunAt: now,
          })
          .where(eq(recurringInvoicesTable.id, template.id));

        return { skipped: false as const, template, invoice: insertedInvoice };
      });
    } catch (err) {
      // Per-template error boundary: one failure must not starve the others.
      // A failure before a template was claimed (the queue query itself) would
      // repeat forever, so stop the tick instead.
      log.error({ err }, "Recurring invoice tx failed for one template — continuing with others");
      if (!claimed) break;
      continue;
    }

    if (result === null) break;
    processed++;
    if (result.skipped) continue;

    const { template, invoice } = result;
    const outcome = await finishGeneratedInvoice(template, invoice);
    await db
      .update(recurringInvoicesTable)
      .set({ lastRunStatus: outcome.status, lastRunMessage: outcome.message })
      .where(eq(recurringInvoicesTable.id, template.id));
    log.info(
      { templateId: template.id, newInvoiceId: invoice.id, outcome: outcome.status },
      "Generated recurring invoice from template"
    );
  }

  log.info({ processed }, "Recurring invoice generation cycle complete");
  return processed;
}

/**
 * After the draft is committed: issue it when the template auto-issues (posts
 * revenue through invoice-posting with the supply-type split), then email it
 * when auto-send is on. Every outcome is reported honestly — an issued invoice
 * with no email provider is "issued_not_sent", never "sent".
 */
async function finishGeneratedInvoice(
  template: typeof recurringInvoicesTable.$inferSelect,
  invoice: typeof invoicesTable.$inferSelect
): Promise<{ status: string; message: string }> {
  if (!template.autoIssue) {
    return { status: "generated", message: `Generated ${invoice.number} as a draft for review` };
  }
  const owners = await storage.getCompanyUsersByCompanyId(template.companyId);
  const owner = owners.find((u: { role?: string }) => u.role === "owner") ?? owners[0];
  if (!owner) {
    return {
      status: "issue_failed",
      message: `Generated ${invoice.number} as a draft: no company user to attribute the posting to`,
    };
  }
  try {
    await issueInvoice(invoice.id, template.companyId, owner.userId, "sent");
  } catch (err) {
    log.error({ err, invoiceId: invoice.id }, "Recurring invoice could not be issued");
    return {
      status: "issue_failed",
      message: `Generated ${invoice.number} as a draft; issuing failed: ${(err as Error)?.message}`,
    };
  }
  if (!template.autoSend) {
    return { status: "issued", message: `Issued ${invoice.number}` };
  }
  if (!template.sendToEmail || !isCapabilityLive("email")) {
    return {
      status: "issued_not_sent",
      message: `Issued ${invoice.number}; not emailed: no email provider is configured`,
    };
  }
  try {
    const company = await storage.getCompany(template.companyId);
    const fresh = await storage.getInvoice(invoice.id, template.companyId);
    const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
    if (!company || !fresh) throw new Error("invoice or company missing");
    const pdf = await generateInvoicePDF(fresh, lines, company);
    await sendInvoiceEmail(template.sendToEmail, fresh, company, pdf);
    return {
      status: "sent",
      message: `Issued ${invoice.number} and emailed ${template.sendToEmail}`,
    };
  } catch (err) {
    return {
      status: "issued_not_sent",
      message: `Issued ${invoice.number}; email failed: ${(err as Error)?.message}`,
    };
  }
}
