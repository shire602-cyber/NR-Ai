// Auto-send of a recurring invoice by email (Phase 8 D1). Called after the generated invoice is posted.
// It never blocks billing: when the mail cannot be sent (no provider configured, no customer email, provider
// error) the invoice stays issued, the template stays active, `last_send_status = 'not_sent'` and the reason are
// recorded on the template, the company's users get an in-app notification, and nothing is retried or resent.

import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { customerContacts, recurringInvoices, type Invoice, type RecurringInvoice } from "../../shared/schema";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { emailStatus, EMAIL_NOT_CONFIGURED_MESSAGE, sendInvoiceEmail } from "./email.service";
import { generateInvoicePDF } from "./pdf-invoice.service";

const log = createLogger("recurring-send");
const SHARE_DAYS = 90;

export type RecurringSendOutcome = { status: "sent" } | { status: "not_sent"; code: string; error: string };

export async function sendGeneratedRecurringInvoice(template: RecurringInvoice, invoice: Invoice): Promise<RecurringSendOutcome> {
  const outcome = await trySend(template, invoice);
  await db
    .update(recurringInvoices)
    .set({
      lastSendStatus: outcome.status,
      lastSendError: outcome.status === "sent" ? null : outcome.error,
    } as any)
    .where(eq(recurringInvoices.id, template.id));
  if (outcome.status === "not_sent") {
    log.warn({ templateId: template.id, invoiceId: invoice.id, code: outcome.code }, "Recurring invoice generated but not emailed");
    await notifyNotSent(template, invoice, outcome.error);
  }
  return outcome;
}

async function trySend(template: RecurringInvoice, invoice: Invoice): Promise<RecurringSendOutcome> {
  let to: string | null = null;
  if (template.contactId) {
    const [contact] = await db
      .select({ email: customerContacts.email })
      .from(customerContacts)
      .where(and(eq(customerContacts.id, template.contactId), eq(customerContacts.companyId, template.companyId)));
    to = contact?.email?.trim() || null;
  }
  if (!to) {
    return { status: "not_sent", code: "CONTACT_EMAIL_REQUIRED", error: "The customer has no email address, so the invoice was not emailed." };
  }
  if (!emailStatus().configured) {
    return { status: "not_sent", code: "EMAIL_NOT_CONFIGURED", error: EMAIL_NOT_CONFIGURED_MESSAGE };
  }
  const company = await storage.getCompany(template.companyId);
  if (!company) return { status: "not_sent", code: "COMPANY_NOT_FOUND", error: "Company not found." };

  // A share link so the customer can open the invoice (and pay it online) from the email.
  const token = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SHARE_DAYS);
  await storage.setInvoiceShareToken(invoice.id, token, expiresAt);

  const fresh = (await storage.getInvoice(invoice.id, template.companyId)) ?? invoice;
  const lines = await storage.getInvoiceLinesByInvoiceId(invoice.id);
  const pdf = await generateInvoicePDF(fresh, lines, company);
  const result = await sendInvoiceEmail(to, fresh, company, pdf);
  if (!result.sent) {
    return {
      status: "not_sent",
      code: result.code ?? "EMAIL_SEND_FAILED",
      error: result.error || "The email could not be sent.",
    };
  }
  return { status: "sent" };
}

async function notifyNotSent(template: RecurringInvoice, invoice: Invoice, error: string): Promise<void> {
  try {
    const users = await storage.getCompanyUsersByCompanyId(template.companyId);
    for (const cu of users) {
      await storage.createNotification({
        userId: cu.userId,
        companyId: template.companyId,
        type: "recurring_invoice_not_sent",
        title: `Recurring invoice ${invoice.number} was created but not sent`,
        message: `${template.customerName}: ${error}`,
        priority: "high",
        relatedEntityType: "invoice",
        relatedEntityId: invoice.id,
        actionUrl: "/invoices",
      } as any);
    }
  } catch (err) {
    log.error({ err }, "Could not record the not-sent notification");
  }
}
