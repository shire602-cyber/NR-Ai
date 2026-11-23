// DatabaseStorage part: Email intake, client notes, engagements, service invoices, FTA emails, subscriptions, backups and payment chasing.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  backups,
  chaseConfigs,
  chaseTemplates,
  clientEmailSources,
  clientNotes,
  emailIntakeDocuments,
  emailIntakeMessages,
  engagements,
  ftaEmails,
  invoices,
  paymentChases,
  serviceInvoiceLines,
  serviceInvoices,
  subscriptions,
  type Backup,
  type ChaseConfig,
  type ChaseTemplate,
  type ClientEmailSource,
  type ClientNote,
  type EmailIntakeDocument,
  type EmailIntakeMessage,
  type Engagement,
  type FtaEmail,
  type InsertBackup,
  type InsertChaseConfig,
  type InsertChaseTemplate,
  type InsertClientEmailSource,
  type InsertClientNote,
  type InsertEmailIntakeDocument,
  type InsertEmailIntakeMessage,
  type InsertEngagement,
  type InsertFtaEmail,
  type InsertPaymentChase,
  type InsertServiceInvoice,
  type InsertServiceInvoiceLine,
  type InsertSubscription,
  type PaymentChase,
  type ServiceInvoice,
  type ServiceInvoiceLine,
  type Subscription,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { ComplianceStorage } from "./compliance";

export class FirmStorage extends ComplianceStorage {
  // ─── Email document intake (firm-internal pilot) ──────────────
  async createClientEmailSource(data: InsertClientEmailSource): Promise<ClientEmailSource> {
    const [row] = await db.insert(clientEmailSources).values(data).returning();
    return row;
  }

  async listClientEmailSourcesByFirm(firmId: string): Promise<ClientEmailSource[]> {
    return await db
      .select()
      .from(clientEmailSources)
      .where(eq(clientEmailSources.firmId, firmId))
      .orderBy(desc(clientEmailSources.createdAt));
  }

  /** All active sources — the routing allowlist for the inbound webhook. */
  async listAllActiveEmailSources(): Promise<ClientEmailSource[]> {
    return await db
      .select()
      .from(clientEmailSources)
      .where(eq(clientEmailSources.status, "active"));
  }

  /** Active sources across a set of companies — the routing allowlist for the poller. */
  async listActiveEmailSourcesForCompanies(companyIds: string[]): Promise<ClientEmailSource[]> {
    if (companyIds.length === 0) return [];
    return await db
      .select()
      .from(clientEmailSources)
      .where(
        and(
          inArray(clientEmailSources.companyId, companyIds),
          eq(clientEmailSources.status, "active")
        )
      );
  }

