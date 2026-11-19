/**
 * Write contracts for the customer portal, statements, notifications, document vault and online
 * payment (W4-D). companyId always comes from the URL or the portal credential, never the body.
 */
import { z } from "zod";
import { zDate, zEmail, zText, zUuid } from "./primitives";

// ─── Portal links / users ───────────────────────────────────────────────────

/** Default lifetime of a portal link; the client dialog copy and the server both read this. */
export const PORTAL_LINK_TTL_DAYS = 90;

export const generatePortalAccessBody = z.object({
  contactId: zUuid,
  /** 1..365 days; default 90. */
  ttlDays: z.number().int().min(1).max(365).optional(),
});
export type GeneratePortalAccessBody = z.output<typeof generatePortalAccessBody>;

export const revokePortalAccessBody = z.object({ contactId: zUuid });

export const portalLoginRequestBody = z.object({
  companyId: zUuid,
  email: zEmail,
});

export const portalLoginVerifyBody = z.object({
  companyId: zUuid,
  email: zEmail,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const portalQuoteResponseBody = z.object({
  decision: z.enum(["accepted", "declined"]),
  signerName: zText(120, { min: 1 }),
  comment: zText(2000).optional().nullable(),
});
export type PortalQuoteResponseBody = z.output<typeof portalQuoteResponseBody>;

export const portalMessageBody = z.object({
  subject: zText(255).optional().nullable(),
  content: zText(10_000, { min: 1 }),
  threadId: zUuid.optional().nullable(),
});
export type PortalMessageBody = z.output<typeof portalMessageBody>;

/** Staff → customer message in the contact's customer-visible thread. */
export const staffCustomerMessageBody = portalMessageBody;

// ─── Statements ─────────────────────────────────────────────────────────────

export const statementQuery = z.object({
  from: zDate.optional(),
  asOf: zDate.optional(),
  format: z.enum(["json", "pdf"]).optional(),
  lang: z.enum(["en", "ar"]).optional(),
});

export const emailStatementBody = z.object({
  to: zEmail.optional(),
  from: zDate.optional(),
  asOf: zDate.optional(),
  message: zText(2000).optional().nullable(),
  language: z.enum(["en", "ar", "bilingual"]).optional(),
});
export type EmailStatementBody = z.output<typeof emailStatementBody>;

// ─── Notifications ──────────────────────────────────────────────────────────

const channelPrefs = z
  .object({
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
    push: z.boolean().optional(),
  })
  .strict();

export const notificationPreferencesBody = z.object({
  pushEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  invoiceReminders: z.boolean().optional(),
  paymentReceived: z.boolean().optional(),
  vatDeadlines: z.boolean().optional(),
  weeklyDigest: z.boolean().optional(),
  digestFrequency: z.enum(["none", "daily"]).optional(),
  typePreferences: z
    .record(z.string().regex(/^[a-z_]+(\.[a-z_]+)?$/), channelPrefs)
    .refine((v) => Object.keys(v).length <= 50, "Too many entries")
    .optional(),
});
export type NotificationPreferencesBody = z.output<typeof notificationPreferencesBody>;

// ─── Document vault ─────────────────────────────────────────────────────────

export const DOC_CATEGORIES = [
  "trade_license",
  "contract",
  "tax_certificate",
  "audit_report",
  "bank_statement",
  "insurance",
  "visa",
  "other",
] as const;

/** Metadata for a JSON (base64) upload; multipart uploads send the same fields as form fields. */
export const documentUploadBody = z.object({
  name: zText(255, { min: 1 }).optional(),
  nameAr: zText(255).optional().nullable(),
  category: z.enum(DOC_CATEGORIES).optional(),
  description: zText(2000).optional().nullable(),
  expiryDate: zDate.optional().nullable(),
  reminderDays: z.coerce.number().int().min(0).max(365).optional(),
  fileName: zText(255, { min: 1 }).optional(),
  /** Declared type; it must match the sniffed bytes. */
  mimeType: z.string().trim().toLowerCase().max(200).optional(),
  /** base64 or data: URL. */
  fileData: z.string().min(1),
  note: zText(500).optional().nullable(),
});
export type DocumentUploadBody = z.output<typeof documentUploadBody>;

export const documentVersionCreateBody = z.object({
  documentType: z.enum(["invoice", "quote", "credit_note", "purchase_order", "receipt"]),
  documentId: zUuid,
  changeDescription: zText(1000).optional().nullable(),
});
export type DocumentVersionCreateBody = z.output<typeof documentVersionCreateBody>;

// ─── Online payment ─────────────────────────────────────────────────────────

export const PAYMENT_PROVIDERS = ["stripe", "telr", "ngenius"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export const createPaymentLinkBody = z.object({
  provider: z.enum(PAYMENT_PROVIDERS).optional(),
  /** 1..90 days; default 30. */
  expiresInDays: z.number().int().min(1).max(90).optional(),
  depositAccountId: zUuid.optional().nullable(),
});
export type CreatePaymentLinkBody = z.output<typeof createPaymentLinkBody>;
