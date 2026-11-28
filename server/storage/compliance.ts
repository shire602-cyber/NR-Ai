// DatabaseStorage part: Audit and activity logs, VAT and corporate tax returns, document vault, tax archive, compliance tasks, messages, news, invitations.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  activityLogs,
  auditLogs,
  companyInvitations,
  complianceTasks,
  corporateTaxReturns,
  documents,
  invitations,
  messages,
  newsItems,
  taxReturnArchive,
  vatReturns,
  type ActivityLog,
  type AuditLog,
  type CompanyInvitation,
  type ComplianceTask,
  type CorporateTaxReturn,
  type Document,
  type InsertActivityLog,
  type InsertAuditLog,
  type InsertCompanyInvitation,
  type InsertComplianceTask,
  type InsertCorporateTaxReturn,
  type InsertDocument,
  type InsertInvitation,
  type InsertMessage,
  type InsertNewsItem,
  type InsertTaxReturnArchive,
  type InsertVatReturn,
  type Invitation,
  type Message,
  type NewsItem,
  type TaxReturnArchive,
  type VatReturn,
} from "@shared/schema";
import { db, type AppDatabase } from "../db";
import { databaseUtcNow } from "../config/database-time";
import { and, desc, eq, getTableColumns, lt, or, sql, type SQL } from "drizzle-orm";
import { CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP } from "../../shared/ct-workpaper";
import { isScopedIdPair, scopedGet } from "../tenancy";
import type { AuditLogFilter } from "./types";
import { auditFilterConditions, auditLogToActivityLog, normalizeEmail } from "./helpers";
import { EngagementStorage } from "./engagement";
import { sealAuditChainWaiting } from "../services/audit-chain.service";

const invitationColumns = {
  ...getTableColumns(companyInvitations),
  expired: sql<boolean>`${companyInvitations.expiresAt} <= ${databaseUtcNow}`,
};
type InvitationWithExpiry = CompanyInvitation & { expired: boolean };

export class ComplianceStorage extends EngagementStorage {
  // Audit Logs
  async getAuditLogs(limit: number = 100): Promise<AuditLog[]> {
    return await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }

  async createAuditLog(insertLog: InsertAuditLog): Promise<AuditLog> {
    const [log] = await db.insert(auditLogs).values(insertLog).returning();
    // W5-E: a row written while another transaction held the chain lock is stored
    // unsealed. F8: append it now, waiting briefly for the chain lock; a non-waiting seal
    // could lose to a sealer whose snapshot predates this commit and leave the row pending.
    if (log && log.seq === null && log.chainKey) {
      await sealAuditChainWaiting(log.chainKey);
    }
    return log;
  }

