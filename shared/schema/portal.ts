// Customer portal identity, access log, quote responses and online payments (W4-D).
// Part of the shared/schema.ts barrel (R20-09); import from "@shared/schema".

import {
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { companies } from "./companies";
import { accounts } from "./ledger";
import { invoices, quotes } from "./sales";
import { customerContacts } from "./contacts";

// ===========================
// W4-D (0103): customer portal identity, access log, quote responses, online payment
// ===========================

/** int8 column read as a JS number (fils amounts stay far below 2^53). */
const w4dBigint = customType<{ data: number; driverData: string | number }>({
  dataType() {
    return "bigint";
  },
  fromDriver(value: string | number): number {
    return Number(value);
  },
  toDriver(value: number) {
    return String(Math.trunc(value));
  },
});

/** Hashed, revocable portal credentials: share links (`link`) and OTP sessions (`session`). */
export const portalAccessTokens = pgTable(
  "portal_access_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => customerContacts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    kind: text("kind").notNull().default("link"), // link | session
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    lastUsedAt: timestamp("last_used_at"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("uq_portal_access_tokens_hash").on(table.tokenHash),
    contactIdx: index("idx_portal_access_tokens_contact").on(table.contactId),
  })
);
export type PortalAccessToken = typeof portalAccessTokens.$inferSelect;

export const portalLoginCodes = pgTable(
  "portal_login_codes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => customerContacts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index("idx_portal_login_codes_email").on(table.email, table.createdAt),
  })
);
export type PortalLoginCode = typeof portalLoginCodes.$inferSelect;

export const portalAccessLog = pgTable(
  "portal_access_log",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
    tokenId: uuid("token_id").references(() => portalAccessTokens.id, { onDelete: "set null" }),
    ip: text("ip"),
    method: text("method"),
    path: text("path"),
    outcome: text("outcome").notNull(), // ok | invalid | expired | revoked | throttled | denied
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("idx_portal_access_log_company").on(table.companyId, table.createdAt),
    ipIdx: index("idx_portal_access_log_ip").on(table.ip, table.createdAt),
  })
);
export type PortalAccessLogRow = typeof portalAccessLog.$inferSelect;

/** Binds an authenticated client_portal user to the one customer contact they act for. */
export const customerPortalAccounts = pgTable(
  "customer_portal_accounts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => customerContacts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
    // STEP5 (0136): the invitation this binding came from, last portal request, who removed it.
    invitationId: uuid("invitation_id"),
    lastSeenAt: timestamp("last_seen_at"),
    revokedBy: uuid("revoked_by"),
  },
  (table) => ({
    activeUserUnique: uniqueIndex("uq_customer_portal_accounts_user")
      .on(table.companyId, table.userId)
      .where(sql`revoked_at IS NULL`),
  })
);
export type CustomerPortalAccount = typeof customerPortalAccounts.$inferSelect;

/**
 * STEP5 (0136): an invitation for a customer to open the authenticated portal. Only the SHA-256
 * of the single-use token is stored; it expires after 7 days. Accepting it creates (or reuses) a
 * portal login and binds it to the contact through customer_portal_accounts.
 */
export const customerPortalInvitations = pgTable(
  "customer_portal_invitations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => customerContacts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    contactEmailAtIssue: text("contact_email_at_issue"),
    name: text("name"),
    language: text("language").notNull().default("en"), // en | ar | bilingual
    message: text("message"),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("pending"), // pending | accepted | revoked | expired
    expiresAt: timestamp("expires_at").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    lastSentAt: timestamp("last_sent_at"),
    sendCount: integer("send_count").notNull().default(0),
    lastOutboxId: uuid("last_outbox_id"),
    acceptedAt: timestamp("accepted_at"),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id, { onDelete: "set null" }),
    termsAcceptedAt: timestamp("terms_accepted_at"),
    revokedAt: timestamp("revoked_at"),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    tokenUnique: uniqueIndex("uq_customer_portal_invitations_token").on(table.tokenHash),
    contactIdx: index("idx_customer_portal_invitations_contact").on(
      table.companyId,
      table.contactId,
      table.status
    ),
    companyCreatedIdx: index("idx_customer_portal_invitations_company_created").on(
      table.companyId,
      table.createdAt
    ),
    pendingUnique: uniqueIndex("uq_customer_portal_invitations_pending")
      .on(table.companyId, table.contactId, sql`lower(${table.email})`)
      .where(sql`status = 'pending'`),
    pendingEmailIdx: index("idx_customer_portal_invitations_pending_email")
      .on(sql`lower(${table.email})`, table.expiresAt)
      .where(sql`status = 'pending'`),
  })
);
export type CustomerPortalInvitation = typeof customerPortalInvitations.$inferSelect;
export type InsertCustomerPortalInvitation = typeof customerPortalInvitations.$inferInsert;

export const portalQuoteResponses = pgTable(
  "portal_quote_responses",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => customerContacts.id, { onDelete: "set null" }),
    decision: text("decision").notNull(), // accepted | declined
    signerName: text("signer_name"),
    comment: text("comment"),
    ip: text("ip"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    quoteUnique: uniqueIndex("uq_portal_quote_responses_quote").on(table.quoteId),
  })
);
export type PortalQuoteResponse = typeof portalQuoteResponses.$inferSelect;

/** Migration 0103 findings: documents whose customer name matched more than one contact. */
export const portalContactBackfillFindings = pgTable(
  "portal_contact_backfill_findings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    documentId: uuid("document_id").notNull(),
    customerName: text("customer_name"),
    candidateCount: integer("candidate_count").notNull(),
    candidateContactIds: text("candidate_contact_ids"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    docUnique: uniqueIndex("uq_portal_contact_backfill_findings_doc").on(
      table.documentType,
      table.documentId
    ),
  })
);

/** A payable link for one invoice through an online gateway (amount = open balance, fils). */
export const paymentLinks = pgTable(
  "payment_links",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // stripe | telr | ngenius
    tokenHash: text("token_hash").notNull(),
    amountFils: w4dBigint("amount_fils").notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("active"), // active | processing | paid | expired | cancelled
    expiresAt: timestamp("expires_at").notNull(),
    providerSessionId: text("provider_session_id"),
    providerUrl: text("provider_url"),
    depositAccountId: uuid("deposit_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    invoicePaymentId: uuid("invoice_payment_id"),
    paidAmountFils: w4dBigint("paid_amount_fils"),
    feeFils: w4dBigint("fee_fils"),
    feeJournalEntryId: uuid("fee_journal_entry_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    paidAt: timestamp("paid_at"),
  },
  (table) => ({
    tokenUnique: uniqueIndex("uq_payment_links_token").on(table.tokenHash),
    invoiceIdx: index("idx_payment_links_invoice").on(table.invoiceId, table.status),
  })
);
export type PaymentLink = typeof paymentLinks.$inferSelect;

/** Webhook idempotency: one row per (provider, provider event id). */
export const paymentGatewayEvents = pgTable(
  "payment_gateway_events",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    paymentLinkId: uuid("payment_link_id").references(() => paymentLinks.id, {
      onDelete: "set null",
    }),
    outcome: text("outcome").notNull().default("received"),
    detail: text("detail"),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: uniqueIndex("payment_gateway_events_pkey").on(table.provider, table.eventId),
  })
);
export type PaymentGatewayEvent = typeof paymentGatewayEvents.$inferSelect;
