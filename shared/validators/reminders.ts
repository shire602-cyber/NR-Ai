/**
 * Reminder-settings write contracts (W2-D: R16-01/R17-01). companyId is immutable and never
 * accepted from the client.
 */
import { z } from "zod";
import { zText } from "./primitives";

export const REMINDER_TYPES = [
  "invoice_overdue",
  "invoice_due_soon",
  "vat_deadline",
  "payment_followup",
] as const;

const reminderLanguage = z.enum(["contact", "en", "ar", "bilingual"]);
export type ReminderLanguage = z.output<typeof reminderLanguage>;

const reminderFields = {
  reminderType: z.enum(REMINDER_TYPES),
  isEnabled: z.boolean(),
  daysBeforeDue: z.number().int().min(0).max(90).nullable(),
  daysAfterDue: z.number().int().min(0).max(365).nullable(),
  repeatIntervalDays: z.number().int().min(1).max(30).nullable(),
  maxReminders: z.number().int().min(1).max(10).nullable(),
  sendEmail: z.boolean(),
  sendSms: z.boolean(),
  sendInApp: z.boolean(),
  sendWhatsapp: z.boolean(),
  emailSubject: zText(200).nullable(),
  emailTemplate: zText(5000).nullable(),
  smsTemplate: zText(5000).nullable(),
  whatsappTemplate: zText(5000).nullable(),
  // W4-D: customer email language and attachments.
  language: reminderLanguage,
  attachPdf: z.boolean(),
  includePayLink: z.boolean(),
};

export const createReminderSettingBody = z.object({
  reminderType: reminderFields.reminderType,
  isEnabled: reminderFields.isEnabled.default(true),
  daysBeforeDue: reminderFields.daysBeforeDue.optional(),
  daysAfterDue: reminderFields.daysAfterDue.optional(),
  repeatIntervalDays: reminderFields.repeatIntervalDays.optional(),
  maxReminders: reminderFields.maxReminders.optional(),
  sendEmail: reminderFields.sendEmail.optional(),
  sendSms: reminderFields.sendSms.optional(),
  sendInApp: reminderFields.sendInApp.optional(),
  sendWhatsapp: reminderFields.sendWhatsapp.optional(),
  emailSubject: reminderFields.emailSubject.optional(),
  emailTemplate: reminderFields.emailTemplate.optional(),
  smsTemplate: reminderFields.smsTemplate.optional(),
  whatsappTemplate: reminderFields.whatsappTemplate.optional(),
  language: reminderFields.language.default("contact"),
  attachPdf: reminderFields.attachPdf.optional(),
  includePayLink: reminderFields.includePayLink.optional(),
});
export type CreateReminderSettingBody = z.output<typeof createReminderSettingBody>;

export const updateReminderSettingBody = z.object(reminderFields).partial();
export type UpdateReminderSettingBody = z.output<typeof updateReminderSettingBody>;
