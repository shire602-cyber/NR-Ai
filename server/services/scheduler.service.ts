import { sql, eq } from "drizzle-orm";
import { storage } from "../storage";
import { db, pool } from "../db";
import {
  invoices as invoicesTable,
  invoiceLines as invoiceLinesTable,
  recurringInvoices as recurringInvoicesTable,
  type Company,
  type ReminderSetting,
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
import {
  buildReminderEmail,
  sendEmail,
  sendInvoiceEmail,
  type EmailLanguage,
} from "./email.service";
import { registerOutboxJob, type OutgoingAttachment } from "../outbox";
import { registerEventOutboxJob } from "../platform/event-outbox";
import { registerObjectDeletionJob } from "./object-deletion-queue";
import { registerNotificationEngine } from "./notification-engine.service";
import { purgeExpiredAuthTokens } from "./auth-tokens.service";
import { scanDueReportDeliveries } from "./report-delivery-scheduler.service";
import { listJobs, registerJob, startRegisteredJobs } from "../platform/job-registry";

const log = createLogger("scheduler");

/**
 * Background scheduler. Every job goes through the job registry
 * (server/platform/job-registry.ts): per-job try/catch and overlap protection.
 *
 * W4-D: the payment-reminder scan is the dunning engine below (runDunningScan): it reads the
 * company's reminder_settings and contacts the CUSTOMER through the email outbox (and SMS when
 * a provider is configured), idempotently and with catch-up after missed runs. Staff in-app
 * reminders come from the notification engine (server/services/notification-engine.service.ts).
 */

// ---------------------------------------------------------------------------
// Dunning (W4-D: R16-02, R16-03, R16-17)
// ---------------------------------------------------------------------------
//
// The company's reminder_settings drive customer reminders:
//
//   invoice_due_soon   first level at dueDate − daysBeforeDue (default 3)
//   invoice_overdue    first level at dueDate + daysAfterDue (default 1)
//   payment_followup   first level at dueDate + daysAfterDue (default 7)
//
// Further levels follow every repeatIntervalDays, up to maxReminders (one level when no repeat
// interval is set). A level is due once today (UAE calendar date) is on or after its trigger
// date. Each run sends the HIGHEST due level not yet logged for (setting, invoice, channel) and
// logs lower unlogged due levels as "skipped" — so a missed day (downtime, restart) catches up
// with a single message instead of skipping or spamming. The log row is inserted first under a
// unique (setting, invoice, channel, level) key, so concurrent runs can never send twice.
//
// Eligible: issued invoices (sent | posted | partial) with an open balance, not credit notes,
// not doNotChase on the invoice or the contact. The customer is the invoice's contact (by id,
// never by name). Channels: email (outbox; bilingual template; invoice PDF; pay/view link),
// SMS (provider adapter; requires-external until a provider is configured), in-app (a note to
// the company's staff through the notification engine). No WhatsApp to customers.

type DunningChannel = "email" | "sms" | "in_app";

export interface DunningLevelPlan {
  level: number;
  triggerDate: string; // YYYY-MM-DD (UAE)
}

const DAY_MS = 86_400_000;
const uaeDate = (d: Date) => new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Pure: the levels of one reminder setting for an invoice due on `dueIso`. */
export function dunningLevels(
  setting: Pick<
    ReminderSetting,
    "reminderType" | "daysBeforeDue" | "daysAfterDue" | "repeatIntervalDays" | "maxReminders"
  >,
  dueIso: string
): DunningLevelPlan[] {
  let first: number;
  if (setting.reminderType === "invoice_due_soon") first = -(setting.daysBeforeDue ?? 3);
  else if (setting.reminderType === "invoice_overdue") first = setting.daysAfterDue ?? 1;
  else if (setting.reminderType === "payment_followup") first = setting.daysAfterDue ?? 7;
  else return [];
  const interval = setting.repeatIntervalDays ?? null;
  const count = interval ? Math.max(1, setting.maxReminders ?? 3) : 1;
  const levels: DunningLevelPlan[] = [];
  for (let i = 0; i < count; i++) {
    const offset = first + i * (interval ?? 0);
    // "Due soon" reminders stop at the due date.
    if (setting.reminderType === "invoice_due_soon" && offset > 0) break;
    levels.push({ level: i + 1, triggerDate: addDays(dueIso, offset) });
  }
  return levels;
}

/** Pure: which level to send today and which earlier levels to mark skipped. */
export function pickDunningLevel(
  levels: DunningLevelPlan[],
  todayIso: string,
  logged: Set<number>,
  opts: { dueIso: string; reminderType: string }
): { send: number | null; skip: number[] } {
  if (opts.reminderType === "invoice_due_soon" && todayIso > opts.dueIso) {
    return { send: null, skip: [] };
  }
  const due = levels.filter((l) => l.triggerDate <= todayIso).map((l) => l.level);
  if (!due.length) return { send: null, skip: [] };
  const highest = Math.max(...due);
  // Never go back: once a higher level was logged, lower ones are never sent.
  const maxLogged = logged.size ? Math.max(...logged) : 0;
  if (logged.has(highest) || highest <= maxLogged) return { send: null, skip: [] };
  return { send: highest, skip: due.filter((l) => l < highest && !logged.has(l)) };
}

export interface DunningSummary {
  companies: number;
  considered: number;
  sent: number;
  queued: number;
  blocked: number;
  skipped: number;
  failed: number;
}

interface EligibleInvoice {
  id: string;
  company_id: string;
  contact_id: string | null;
  number: string;
  due: string;
  open_fils: string;
}

/** SMS adapter boundary: a real provider only when configured; otherwise requires_external. */
async function sendDunningSms(
  to: string | null,
  text: string
): Promise<{ status: "sent" | "requires_external" | "failed"; error?: string }> {
  if (!to) return { status: "failed", error: "Customer has no phone number" };
  if (!isCapabilityLive("sms")) return { status: "requires_external" };
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: process.env.SMS_SENDER_ID || "",
        Body: text.slice(0, 600),
      }).toString(),
    });
    return res.ok ? { status: "sent" } : { status: "failed", error: `HTTP ${res.status}` };
  } catch (err) {
    return { status: "failed", error: (err as Error)?.message };
  }
}

