/**
 * Request bodies for the journal module (server/routes/journal.routes.ts).
 * Mounted with strictBody(): unknown keys are a 400. Amounts and dates are
 * shape-checked here and validated semantically by the ledger kernel, which
 * answers 422 with a stable code (INVALID_AMOUNT, INVALID_DATE, FUTURE_DATE,
 * ENTRY_UNBALANCED, ZERO_AMOUNT_LINE, ACCOUNT_INACTIVE, ...).
 */
import { z } from "zod";
import { zMoney } from "./primitives";
import {
  JOURNAL_LINE_CONTACT_TYPES,
  JOURNAL_LINE_CT_TREATMENTS,
  JOURNAL_LINE_VAT_TREATMENTS,
} from "../journal-line-treatments";

/** number | decimal string; the kernel rejects >2dp, NaN, Infinity, overflow (422). */
const amount = z
  .union([z.number(), z.string().max(40)])
  .nullable()
  .optional();
const dateInput = z.union([z.string().max(40), z.date()]);
const optionalText = (max: number) => z.string().max(max).nullable().optional();

export const journalLineBody = z
  .object({
    accountId: z.string().max(64),
    debit: amount,
    credit: amount,
    description: optionalText(500),
    costCenterId: z.string().max(64).nullable().optional(),
    foreignCurrency: z.string().max(3).nullable().optional(),
    foreignDebit: amount,
    foreignCredit: amount,
    exchangeRate: amount,
    // WQ3 (9.4 / 9.16): per-line contact, VAT treatment and corporate-tax treatment. With a
    // foreign currency and no base amount, the server converts at the tenant rate (fx.convert).
    contactType: z.enum(JOURNAL_LINE_CONTACT_TYPES).nullable().optional(),
    contactId: z.string().max(64).nullable().optional(),
    vatTreatment: z.enum(JOURNAL_LINE_VAT_TREATMENTS).nullable().optional(),
    ctTreatment: z.enum(JOURNAL_LINE_CT_TREATMENTS).nullable().optional(),
    ctDisallowedPct: z
      .union([z.number(), z.string().max(10)])
      .nullable()
      .optional(),
  })
  .strict();
export type JournalLineBody = z.infer<typeof journalLineBody>;

const entryFields = {
  date: dateInput,
  /** Legacy alias of memo (the client used to send `description`). */
  description: optionalText(2000),
  memo: optionalText(2000),
  reference: optionalText(200),
  notes: optionalText(2000),
  /** Accrual: reverse automatically on this date (after `date`). */
  autoReverseOn: z.string().max(40).nullable().optional(),
  lines: z.array(journalLineBody).min(2, "Journal entry must have at least 2 lines").max(500),
  /**
   * A2 (H8): a manual line on a control account (A/R, A/P, inventory, VAT, GRNI, payroll
   * payables) is refused unless posted as an explicit adjustment with a reason (owner, admin,
   * accountant or CFO). The reason is stamped on the entry and shown on the reconciliation.
   */
  controlAdjustment: z
    .object({ reason: z.string().trim().min(5, "Give a reason for the adjustment").max(1000) })
    .strict()
    .nullable()
    .optional(),
};

/** POST /api/companies/:companyId/journal (mount with allowServerOwned: ["status"]). */
export const createJournalBody = z
  .object({
    ...entryFields,
    status: z.enum(["draft", "posted"]).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type CreateJournalBody = z.infer<typeof createJournalBody>;

/** PUT /api/journal/:id (drafts only; status "posted" = save and post). */
export const updateJournalBody = z
  .object({
    ...entryFields,
    status: z.enum(["draft", "posted"]).optional(),
  })
  .strict();
export type UpdateJournalBody = z.infer<typeof updateJournalBody>;

/** POST /api/journal/:id/reverse */
export const reverseJournalBody = z
  .object({
    reason: optionalText(1000),
    /** Default: original date if its period is open, else today. */
    date: z.string().max(40).nullable().optional(),
  })
  .strict();
export type ReverseJournalBody = z.infer<typeof reverseJournalBody>;

/** POST /api/journal/:id/post and /approve: no body fields. */
export const journalActionBody = z.object({}).strict();

/** POST /api/journal/:id/void */
export const voidJournalBody = z.object({ reason: optionalText(1000) }).strict();
export type VoidJournalBody = z.infer<typeof voidJournalBody>;

/** PUT /api/companies/:companyId/journal/settings */
export const journalSettingsBody = z
  .object({
    /** Manual journals above this total need a second user's approval; null = off. */
    manualApprovalThreshold: zMoney.nullable(),
  })
  .strict();
export type JournalSettingsBody = z.infer<typeof journalSettingsBody>;

export const JOURNAL_TEMPLATE_FREQUENCIES = [
  "none",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;

const templateLine = z
  .object({
    accountId: z.string().max(64),
    debit: amount,
    credit: amount,
    description: optionalText(500),
    costCenterId: z.string().max(64).nullable().optional(),
  })
  .strict();

const templateFields = {
  name: z.string().trim().min(1).max(200),
  memo: optionalText(2000),
  lines: z.array(templateLine).min(2).max(200),
  frequency: z.enum(JOURNAL_TEMPLATE_FREQUENCIES),
  nextRunOn: z.string().max(40).nullable().optional(),
  endOn: z.string().max(40).nullable().optional(),
  postAs: z.enum(["draft", "posted"]).optional(),
  /** Auto-reversing journals: reverse each generated entry N days later. */
  autoReverseDays: z.number().int().min(1).max(366).nullable().optional(),
  isActive: z.boolean().optional(),
};

/** POST /api/companies/:companyId/journal-templates */
export const createJournalTemplateBody = z.object(templateFields).strict();
export type CreateJournalTemplateBody = z.infer<typeof createJournalTemplateBody>;

/** PATCH /api/journal-templates/:id */
export const updateJournalTemplateBody = z.object(templateFields).partial().strict();
export type UpdateJournalTemplateBody = z.infer<typeof updateJournalTemplateBody>;

/** POST /api/journal-templates/:id/run */
export const runJournalTemplateBody = z.object({ date: z.string().max(40).optional() }).strict();

/** POST /api/journal/:id/attachments — base64 file content (max ~7.5 MB decoded). */
export const journalAttachmentBody = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    data: z.string().min(1).max(10_000_000),
  })
  .strict();
export type JournalAttachmentBody = z.infer<typeof journalAttachmentBody>;
