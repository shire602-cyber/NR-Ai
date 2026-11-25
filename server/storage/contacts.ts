// DatabaseStorage part: Customer contacts and portal access tokens.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  customerContacts,
  invoices,
  type CustomerContact,
  type InsertCustomerContact,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { ReceiptStorage } from "./receipts";

export class ContactStorage extends ReceiptStorage {
  // Customer Contacts
  async getCustomerContact(id: string): Promise<CustomerContact | undefined> {
    const [contact] = await db.select().from(customerContacts).where(eq(customerContacts.id, id));
    return contact;
  }

  async getCustomerContactsByCompanyId(companyId: string): Promise<CustomerContact[]> {
    return await db
      .select()
      .from(customerContacts)
      .where(and(eq(customerContacts.companyId, companyId), eq(customerContacts.isActive, true)))
      .orderBy(desc(customerContacts.createdAt));
  }

  async getCustomerContactByEmail(
    companyId: string,
    email: string
  ): Promise<CustomerContact | undefined> {
    const [contact] = await db
      .select()
      .from(customerContacts)
      .where(and(eq(customerContacts.companyId, companyId), eq(customerContacts.email, email)));
    return contact;
  }

  async getCustomerContactByTrn(
    companyId: string,
    trn: string
  ): Promise<CustomerContact | undefined> {
    const [contact] = await db
      .select()
      .from(customerContacts)
      .where(and(eq(customerContacts.companyId, companyId), eq(customerContacts.trnNumber, trn)));
    return contact;
  }

  async createCustomerContact(insertContact: InsertCustomerContact): Promise<CustomerContact> {
    const [contact] = await db.insert(customerContacts).values(insertContact).returning();
    return contact;
  }

  async createBulkCustomerContacts(
    contactsData: InsertCustomerContact[]
  ): Promise<CustomerContact[]> {
    if (contactsData.length === 0) return [];
    const created = await db.insert(customerContacts).values(contactsData).returning();
    return created;
  }

  async updateCustomerContact(
    id: string,
    data: Partial<InsertCustomerContact>,
    companyId?: string
  ): Promise<CustomerContact> {
    // S-L3: when the caller knows the tenant, scope the WHERE to it so the row
    // can only be mutated within its own company (defence-in-depth even though
    // routes pre-check access).
    const where = companyId
      ? and(eq(customerContacts.id, id), eq(customerContacts.companyId, companyId))
      : eq(customerContacts.id, id);
    const [contact] = await db
      .update(customerContacts)
      .set({ ...data, updatedAt: new Date() })
      .where(where)
      .returning();
    if (!contact) throw new Error("Customer contact not found");
    return contact;
  }

  async deleteCustomerContact(id: string, companyId?: string): Promise<void> {
    // S-L3: tenant-scope the delete when the company is known.
    const where = companyId
      ? and(eq(customerContacts.id, id), eq(customerContacts.companyId, companyId))
      : eq(customerContacts.id, id);
    await db.delete(customerContacts).where(where);
  }

  async deleteAllCustomerContactsByCompanyId(companyId: string): Promise<number> {
    const deleted = await db
      .delete(customerContacts)
      .where(eq(customerContacts.companyId, companyId))
      .returning({ id: customerContacts.id });
    return deleted.length;
  }

  async countCustomerContactsByCompanyId(companyId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(customerContacts)
      .where(eq(customerContacts.companyId, companyId));
    return row?.count ?? 0;
  }

  async countInvoicesWithContactByCompanyId(companyId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), isNotNull(invoices.contactId)));
    return row?.count ?? 0;
  }

  // W4-D (R16-07): portal tokens are stored hashed in portal_access_tokens
  // (server/services/portal-access.service.ts); the plaintext column stays NULL.
  async getCustomerContactByPortalToken(token: string): Promise<CustomerContact | undefined> {
    const { resolvePortalToken } = await import("../services/portal-access.service");
    const resolved = await resolvePortalToken(token);
    return resolved.status === "ok" ? resolved.contact : undefined;
  }

  async setPortalAccessToken(
    contactId: string,
    token: string,
    expiresAt: Date
  ): Promise<CustomerContact> {
    const [contact] = await db
      .select()
      .from(customerContacts)
      .where(eq(customerContacts.id, contactId));
    if (!contact) throw new Error("Customer contact not found");
    const { hashPortalToken } = await import("../services/portal-access.service");
    await db.execute(sql`
      INSERT INTO portal_access_tokens (company_id, contact_id, token_hash, kind, expires_at)
      VALUES (${contact.companyId}, ${contact.id}, ${hashPortalToken(token)}, 'link', ${expiresAt})
      ON CONFLICT DO NOTHING`);
    return contact;
  }
}