async function eligibleInvoices(companyId: string): Promise<EligibleInvoice[]> {
  const { rows } = await pool.query(
    `SELECT i.id, i.company_id, i.contact_id, i.number,
            ((coalesce(i.due_date, i.date) + interval '4 hours')::date)::text AS due,
            GREATEST(ROUND(i.total * 100)
              - coalesce((SELECT ROUND(SUM(p.amount) * 100) FROM invoice_payments p WHERE p.invoice_id = i.id), 0)
              - coalesce((SELECT ROUND(SUM(-cn.total) * 100) FROM invoices cn
                           WHERE cn.original_invoice_id = i.id AND cn.invoice_type = 'credit_note'
                             AND cn.status NOT IN ('void', 'cancelled', 'draft')), 0)
              - coalesce((SELECT ROUND(SUM(a.amount) * 100) FROM customer_credit_allocations a
                           WHERE a.invoice_id = i.id AND a.kind = 'apply'), 0), 0)::bigint::text AS open_fils
       FROM invoices i
       LEFT JOIN customer_contacts c ON c.id = i.contact_id
      WHERE i.company_id = $1
        AND i.status IN ('sent', 'posted', 'partial')
        AND i.invoice_type <> 'credit_note'
        AND i.do_not_chase = false
        AND coalesce(c.do_not_chase, false) = false`,
    [companyId]
  );
  return (rows as EligibleInvoice[]).filter((r) => Number(r.open_fils) > 0);
}

async function claimLog(args: {
  companyId: string;
  settingId: string;
  reminderType: string;
  invoiceId: string;
  contactId: string | null;
  channel: DunningChannel;
  level: number;
  status: string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
}): Promise<string | null> {
  const { rows } = await pool.query(
    `INSERT INTO reminder_logs (company_id, reminder_setting_id, reminder_type, related_entity_type,
            related_entity_id, recipient_email, recipient_phone, channel, status, attempt_number, level,
            contact_id)
     VALUES ($1, $2, $3, 'invoice', $4, $5, $6, $7, $8, $9, $9, $10)
     ON CONFLICT DO NOTHING RETURNING id`,
    [
      args.companyId,
      args.settingId,
      args.reminderType,
      args.invoiceId,
      args.recipientEmail ?? null,
      args.recipientPhone ?? null,
      args.channel,
      args.status,
      args.level,
      args.contactId,
    ]
  );
  return rows[0]?.id ?? null;
}

async function settleLog(
  id: string,
  patch: { status: string; error?: string | null; outboxId?: string | null; sent?: boolean }
) {
  await pool.query(
    `UPDATE reminder_logs SET status = $2, error_message = $3, outbox_id = coalesce($4, outbox_id),
            sent_at = CASE WHEN $5 THEN now() ELSE sent_at END
      WHERE id = $1`,
    [id, patch.status, patch.error ?? null, patch.outboxId ?? null, patch.sent === true]
  );
}