  async updateClientEmailSource(
    id: string,
    firmId: string,
    patch: Partial<Pick<ClientEmailSource, "status" | "label" | "requireDkimPass">>
  ): Promise<ClientEmailSource | undefined> {
    const [row] = await db
      .update(clientEmailSources)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(clientEmailSources.id, id), eq(clientEmailSources.firmId, firmId)))
      .returning();
    return row;
  }

  async deleteClientEmailSource(id: string, firmId: string): Promise<boolean> {
    const rows = await db
      .delete(clientEmailSources)
      .where(and(eq(clientEmailSources.id, id), eq(clientEmailSources.firmId, firmId)))
      .returning();
    return rows.length > 0;
  }

  async createEmailIntakeMessage(data: InsertEmailIntakeMessage): Promise<EmailIntakeMessage> {
    const [row] = await db.insert(emailIntakeMessages).values(data).returning();
    return row;
  }

  /** Dedup keys already stored for a company (for the in-batch duplicate check). */
  async getEmailIntakeHashesForCompany(companyId: string): Promise<string[]> {
    const rows = await db
      .select({ sha256: emailIntakeDocuments.sha256 })
      .from(emailIntakeDocuments)
      .where(eq(emailIntakeDocuments.companyId, companyId));
    return rows.map((r: { sha256: string }) => r.sha256);
  }

  async createEmailIntakeDocument(data: InsertEmailIntakeDocument): Promise<EmailIntakeDocument> {
    const [row] = await db.insert(emailIntakeDocuments).values(data).returning();
    return row;
  }

  async listEmailIntakeMessagesByCompany(companyId: string): Promise<EmailIntakeMessage[]> {
    return await db
      .select()
      .from(emailIntakeMessages)
      .where(eq(emailIntakeMessages.companyId, companyId))
      .orderBy(desc(emailIntakeMessages.receivedAt));
  }

  async updateEmailIntakeDocument(
    id: string,
    patch: Partial<Pick<EmailIntakeDocument, "receiptId" | "ocrStatus">>
  ): Promise<void> {
    await db.update(emailIntakeDocuments).set(patch).where(eq(emailIntakeDocuments.id, id));
  }

  async updateEmailIntakeMessageStatus(
    id: string,
    status: string,
    error?: string | null
  ): Promise<void> {
    await db
      .update(emailIntakeMessages)
      .set({ status, error: error ?? null })
      .where(eq(emailIntakeMessages.id, id));
  }

  // Client Notes (Admin)
  async getClientNotes(companyId: string): Promise<ClientNote[]> {
    return await db
      .select()
      .from(clientNotes)
      .where(eq(clientNotes.companyId, companyId))
      .orderBy(desc(clientNotes.createdAt));
  }

  async createClientNote(insertNote: InsertClientNote): Promise<ClientNote> {
    const [note] = await db.insert(clientNotes).values(insertNote).returning();
    return note;
  }

  async updateClientNote(id: string, data: Partial<InsertClientNote>): Promise<ClientNote> {
    const [note] = await db
      .update(clientNotes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(clientNotes.id, id))
      .returning();
    return note;
  }

  async deleteClientNote(id: string): Promise<void> {
    await db.delete(clientNotes).where(eq(clientNotes.id, id));
  }

  // Client Engagements
  async getEngagements(): Promise<Engagement[]> {
    return await db.select().from(engagements).orderBy(desc(engagements.createdAt));
  }

  async getEngagementsByCompany(companyId: string): Promise<Engagement[]> {
    return await db
      .select()
      .from(engagements)
      .where(eq(engagements.companyId, companyId))
      .orderBy(desc(engagements.createdAt));
  }

  async getEngagement(id: string): Promise<Engagement | undefined> {
    const [engagement] = await db.select().from(engagements).where(eq(engagements.id, id));
    return engagement || undefined;
  }

  async createEngagement(insertEngagement: InsertEngagement): Promise<Engagement> {
    const [engagement] = await db.insert(engagements).values(insertEngagement).returning();
    return engagement;
  }

  async updateEngagement(id: string, data: Partial<InsertEngagement>): Promise<Engagement> {
    const [engagement] = await db
      .update(engagements)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(engagements.id, id))
      .returning();
    return engagement;
  }

  async deleteEngagement(id: string): Promise<void> {
    await db.delete(engagements).where(eq(engagements.id, id));
  }

  // Service Invoices (NR billing to clients)
  async getServiceInvoices(companyId?: string): Promise<ServiceInvoice[]> {
    if (companyId) {
      return await db
        .select()
        .from(serviceInvoices)
        .where(eq(serviceInvoices.companyId, companyId))
        .orderBy(desc(serviceInvoices.createdAt));
    }
    return await db.select().from(serviceInvoices).orderBy(desc(serviceInvoices.createdAt));
  }

  async getServiceInvoice(id: string): Promise<ServiceInvoice | undefined> {
    const [invoice] = await db.select().from(serviceInvoices).where(eq(serviceInvoices.id, id));
    return invoice || undefined;
  }

  async createServiceInvoice(insertInvoice: InsertServiceInvoice): Promise<ServiceInvoice> {
    const [invoice] = await db.insert(serviceInvoices).values(insertInvoice).returning();
    return invoice;
  }

  async updateServiceInvoice(
    id: string,
    data: Partial<InsertServiceInvoice>
  ): Promise<ServiceInvoice> {
    const [invoice] = await db
      .update(serviceInvoices)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(serviceInvoices.id, id))
      .returning();
    return invoice;
  }

  async deleteServiceInvoice(id: string): Promise<void> {
    await db.delete(serviceInvoices).where(eq(serviceInvoices.id, id));
  }

  // Service Invoice Lines
  async getServiceInvoiceLines(serviceInvoiceId: string): Promise<ServiceInvoiceLine[]> {
    return await db
      .select()
      .from(serviceInvoiceLines)
      .where(eq(serviceInvoiceLines.serviceInvoiceId, serviceInvoiceId));
  }

  async createServiceInvoiceLine(
    insertLine: InsertServiceInvoiceLine
  ): Promise<ServiceInvoiceLine> {
    const [line] = await db.insert(serviceInvoiceLines).values(insertLine).returning();
    return line;
  }

  async deleteServiceInvoiceLines(serviceInvoiceId: string): Promise<void> {
    await db
      .delete(serviceInvoiceLines)
      .where(eq(serviceInvoiceLines.serviceInvoiceId, serviceInvoiceId));
  }

  // FTA Emails
  async getFtaEmails(companyId: string): Promise<FtaEmail[]> {
    return await db
      .select()
      .from(ftaEmails)
      .where(eq(ftaEmails.companyId, companyId))
      .orderBy(desc(ftaEmails.receivedAt));
  }

  async createFtaEmail(insertEmail: InsertFtaEmail): Promise<FtaEmail> {
    const [email] = await db.insert(ftaEmails).values(insertEmail).returning();
    return email;
  }

  async updateFtaEmail(id: string, data: Partial<InsertFtaEmail>): Promise<FtaEmail> {
    const [email] = await db.update(ftaEmails).set(data).where(eq(ftaEmails.id, id)).returning();
    return email;
  }

  // Customer Subscriptions
  async getSubscription(companyId: string): Promise<Subscription | undefined> {
    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.companyId, companyId));
    return subscription || undefined;
  }

  async createSubscription(insertSubscription: InsertSubscription): Promise<Subscription> {
    const [subscription] = await db.insert(subscriptions).values(insertSubscription).returning();
    return subscription;
  }

  async updateSubscription(id: string, data: Partial<InsertSubscription>): Promise<Subscription> {
    const [subscription] = await db
      .update(subscriptions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(subscriptions.id, id))
      .returning();
    return subscription;
  }

  async applyStripeCheckout(
    subscription: Subscription,
    data: Partial<InsertSubscription>
  ): Promise<boolean> {
    const [updated] = await db
      .update(subscriptions)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(subscriptions.id, subscription.id),
          isNull(subscriptions.stripeSubscriptionId),
          eq(subscriptions.stripeCheckoutCompleted, subscription.stripeCheckoutCompleted)
        )
      )
      .returning({ id: subscriptions.id });
    return Boolean(updated);
  }

  // Backups
  async getBackupsByCompanyId(companyId: string): Promise<Backup[]> {
    return await db
      .select()
      .from(backups)
      .where(eq(backups.companyId, companyId))
      .orderBy(desc(backups.createdAt));
  }

  async getBackup(id: string): Promise<Backup | undefined> {
    const [backup] = await db.select().from(backups).where(eq(backups.id, id));
    return backup || undefined;
  }

  async createBackup(insertBackup: InsertBackup): Promise<Backup> {
    const [backup] = await db.insert(backups).values(insertBackup).returning();
    return backup;
  }

  async updateBackup(id: string, data: Partial<InsertBackup>): Promise<Backup> {
    const [backup] = await db.update(backups).set(data).where(eq(backups.id, id)).returning();
    return backup;
  }

  async deleteBackup(id: string): Promise<void> {
    await db.delete(backups).where(eq(backups.id, id));
  }

  // ─── Payment Chasing (Phase 4) ─────────────────────────────────────────────

  async createPaymentChase(data: InsertPaymentChase): Promise<PaymentChase> {
    const [row] = await db.insert(paymentChases).values(data).returning();
    return row;
  }

  async getPaymentChasesByCompanyId(
    companyId: string,
    opts: { invoiceId?: string; sinceDays?: number } = {}
  ): Promise<PaymentChase[]> {
    const conds = [eq(paymentChases.companyId, companyId)];
    if (opts.invoiceId) conds.push(eq(paymentChases.invoiceId, opts.invoiceId));
    if (opts.sinceDays && opts.sinceDays > 0) {
      const cutoff = new Date(Date.now() - opts.sinceDays * 86_400_000);
      conds.push(gte(paymentChases.sentAt, cutoff));
    }
    return await db
      .select()
      .from(paymentChases)
      .where(and(...conds))
      .orderBy(desc(paymentChases.sentAt));
  }

  async getPaymentChasesByInvoiceId(invoiceId: string): Promise<PaymentChase[]> {
    return await db
      .select()
      .from(paymentChases)
      .where(eq(paymentChases.invoiceId, invoiceId))
      .orderBy(desc(paymentChases.sentAt));
  }

  async tryClaimChaseSlot(
    invoiceId: string,
    level: number,
    now: Date,
    minSecondsBetween: number
  ): Promise<boolean> {
    const cutoff = new Date(now.getTime() - Math.max(0, minSecondsBetween) * 1000);
    const claimed = await db
      .update(invoices)
      .set({ chaseLevel: level, lastChasedAt: now })
      .where(
        and(
          eq(invoices.id, invoiceId),
          or(isNull(invoices.lastChasedAt), lt(invoices.lastChasedAt, cutoff))
        )
      )
      .returning({ id: invoices.id });
    return claimed.length > 0;
  }

  async setInvoiceDoNotChase(invoiceId: string, value: boolean): Promise<void> {
    await db.update(invoices).set({ doNotChase: value }).where(eq(invoices.id, invoiceId));
  }

  async getChaseTemplatesForCompany(companyId: string): Promise<ChaseTemplate[]> {
    return await db
      .select()
      .from(chaseTemplates)
      .where(or(eq(chaseTemplates.companyId, companyId), isNull(chaseTemplates.companyId)))
      .orderBy(chaseTemplates.level, chaseTemplates.language);
  }

  async getChaseTemplate(
    level: number,
    language: string,
    companyId: string | null
  ): Promise<ChaseTemplate | undefined> {
    // Prefer company override, fall back to system default.
    if (companyId) {
      const [override] = await db
        .select()
        .from(chaseTemplates)
        .where(
          and(
            eq(chaseTemplates.companyId, companyId),
            eq(chaseTemplates.level, level),
            eq(chaseTemplates.language, language)
          )
        )
        .limit(1);
      if (override) return override;
    }
    const [system] = await db
      .select()
      .from(chaseTemplates)
      .where(
        and(
          isNull(chaseTemplates.companyId),
          eq(chaseTemplates.level, level),
          eq(chaseTemplates.language, language)
        )
      )
      .limit(1);
    return system || undefined;
  }

  async createChaseTemplate(data: InsertChaseTemplate): Promise<ChaseTemplate> {
    const [row] = await db.insert(chaseTemplates).values(data).returning();
    return row;
  }

  async updateChaseTemplate(
    id: string,
    companyId: string,
    data: Partial<InsertChaseTemplate>
  ): Promise<ChaseTemplate | undefined> {
    // Scoped by companyId to prevent cross-tenant edits and keep system
    // defaults (company_id IS NULL) immutable from the customer-facing API.
    const [row] = await db
      .update(chaseTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(chaseTemplates.id, id), eq(chaseTemplates.companyId, companyId)))
      .returning();
    return row || undefined;
  }

  async deleteChaseTemplate(id: string, companyId: string): Promise<boolean> {
    const rows = await db
      .delete(chaseTemplates)
      .where(and(eq(chaseTemplates.id, id), eq(chaseTemplates.companyId, companyId)))
      .returning({ id: chaseTemplates.id });
    return rows.length > 0;
  }

  async getChaseConfig(companyId: string): Promise<ChaseConfig | undefined> {
    const [row] = await db
      .select()
      .from(chaseConfigs)
      .where(eq(chaseConfigs.companyId, companyId))
      .limit(1);
    return row || undefined;
  }

  async upsertChaseConfig(
    companyId: string,
    data: Partial<InsertChaseConfig>
  ): Promise<ChaseConfig> {
    const existing = await this.getChaseConfig(companyId);
    if (existing) {
      const [row] = await db
        .update(chaseConfigs)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(chaseConfigs.companyId, companyId))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(chaseConfigs)
      .values({ companyId, ...data } as InsertChaseConfig)
      .returning();
    return row;
  }
}
