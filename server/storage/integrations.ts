// DatabaseStorage part: Waitlist, integration syncs, WhatsApp, API keys, webhooks, push, Stripe events, document versions, invoice templates.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  apiKeys,
  companyUsers,
  documentVersions,
  integrationSyncs,
  invoiceTemplates,
  notificationPreferences,
  pushSubscriptions,
  stripeEvents,
  waitlist,
  webhookDeliveries,
  webhookEndpoints,
  whatsappConfigs,
  whatsappMessages,
  type ApiKey,
  type DocumentVersion,
  type InsertApiKey,
  type InsertDocumentVersion,
  type InsertIntegrationSync,
  type InsertInvoiceTemplate,
  type InsertNotificationPreferences,
  type InsertPushSubscription,
  type InsertWaitlist,
  type InsertWebhookDelivery,
  type InsertWebhookEndpoint,
  type InsertWhatsappConfig,
  type InsertWhatsappMessage,
  type IntegrationSync,
  type InvoiceTemplate,
  type NotificationPreferences,
  type PushSubscription,
  type StripeEvent,
  type Waitlist,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WhatsappConfig,
  type WhatsappMessage,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq, sql } from "drizzle-orm";
import { ContactStorage } from "./contacts";

export class IntegrationStorage extends ContactStorage {
  // Waitlist
  async createWaitlistEntry(insertEntry: InsertWaitlist): Promise<Waitlist> {
    const [entry] = await db.insert(waitlist).values(insertEntry).returning();
    return entry;
  }

  async getWaitlistByEmail(email: string): Promise<Waitlist | undefined> {
    const [entry] = await db.select().from(waitlist).where(eq(waitlist.email, email));
    return entry || undefined;
  }

  // Integration Syncs
  async createIntegrationSync(insertSync: InsertIntegrationSync): Promise<IntegrationSync> {
    const [sync] = await db.insert(integrationSyncs).values(insertSync).returning();
    return sync;
  }

  async getIntegrationSyncsByCompanyId(companyId: string): Promise<IntegrationSync[]> {
    return await db
      .select()
      .from(integrationSyncs)
      .where(eq(integrationSyncs.companyId, companyId))
      .orderBy(desc(integrationSyncs.syncedAt));
  }

  async getIntegrationSyncsByType(
    companyId: string,
    integrationType: string
  ): Promise<IntegrationSync[]> {
    return await db
      .select()
      .from(integrationSyncs)
      .where(
        and(
          eq(integrationSyncs.companyId, companyId),
          eq(integrationSyncs.integrationType, integrationType)
        )
      )
      .orderBy(desc(integrationSyncs.syncedAt));
  }

  // WhatsApp Configuration
  async getWhatsappConfig(companyId: string): Promise<WhatsappConfig | undefined> {
    const [config] = await db
      .select()
      .from(whatsappConfigs)
      .where(eq(whatsappConfigs.companyId, companyId));
    return config || undefined;
  }

  async getWhatsappConfigByPhoneNumberId(
    phoneNumberId: string
  ): Promise<WhatsappConfig | undefined> {
    const [config] = await db
      .select()
      .from(whatsappConfigs)
      .where(eq(whatsappConfigs.phoneNumberId, phoneNumberId));
    return config || undefined;
  }

  async createWhatsappConfig(insertConfig: InsertWhatsappConfig): Promise<WhatsappConfig> {
    const [config] = await db.insert(whatsappConfigs).values(insertConfig).returning();
    return config;
  }

  async updateWhatsappConfig(
    id: string,
    data: Partial<InsertWhatsappConfig>
  ): Promise<WhatsappConfig> {
    const [config] = await db
      .update(whatsappConfigs)
      .set(data)
      .where(eq(whatsappConfigs.id, id))
      .returning();
    if (!config) {
      throw new Error("WhatsApp configuration not found");
    }
    return config;
  }

  // WhatsApp Messages
  async createWhatsappMessage(insertMessage: InsertWhatsappMessage): Promise<WhatsappMessage> {
    const [message] = await db.insert(whatsappMessages).values(insertMessage).returning();
    return message;
  }