/** A view/pay link for the customer: the invoice share link (it shows Pay now when live). */
async function customerInvoiceLink(invoice: {
  id: string;
  shareToken: string | null;
  shareTokenExpiresAt: Date | null;
}) {
  let token = invoice.shareToken;
  if (
    !token ||
    (invoice.shareTokenExpiresAt && new Date(invoice.shareTokenExpiresAt) < new Date())
  ) {
    const crypto = await import("crypto");
    token = crypto.randomBytes(16).toString("hex");
    await storage.setInvoiceShareToken(invoice.id, token, new Date(Date.now() + 90 * DAY_MS));
  }
  const { publicBaseUrl } = await import("./payments");
  return `${publicBaseUrl()}/view/invoice/${token}`;
}

async function dunCompany(companyId: string, now: Date, summary: DunningSummary): Promise<void> {
  const settings = (await storage.getReminderSettingsByCompanyId(companyId)).filter(
    (s) =>
      s.isEnabled &&
      ["invoice_due_soon", "invoice_overdue", "payment_followup"].includes(s.reminderType)
  );
  if (!settings.length) return;
  const invoices = await eligibleInvoices(companyId);
  if (!invoices.length) return;
  summary.companies++;
  const today = uaeDate(now);
  const { rows: logRows } = await pool.query(
    `SELECT reminder_setting_id, related_entity_id, channel, level FROM reminder_logs
      WHERE company_id = $1 AND reminder_setting_id IS NOT NULL AND level IS NOT NULL`,
    [companyId]
  );
  const logged = new Map<string, Set<number>>();
  for (const r of logRows) {
    const k = `${r.reminder_setting_id}:${r.related_entity_id}:${r.channel}`;
    if (!logged.has(k)) logged.set(k, new Set());
    logged.get(k)!.add(Number(r.level));
  }
  const company = await storage.getCompany(companyId);
  if (!company) return;

  for (const inv of invoices) {
    for (const setting of settings) {
      const channels: DunningChannel[] = [
        ...(setting.sendEmail ? (["email"] as const) : []),
        ...(setting.sendSms ? (["sms"] as const) : []),
        ...(setting.sendInApp ? (["in_app"] as const) : []),
      ];
      const levels = dunningLevels(setting, inv.due);
      for (const channel of channels) {
        const key = `${setting.id}:${inv.id}:${channel}`;
        const done = logged.get(key) ?? new Set<number>();
        const pick = pickDunningLevel(levels, today, done, {
          dueIso: inv.due,
          reminderType: setting.reminderType,
        });
        if (!pick.send) continue;
        summary.considered++;
        for (const lvl of pick.skip) {
          const id = await claimLog({
            companyId,
            settingId: setting.id,
            reminderType: setting.reminderType,
            invoiceId: inv.id,
            contactId: inv.contact_id,
            channel,
            level: lvl,
            status: "skipped",
          });
          if (id) {
            await settleLog(id, {
              status: "skipped",
              error: "Superseded by a later level (catch-up)",
            });
            summary.skipped++;
          }
        }
        await dunOne({ company, setting, inv, channel, level: pick.send, today, summary });
      }
    }
  }
}