  // W5-E: filtered audit reads (company chain / one user's account events).
  async getCompanyAuditLogs(companyId: string, filter: AuditLogFilter = {}): Promise<AuditLog[]> {
    return await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.companyId, companyId), ...auditFilterConditions(filter)))
      .orderBy(desc(auditLogs.seq))
      .limit(Math.min(filter.limit ?? 100, 500))
      .offset(filter.offset ?? 0);
  }

  async getUserSecurityEvents(userId: string, filter: AuditLogFilter = {}): Promise<AuditLog[]> {
    return await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, userId), ...auditFilterConditions(filter)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(Math.min(filter.limit ?? 100, 500))
      .offset(filter.offset ?? 0);
  }

  // VAT Returns
  async getVatReturnsByCompanyId(companyId: string): Promise<VatReturn[]> {
    return await db
      .select()
      .from(vatReturns)
      .where(eq(vatReturns.companyId, companyId))
      .orderBy(desc(vatReturns.periodEnd));
  }

  async getVatReturn(id: string): Promise<VatReturn | undefined> {
    const [vatReturn] = await db.select().from(vatReturns).where(eq(vatReturns.id, id));
    return vatReturn || undefined;
  }

  async createVatReturn(insertVatReturn: InsertVatReturn): Promise<VatReturn> {
    const [vatReturn] = await db.insert(vatReturns).values(insertVatReturn).returning();
    return vatReturn;
  }

  async updateUnfiledVatReturn(
    companyId: string,
    id: string,
    previousStatus: string,
    data: Partial<InsertVatReturn>
  ): Promise<VatReturn | undefined> {
    const [updated] = await db
      .update(vatReturns)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(vatReturns.id, id),
          eq(vatReturns.companyId, companyId),
          eq(vatReturns.status, previousStatus),
          sql`NULLIF(BTRIM(${vatReturns.ftaReferenceNumber}), '') IS NULL`
        )
      )
      .returning();
    return updated;
  }

  async deleteVatReturn(id: string): Promise<void> {
    await db.delete(vatReturns).where(eq(vatReturns.id, id));
  }

  // Corporate Tax Returns
  async getCorporateTaxReturnsByCompanyId(companyId: string): Promise<CorporateTaxReturn[]> {
    return await db
      .select()
      .from(corporateTaxReturns)
      .where(eq(corporateTaxReturns.companyId, companyId))
      .orderBy(desc(corporateTaxReturns.taxPeriodEnd));
  }

  async getCorporateTaxReturn(id: string): Promise<CorporateTaxReturn | undefined> {
    const [taxReturn] = await db
      .select()
      .from(corporateTaxReturns)
      .where(eq(corporateTaxReturns.id, id));
    return taxReturn || undefined;
  }

  /**
   * Opening tax-loss pool for a CT period: the closing carryforward of the
   * company's most recent earlier return (Art. 37 FDL 47/2022). Excludes the
   * return being computed so recomputes are idempotent.
   */
  async getCtLossBroughtForward(
    companyId: string,
    periodStart: Date,
    excludeReturnId?: string
  ): Promise<number> {
    const rows = await db
      .select({
        lossCarriedForward: corporateTaxReturns.lossCarriedForward,
        id: corporateTaxReturns.id,
      })
      .from(corporateTaxReturns)
      .where(
        and(
          eq(corporateTaxReturns.companyId, companyId),
          lt(corporateTaxReturns.taxPeriodEnd, periodStart)
        )
      )
      .orderBy(desc(corporateTaxReturns.taxPeriodEnd))
      .limit(2);
    const prior = rows.find((r: { id: string }) => r.id !== excludeReturnId);
    return Number(prior?.lossCarriedForward ?? 0) || 0;
  }

  // A-B16: Small Business Relief (MD 73/2023) requires revenue to stay within
  // the AED 3M cap in the current AND every prior period. Returns true if any
  // earlier return for this company breached the cap, so the computation can
  // deny relief even when the current period is within the cap.
  async getCtPriorPeriodRevenueExceededCap(
    companyId: string,
    periodStart: Date,
    excludeReturnId?: string
  ): Promise<boolean> {
    const rows = await db
      .select({
        totalRevenue: corporateTaxReturns.totalRevenue,
        id: corporateTaxReturns.id,
      })
      .from(corporateTaxReturns)
      .where(
        and(
          eq(corporateTaxReturns.companyId, companyId),
          lt(corporateTaxReturns.taxPeriodEnd, periodStart)
        )
      );
    return rows.some(
      (r: { id: string; totalRevenue: unknown }) =>
        r.id !== excludeReturnId &&
        (Number(r.totalRevenue) || 0) > CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP
    );
  }

  async createCorporateTaxReturn(data: InsertCorporateTaxReturn): Promise<CorporateTaxReturn> {
    const [taxReturn] = await db.insert(corporateTaxReturns).values(data).returning();
    return taxReturn;
  }

  async updateCorporateTaxReturn(
    id: string,
    data: Partial<CorporateTaxReturn>
  ): Promise<CorporateTaxReturn> {
    const [taxReturn] = await db
      .update(corporateTaxReturns)
      .set(data)
      .where(eq(corporateTaxReturns.id, id))
      .returning();
    return taxReturn;
  }

  // Document Vault
  async getDocuments(companyId: string): Promise<Document[]> {
    return await db
      .select()
      .from(documents)
      .where(eq(documents.companyId, companyId))
      .orderBy(desc(documents.createdAt));
  }

  async getDocument(id: string): Promise<Document | undefined> {
    const [document] = await db.select().from(documents).where(eq(documents.id, id));
    return document || undefined;
  }

  async createDocument(insertDocument: InsertDocument): Promise<Document> {
    const [document] = await db.insert(documents).values(insertDocument).returning();
    return document;
  }

  async updateDocument(id: string, data: Partial<InsertDocument>): Promise<Document> {
    const [document] = await db
      .update(documents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(documents.id, id))
      .returning();
    return document;
  }

  async deleteDocument(id: string): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  // Tax Return Archive
  async getTaxReturnArchive(companyId: string): Promise<TaxReturnArchive[]> {
    return await db
      .select()
      .from(taxReturnArchive)
      .where(eq(taxReturnArchive.companyId, companyId))
      .orderBy(desc(taxReturnArchive.filingDate));
  }

  async getTaxReturnArchiveItem(id: string): Promise<TaxReturnArchive | undefined> {
    const [item] = await db.select().from(taxReturnArchive).where(eq(taxReturnArchive.id, id));
    return item || undefined;
  }

  async createTaxReturnArchive(insertTaxReturn: InsertTaxReturnArchive): Promise<TaxReturnArchive> {
    const [taxReturn] = await db.insert(taxReturnArchive).values(insertTaxReturn).returning();
    return taxReturn;
  }

  async updateTaxReturnArchive(
    id: string,
    companyId: string,
    data: Partial<InsertTaxReturnArchive>
  ): Promise<TaxReturnArchive | undefined> {
    const { companyId: _ignored, ...rest } = data;
    const [row] = await db
      .update(taxReturnArchive)
      .set(rest)
      .where(and(eq(taxReturnArchive.id, id), eq(taxReturnArchive.companyId, companyId)))
      .returning();
    return row || undefined;
  }

  async deleteTaxReturnArchive(id: string, companyId: string): Promise<boolean> {
    const rows = await db
      .delete(taxReturnArchive)
      .where(and(eq(taxReturnArchive.id, id), eq(taxReturnArchive.companyId, companyId)))
      .returning({ id: taxReturnArchive.id });
    return rows.length > 0;
  }

  // Compliance Tasks
  async getComplianceTasks(companyId: string): Promise<ComplianceTask[]> {
    return await db
      .select()
      .from(complianceTasks)
      .where(eq(complianceTasks.companyId, companyId))
      .orderBy(complianceTasks.dueDate);
  }

  async getComplianceTask(id: string): Promise<ComplianceTask | undefined> {
    const [task] = await db.select().from(complianceTasks).where(eq(complianceTasks.id, id));
    return task || undefined;
  }

  async createComplianceTask(insertTask: InsertComplianceTask): Promise<ComplianceTask> {
    const [task] = await db.insert(complianceTasks).values(insertTask).returning();
    return task;
  }

  async updateComplianceTask(
    id: string,
    data: Partial<InsertComplianceTask>
  ): Promise<ComplianceTask> {
    const [task] = await db
      .update(complianceTasks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(complianceTasks.id, id))
      .returning();
    return task;
  }

  async deleteComplianceTask(id: string): Promise<void> {
    await db.delete(complianceTasks).where(eq(complianceTasks.id, id));
  }

  // Messages
  async getMessages(companyId: string): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.companyId, companyId))
      .orderBy(desc(messages.createdAt));
  }

  async getMessage(id: string): Promise<Message | undefined> {
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
    return message || undefined;
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const [message] = await db.insert(messages).values(insertMessage).returning();
    return message;
  }

  async markMessageAsRead(id: string): Promise<Message> {
    const [message] = await db
      .update(messages)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(messages.id, id))
      .returning();
    return message;
  }

  // News Items
  async getNewsItems(): Promise<NewsItem[]> {
    return await db
      .select()
      .from(newsItems)
      .where(eq(newsItems.isActive, true))
      .orderBy(desc(newsItems.publishedAt));
  }

  async createNewsItem(insertNews: InsertNewsItem): Promise<NewsItem> {
    const [news] = await db.insert(newsItems).values(insertNews).returning();
    return news;
  }

  // Invitations (Admin)
  async getInvitations(): Promise<Invitation[]> {
    return await db.select().from(invitations).orderBy(desc(invitations.createdAt));
  }

  async getInvitationsByCompany(companyId: string): Promise<Invitation[]> {
    return await db
      .select()
      .from(invitations)
      .where(eq(invitations.companyId, companyId))
      .orderBy(desc(invitations.createdAt));
  }

  async getInvitationByToken(token: string): Promise<Invitation | undefined> {
    const [invitation] = await db.select().from(invitations).where(eq(invitations.token, token));
    return invitation || undefined;
  }

  async getInvitationByEmail(email: string): Promise<Invitation | undefined> {
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(sql`lower(${invitations.email}) = ${normalizeEmail(email)}`);
    return invitation || undefined;
  }

  async createInvitation(insertInvitation: InsertInvitation): Promise<Invitation> {
    const [invitation] = await db.insert(invitations).values(insertInvitation).returning();
    return invitation;
  }

  async updateInvitation(id: string, data: Partial<InsertInvitation>): Promise<Invitation> {
    const [invitation] = await db
      .update(invitations)
      .set(data)
      .where(eq(invitations.id, id))
      .returning();
    return invitation;
  }

  async deleteInvitation(id: string): Promise<void> {
    await db.delete(invitations).where(eq(invitations.id, id));
  }

  // Company team invitations (W2-C, R01-04/R01-15). Every lookup by id is
  // scoped to the company; lookups by token use the SHA-256 digest only.
  async listCompanyInvitations(companyId: string): Promise<InvitationWithExpiry[]> {
    return db
      .select(invitationColumns)
      .from(companyInvitations)
      .where(eq(companyInvitations.companyId, companyId))
      .orderBy(desc(companyInvitations.createdAt));
  }

  async getCompanyInvitation(
    companyId: string,
    id: string
  ): Promise<CompanyInvitation | undefined> {
    return scopedGet(companyInvitations, companyId, id);
  }

  async getPendingCompanyInvitationByEmail(
    companyId: string,
    email: string
  ): Promise<InvitationWithExpiry | undefined> {
    const [row] = await db
      .select(invitationColumns)
      .from(companyInvitations)
      .where(
        and(
          eq(companyInvitations.companyId, companyId),
          eq(companyInvitations.status, "pending"),
          sql`lower(${companyInvitations.email}) = ${normalizeEmail(email)}`
        )
      )
      .limit(1);
    return row;
  }

  async getCompanyInvitationByTokenHash(
    tokenHash: string
  ): Promise<InvitationWithExpiry | undefined> {
    const [row] = await db
      .select(invitationColumns)
      .from(companyInvitations)
      .where(eq(companyInvitations.tokenHash, tokenHash))
      .limit(1);
    return row;
  }

  async createCompanyInvitation(
    input: Omit<InsertCompanyInvitation, "expiresAt" | "lastSentAt"> & {
      expiresAt: Date | SQL;
      lastSentAt?: Date | null | SQL;
    }
  ): Promise<CompanyInvitation> {
    const [row] = await db
      .insert(companyInvitations)
      .values({ ...input, email: normalizeEmail(input.email) })
      .returning();
    return row;
  }

  async updateCompanyInvitation(
    companyId: string,
    id: string,
    data: Partial<
      Pick<
        CompanyInvitation,
        "status" | "tokenHash" | "acceptedAt" | "acceptedUserId" | "sendCount" | "invitedBy"
      >
    > & { expiresAt?: Date | SQL; revokedAt?: Date | null | SQL; lastSentAt?: Date | SQL },
    expected: Pick<CompanyInvitation, "status" | "tokenHash">
  ): Promise<CompanyInvitation | undefined> {
    if (!isScopedIdPair(companyId, id)) return undefined;
    const [row] = await db
      .update(companyInvitations)
      .set(data)
      .where(
        and(
          eq(companyInvitations.companyId, companyId),
          eq(companyInvitations.id, id),
          eq(companyInvitations.status, expected.status),
          eq(companyInvitations.tokenHash, expected.tokenHash)
        )
      )
      .returning();
    return row;
  }

  // Activity Logs (Admin)
  async getActivityLogs(limit: number = 100): Promise<ActivityLog[]> {
    const [activityRows, auditRows] = await Promise.all([
      db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(limit),
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit),
    ]);

    return [...activityRows, ...auditRows.map((row: AuditLog) => auditLogToActivityLog(row, null))]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async getActivityLogsByCompany(companyId: string, limit: number = 100): Promise<ActivityLog[]> {
    const auditCompanyPattern = `%"companyId":"${companyId}"%`;
    const [activityRows, auditRows] = await Promise.all([
      db
        .select()
        .from(activityLogs)
        .where(eq(activityLogs.companyId, companyId))
        .orderBy(desc(activityLogs.createdAt))
        .limit(limit),
      db
        .select()
        .from(auditLogs)
        .where(
          or(
            eq(auditLogs.companyId, companyId),
            sql`${auditLogs.details} LIKE ${auditCompanyPattern}`
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit),
    ]);

    return [
      ...activityRows,
      ...auditRows.map((row: AuditLog) => auditLogToActivityLog(row, companyId)),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async getActivityLogsByUser(userId: string, limit: number = 100): Promise<ActivityLog[]> {
    return await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, userId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  }

  async createActivityLog(
    insertLog: InsertActivityLog,
    conn: Pick<AppDatabase, "insert"> = db
  ): Promise<ActivityLog> {
    const [log] = await conn.insert(activityLogs).values(insertLog).returning();
    return log;
  }
}