  async getWhatsappMessagesByCompanyId(companyId: string): Promise<WhatsappMessage[]> {
    return await db
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.companyId, companyId))
      .orderBy(desc(whatsappMessages.createdAt));
  }

  async getWhatsappMessage(id: string): Promise<WhatsappMessage | undefined> {
    const [message] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.id, id));
    return message || undefined;
  }

  async updateWhatsappMessage(
    id: string,
    data: Partial<InsertWhatsappMessage>
  ): Promise<WhatsappMessage> {
    const [message] = await db
      .update(whatsappMessages)
      .set(data)
      .where(eq(whatsappMessages.id, id))
      .returning();
    if (!message) {
      throw new Error("WhatsApp message not found");
    }
    return message;
  }

  // API keys
  async getApiKeysByCompanyId(companyId: string): Promise<ApiKey[]> {
    return await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.companyId, companyId))
      .orderBy(desc(apiKeys.createdAt));
  }

  async createApiKey(data: InsertApiKey): Promise<ApiKey> {
    const [key] = await db.insert(apiKeys).values(data).returning();
    return key;
  }

  async updateApiKey(id: string, data: Partial<InsertApiKey>): Promise<ApiKey | undefined> {
    const [key] = await db.update(apiKeys).set(data).where(eq(apiKeys.id, id)).returning();
    return key;
  }

  async deleteApiKey(id: string): Promise<void> {
    await db.delete(apiKeys).where(eq(apiKeys.id, id));
  }

  // Webhook endpoints + deliveries
  async getWebhookEndpointsByCompanyId(companyId: string): Promise<WebhookEndpoint[]> {
    return await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.companyId, companyId))
      .orderBy(desc(webhookEndpoints.createdAt));
  }

  async getWebhookEndpoint(id: string): Promise<WebhookEndpoint | undefined> {
    const [endpoint] = await db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, id))
      .limit(1);
    return endpoint;
  }

  async getActiveWebhookEndpointsForEvent(
    companyId: string,
    event: string
  ): Promise<WebhookEndpoint[]> {
    const all = await db
      .select()
      .from(webhookEndpoints)
      .where(and(eq(webhookEndpoints.companyId, companyId), eq(webhookEndpoints.isActive, true)));
    return all.filter((endpoint: WebhookEndpoint) => {
      const events = endpoint.events.split(",").map((e: string) => e.trim());
      return events.includes("*") || events.includes(event);
    });
  }

  async createWebhookEndpoint(data: InsertWebhookEndpoint): Promise<WebhookEndpoint> {
    const [endpoint] = await db.insert(webhookEndpoints).values(data).returning();
    return endpoint;
  }

  async updateWebhookEndpoint(
    id: string,
    data: Partial<InsertWebhookEndpoint>
  ): Promise<WebhookEndpoint | undefined> {
    const [endpoint] = await db
      .update(webhookEndpoints)
      .set(data)
      .where(eq(webhookEndpoints.id, id))
      .returning();
    return endpoint;
  }

  async incrementWebhookFailureCount(id: string): Promise<void> {
    await db
      .update(webhookEndpoints)
      .set({ failureCount: sql`${webhookEndpoints.failureCount} + 1` })
      .where(eq(webhookEndpoints.id, id));
  }

  async deleteWebhookEndpoint(id: string): Promise<void> {
    await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
  }

  async createWebhookDelivery(data: InsertWebhookDelivery): Promise<WebhookDelivery> {
    const [delivery] = await db.insert(webhookDeliveries).values(data).returning();
    return delivery;
  }

  async getWebhookDeliveriesByEndpointId(
    endpointId: string,
    limit = 50
  ): Promise<WebhookDelivery[]> {
    return await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookEndpointId, endpointId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit);
  }

  // Push subscriptions + notification preferences
  // W4-D (R16-11): one row per (user, endpoint); re-subscribing refreshes the keys.
  async createPushSubscription(data: InsertPushSubscription): Promise<PushSubscription> {
    const [sub] = await db
      .insert(pushSubscriptions)
      .values(data)
      .onConflictDoUpdate({
        target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
        set: { p256dhKey: data.p256dhKey, authKey: data.authKey, isActive: true },
      })
      .returning();
    return sub;
  }

  async getPushSubscriptionsByUserId(userId: string): Promise<PushSubscription[]> {
    return await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.isActive, true)));
  }

  /** W4-D (R16-11): always scoped to the owning user. */
  async deactivatePushSubscription(id: string, userId: string): Promise<void> {
    await db
      .update(pushSubscriptions)
      .set({ isActive: false })
      .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, userId)));
  }

  /** W4-D (R16-11): unsubscribe by endpoint, only the caller's own subscription. */
  async deactivatePushSubscriptionByEndpoint(userId: string, endpoint: string): Promise<number> {
    const rows = await db
      .update(pushSubscriptions)
      .set({ isActive: false })
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
      .returning({ id: pushSubscriptions.id });
    return rows.length;
  }

  async getNotificationPreferences(userId: string): Promise<NotificationPreferences | undefined> {
    const [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    return prefs;
  }

  async upsertNotificationPreferences(
    userId: string,
    data: Partial<InsertNotificationPreferences>
  ): Promise<NotificationPreferences> {
    const { userId: _ignored, ...patch } = data as Record<string, unknown>;
    const [prefs] = await db
      .insert(notificationPreferences)
      .values({ userId, ...patch })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { ...patch, updatedAt: new Date() },
      })
      .returning();
    return prefs;
  }

  async getUserCountByCompanyId(companyId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(companyUsers)
      .where(eq(companyUsers.companyId, companyId));
    return Number(row?.count ?? 0);
  }

  // Stripe webhook event ledger (idempotency)
  async getStripeEvent(id: string): Promise<StripeEvent | undefined> {
    const [event] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, id)).limit(1);
    return event;
  }

  /** Claim a Stripe event id; false when another delivery already holds it. */
  async createStripeEvent(id: string, type: string): Promise<boolean> {
    const rows = await db
      .insert(stripeEvents)
      .values({ id, type })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    return rows.length > 0;
  }

  /** Release a claimed event whose processing failed, so Stripe's retry is processed. */
  async releaseStripeEvent(id: string): Promise<void> {
    await db.delete(stripeEvents).where(eq(stripeEvents.id, id));
  }

  // Document versions
  async getDocumentVersions(
    companyId: string,
    documentType: string,
    documentId: string,
    options: { version?: number; limit?: number } = {}
  ): Promise<DocumentVersion[]> {
    const query = db
      .select()
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.companyId, companyId),
          eq(documentVersions.documentType, documentType),
          eq(documentVersions.documentId, documentId),
          options.version === undefined ? undefined : eq(documentVersions.version, options.version)
        )
      )
      .orderBy(desc(documentVersions.version));
    return options.limit === undefined ? query : query.limit(options.limit);
  }

  async getDocumentVersionCount(
    companyId: string,
    documentType: string,
    documentId: string
  ): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.companyId, companyId),
          eq(documentVersions.documentType, documentType),
          eq(documentVersions.documentId, documentId)
        )
      );
    return Number(row?.count ?? 0);
  }

  async createDocumentVersion(data: InsertDocumentVersion): Promise<DocumentVersion> {
    const [version] = await db.insert(documentVersions).values(data).returning();
    return version;
  }

  // Invoice templates
  async getInvoiceTemplatesByCompanyId(companyId: string): Promise<InvoiceTemplate[]> {
    return await db
      .select()
      .from(invoiceTemplates)
      .where(eq(invoiceTemplates.companyId, companyId))
      .orderBy(desc(invoiceTemplates.isDefault), invoiceTemplates.name);
  }

  async getInvoiceTemplate(id: string): Promise<InvoiceTemplate | undefined> {
    const [template] = await db
      .select()
      .from(invoiceTemplates)
      .where(eq(invoiceTemplates.id, id))
      .limit(1);
    return template;
  }

  async createInvoiceTemplate(data: InsertInvoiceTemplate): Promise<InvoiceTemplate> {
    const [template] = await db.insert(invoiceTemplates).values(data).returning();
    return template;
  }

  async updateInvoiceTemplate(
    id: string,
    data: Partial<InsertInvoiceTemplate>
  ): Promise<InvoiceTemplate | undefined> {
    const [template] = await db
      .update(invoiceTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(invoiceTemplates.id, id))
      .returning();
    return template;
  }

  async deleteInvoiceTemplate(id: string): Promise<void> {
    await db.delete(invoiceTemplates).where(eq(invoiceTemplates.id, id));
  }
}