async function dunOne(args: {
  company: Company;
  setting: ReminderSetting;
  inv: EligibleInvoice;
  channel: DunningChannel;
  level: number;
  today: string;
  summary: DunningSummary;
}): Promise<void> {
  const { company, setting, inv, channel, level, summary } = args;
  const contact = inv.contact_id ? await storage.getCustomerContact(inv.contact_id) : undefined;
  const logId = await claimLog({
    companyId: company.id,
    settingId: setting.id,
    reminderType: setting.reminderType,
    invoiceId: inv.id,
    contactId: inv.contact_id,
    channel,
    level,
    status: "pending",
    recipientEmail: channel === "email" ? (contact?.email ?? null) : null,
    recipientPhone: channel === "sms" ? (contact?.phone ?? null) : null,
  });
  if (!logId) return; // another run took this level
  const daysOverdue = Math.floor((Date.parse(args.today) - Date.parse(inv.due)) / DAY_MS);
  try {
    if (channel === "in_app") {
      const { notify } = await import("./notification-engine.service");
      await notify({
        companyId: company.id,
        type: "invoice.overdue",
        entityId: inv.id,
        eventKey: `dunning:${setting.id}:${inv.id}:${level}`,
        title: `Reminder ${level} for invoice ${inv.number}`,
        message: contact
          ? `Payment reminder ${level} for invoice ${inv.number} is due for ${contact.name}.`
          : `Invoice ${inv.number} has no customer contact; the customer cannot be reminded.`,
        priority: daysOverdue > 14 ? "urgent" : daysOverdue > 0 ? "high" : "normal",
        relatedEntityType: "invoice",
        actionUrl: `/invoices/${inv.id}`,
      });
      await settleLog(logId, { status: "sent", sent: true });
      summary.sent++;
      return;
    }
    if (!contact) {
      await settleLog(logId, { status: "failed", error: "Invoice has no customer contact" });
      summary.failed++;
      return;
    }
    const invoice = await storage.getInvoice(inv.id, company.id);
    if (!invoice) return;
    const link = await customerInvoiceLink(invoice);
    if (channel === "sms") {
      const r = await sendDunningSms(
        contact.phone ?? null,
        `${company.name}: invoice ${invoice.number}, ${invoice.currency} ${fromFils(Number(inv.open_fils))} ${daysOverdue > 0 ? "overdue" : "due"}. ${link}`
      );
      await settleLog(logId, {
        status: r.status,
        error: r.error ?? null,
        sent: r.status === "sent",
      });
      if (r.status === "sent") summary.sent++;
      else if (r.status === "requires_external") summary.blocked++;
      else summary.failed++;
      return;
    }
    if (!contact.email) {
      await settleLog(logId, { status: "failed", error: "Customer has no email address" });
      summary.failed++;
      return;
    }
    const lang =
      setting.language === "bilingual" &&
      (contact.preferredLanguage === "en" || contact.preferredLanguage === "ar")
        ? contact.preferredLanguage
        : (setting.language as EmailLanguage);
    const { subject, html, text } = buildReminderEmail({
      invoice,
      company,
      customerName: contact.name,
      openFils: Number(inv.open_fils),
      level,
      daysOverdue,
      payUrl: setting.includePayLink ? link : null,
      portalUrl: link,
      language: lang,
      customSubject: setting.emailSubject,
      customTemplate: setting.emailTemplate,
    });
    const attachments: OutgoingAttachment[] = [];
    if (setting.attachPdf) {
      const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
      const { invoicePdfOptions } = await import("../routes/invoices.routes");
      attachments.push({
        filename: `invoice-${invoice.number}.pdf`,
        content: await generateInvoicePDF(
          invoice,
          lines,
          company,
          await invoicePdfOptions(invoice)
        ),
        contentType: "application/pdf",
      });
    }
    const r = await sendEmail(contact.email, subject, text, {
      html,
      fromName: company.name,
      replyTo: company.contactEmail ?? null,
      companyId: company.id,
      category: "reminder",
      relatedEntityType: "invoice",
      relatedEntityId: invoice.id,
      attachments,
      idempotencyKey: `dunning:${setting.id}:${invoice.id}:${level}`,
    });
    await settleLog(logId, {
      status: r.status,
      error: r.sent ? null : (r.error ?? null),
      outboxId: r.id ?? null,
      sent: r.sent,
    });
    await db
      .update(invoicesTable)
      .set({
        reminderCount: sql`${invoicesTable.reminderCount} + 1`,
        lastReminderSentAt: new Date(),
      })
      .where(eq(invoicesTable.id, invoice.id));
    if (r.sent) summary.sent++;
    else if (r.status === "blocked_no_provider") summary.blocked++;
    else summary.queued++;
  } catch (err) {
    log.error({ err, invoiceId: inv.id, settingId: setting.id }, "Dunning reminder failed");
    await settleLog(logId, { status: "failed", error: (err as Error)?.message ?? "error" });
    summary.failed++;
  }
}

/**
 * Run dunning for every company (or one). Idempotent: safe to run any number of times a day.
 */
export async function runDunningScan(
  now: Date = new Date(),
  opts: { companyId?: string } = {}
): Promise<DunningSummary> {
  const summary: DunningSummary = {
    companies: 0,
    considered: 0,
    sent: 0,
    queued: 0,
    blocked: 0,
    skipped: 0,
    failed: 0,
  };
  const ids = opts.companyId
    ? [opts.companyId]
    : (
        await pool.query(
          `SELECT DISTINCT company_id FROM reminder_settings WHERE is_enabled = true`
        )
      ).rows.map((r: { company_id: string }) => r.company_id);
  for (const companyId of ids) {
    try {
      await dunCompany(companyId, now, summary);
    } catch (err) {
      log.error({ err, companyId }, "Dunning scan failed for company");
    }
  }
  return summary;
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
        const summary = await runDunningScan();
        if (summary.considered) log.info(summary, "Dunning scan complete");
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
  // W4-D: outbox delivery worker + notification scans (idempotent registration).
  registerOutboxJob();
  // F8: durable domain-event dispatcher.
  registerEventOutboxJob();
  registerNotificationEngine();
  // S8: report-artifact objects queued for deletion when their rows go away.
  registerObjectDeletionJob();
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
