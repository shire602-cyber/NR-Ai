// DatabaseStorage part: Notifications, regulatory news, reminders, onboarding, help tips, referrals, feedback, analytics, admin settings, plans and user subscriptions.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  adminSettings,
  analyticsEvents,
  featureUsageMetrics,
  helpTips,
  notifications,
  referralCodes,
  referrals,
  regulatoryNews,
  reminderLogs,
  reminderSettings,
  userFeedback,
  userOnboarding,
  type AdminSetting,
  type AnalyticsEvent,
  type FeatureUsageMetric,
  type HelpTip,
  type InsertAdminSetting,
  type InsertAnalyticsEvent,
  type InsertFeatureUsageMetric,
  type InsertHelpTip,
  type InsertNotification,
  type InsertReferral,
  type InsertReferralCode,
  type InsertRegulatoryNews,
  type InsertReminderLog,
  type InsertReminderSetting,
  type InsertUserFeedback,
  type InsertUserOnboarding,
  type Notification,
  type Referral,
  type ReferralCode,
  type RegulatoryNews,
  type ReminderLog,
  type ReminderSetting,
  type UserFeedback,
  type UserOnboarding,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { InsightStorage } from "./insights";

export class EngagementStorage extends InsightStorage {
  // Notifications
  async getNotificationsByUserId(userId: string): Promise<Notification[]> {
    return await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isDismissed, false)))
      .orderBy(desc(notifications.createdAt));
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    const result = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
          eq(notifications.isDismissed, false)
        )
      );
    return result.length;
  }

  async createNotification(insertNotification: InsertNotification): Promise<Notification> {
    const [notification] = await db.insert(notifications).values(insertNotification).returning();
    return notification;
  }

  async markNotificationAsRead(id: string, userId: string): Promise<Notification | undefined> {
    // Ownership is part of the WHERE clause so another user's notification
    // is indistinguishable from a missing one (no existence oracle).
    const [notification] = await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    return notification;
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(notifications.userId, userId));
  }

  async dismissNotification(id: string, userId: string): Promise<Notification | undefined> {
    const [notification] = await db
      .update(notifications)
      .set({ isDismissed: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    return notification;
  }

  // Regulatory News
  async getRegulatoryNews(): Promise<RegulatoryNews[]> {
    return await db
      .select()
      .from(regulatoryNews)
      .where(eq(regulatoryNews.isActive, true))
      .orderBy(desc(regulatoryNews.publishedAt));
  }

  async createRegulatoryNews(insertNews: InsertRegulatoryNews): Promise<RegulatoryNews> {
    const [news] = await db.insert(regulatoryNews).values(insertNews).returning();
    return news;
  }

  // Reminder Settings
  async getReminderSettingsByCompanyId(companyId: string): Promise<ReminderSetting[]> {
    return await db
      .select()
      .from(reminderSettings)
      .where(eq(reminderSettings.companyId, companyId));
  }

  async createReminderSetting(insertSetting: InsertReminderSetting): Promise<ReminderSetting> {
    const [setting] = await db.insert(reminderSettings).values(insertSetting).returning();
    return setting;
  }

  async getReminderSetting(id: string): Promise<ReminderSetting | undefined> {
    const [setting] = await db.select().from(reminderSettings).where(eq(reminderSettings.id, id));
    return setting || undefined;
  }

  async deleteReminderSettingForCompany(id: string, companyId: string): Promise<boolean> {
    const rows = await db
      .delete(reminderSettings)
      .where(and(eq(reminderSettings.id, id), eq(reminderSettings.companyId, companyId)))
      .returning({ id: reminderSettings.id });
    return rows.length > 0;
  }

  async updateReminderSettingForCompany(
    id: string,
    companyId: string,
    data: Partial<InsertReminderSetting>
  ): Promise<ReminderSetting | undefined> {
    // companyId is immutable: it only appears in the WHERE clause.
    const { companyId: _ignored, ...rest } = data as Partial<InsertReminderSetting> & {
      companyId?: string;
    };
    const [setting] = await db
      .update(reminderSettings)
      .set({ ...rest, updatedAt: new Date() })
      .where(and(eq(reminderSettings.id, id), eq(reminderSettings.companyId, companyId)))
      .returning();
    return setting || undefined;
  }

  async updateReminderSetting(
    id: string,
    data: Partial<InsertReminderSetting>
  ): Promise<ReminderSetting> {
    const [setting] = await db
      .update(reminderSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(reminderSettings.id, id))
      .returning();
    return setting;
  }

  // Reminder Logs
  async getReminderLogsByCompanyId(companyId: string): Promise<ReminderLog[]> {
    return await db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.companyId, companyId))
      .orderBy(desc(reminderLogs.createdAt));
  }

  async createReminderLog(insertLog: InsertReminderLog): Promise<ReminderLog> {
    const [log] = await db.insert(reminderLogs).values(insertLog).returning();
    return log;
  }

  async updateReminderLog(id: string, data: Partial<InsertReminderLog>): Promise<ReminderLog> {
    const [log] = await db
      .update(reminderLogs)
      .set(data)
      .where(eq(reminderLogs.id, id))
      .returning();
    return log;
  }

  // User Onboarding
  async getUserOnboarding(userId: string): Promise<UserOnboarding | undefined> {
    const [onboarding] = await db
      .select()
      .from(userOnboarding)
      .where(eq(userOnboarding.userId, userId));
    return onboarding;
  }

  async createUserOnboarding(insertOnboarding: InsertUserOnboarding): Promise<UserOnboarding> {
    const [onboarding] = await db.insert(userOnboarding).values(insertOnboarding).returning();
    return onboarding;
  }

  async updateUserOnboarding(
    userId: string,
    data: Partial<InsertUserOnboarding>
  ): Promise<UserOnboarding> {
    const [onboarding] = await db
      .update(userOnboarding)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userOnboarding.userId, userId))
      .returning();
    return onboarding;
  }

  // Help Tips
  async getHelpTipsByPage(pageContext: string): Promise<HelpTip[]> {
    return await db
      .select()
      .from(helpTips)
      .where(and(eq(helpTips.pageContext, pageContext), eq(helpTips.isActive, true)))
      .orderBy(helpTips.order);
  }

  async getAllHelpTips(): Promise<HelpTip[]> {
    return await db
      .select()
      .from(helpTips)
      .where(eq(helpTips.isActive, true))
      .orderBy(helpTips.order);
  }

  async createHelpTip(insertTip: InsertHelpTip): Promise<HelpTip> {
    const [tip] = await db.insert(helpTips).values(insertTip).returning();
    return tip;
  }

  // Referral Codes
  async getReferralCodeByUserId(userId: string): Promise<ReferralCode | undefined> {
    const [code] = await db.select().from(referralCodes).where(eq(referralCodes.userId, userId));
    return code;
  }

  async getReferralCodeByCode(code: string): Promise<ReferralCode | undefined> {
    const [referralCode] = await db
      .select()
      .from(referralCodes)
      .where(eq(referralCodes.code, code));
    return referralCode;
  }

  async createReferralCode(insertCode: InsertReferralCode): Promise<ReferralCode> {
    const [code] = await db.insert(referralCodes).values(insertCode).returning();
    return code;
  }

  async updateReferralCode(id: string, data: Partial<InsertReferralCode>): Promise<ReferralCode> {
    const [code] = await db
      .update(referralCodes)
      .set(data)
      .where(eq(referralCodes.id, id))
      .returning();
    return code;
  }

  // Referrals
  async getReferralsByReferrerId(referrerId: string): Promise<Referral[]> {
    return await db
      .select()
      .from(referrals)
      .where(eq(referrals.referrerId, referrerId))
      .orderBy(desc(referrals.createdAt));
  }

  async createReferral(insertReferral: InsertReferral): Promise<Referral> {
    const [referral] = await db.insert(referrals).values(insertReferral).returning();
    return referral;
  }

  async updateReferral(id: string, data: Partial<InsertReferral>): Promise<Referral> {
    const [referral] = await db.update(referrals).set(data).where(eq(referrals.id, id)).returning();
    return referral;
  }

  // User Feedback
  async createUserFeedback(insertFeedback: InsertUserFeedback): Promise<UserFeedback> {
    const [feedback] = await db.insert(userFeedback).values(insertFeedback).returning();
    return feedback;
  }

  async getUserFeedback(userId?: string): Promise<UserFeedback[]> {
    if (userId) {
      return await db
        .select()
        .from(userFeedback)
        .where(eq(userFeedback.userId, userId))
        .orderBy(desc(userFeedback.createdAt));
    }
    return await db.select().from(userFeedback).orderBy(desc(userFeedback.createdAt));
  }

  async updateUserFeedback(id: string, data: Partial<InsertUserFeedback>): Promise<UserFeedback> {
    const [feedback] = await db
      .update(userFeedback)
      .set(data)
      .where(eq(userFeedback.id, id))
      .returning();
    return feedback;
  }

  // Analytics Events
  async createAnalyticsEvent(insertEvent: InsertAnalyticsEvent): Promise<AnalyticsEvent> {
    const [event] = await db.insert(analyticsEvents).values(insertEvent).returning();
    return event;
  }

  async getAnalyticsEvents(filters?: {
    userId?: string;
    companyId?: string;
    companyIds?: string[];
    eventType?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<AnalyticsEvent[]> {
    // Filters AND together (the previous chained .where() calls replaced each other).
    const conds = [];
    if (filters?.userId) conds.push(eq(analyticsEvents.userId, filters.userId));
    if (filters?.companyId) conds.push(eq(analyticsEvents.companyId, filters.companyId));
    if (filters?.companyIds) {
      if (filters.companyIds.length === 0) return [];
      conds.push(inArray(analyticsEvents.companyId, filters.companyIds));
    }
    if (filters?.eventType) conds.push(eq(analyticsEvents.eventType, filters.eventType));
    if (filters?.startDate) conds.push(gte(analyticsEvents.createdAt, filters.startDate));
    if (filters?.endDate) conds.push(lte(analyticsEvents.createdAt, filters.endDate));

    const base = db.select().from(analyticsEvents);
    const filtered = conds.length ? base.where(and(...conds)) : base;
    const ordered = filtered.orderBy(desc(analyticsEvents.createdAt));
    return await (filters?.limit ? ordered.limit(filters.limit) : ordered);
  }

  // Feature Usage Metrics
  async getFeatureUsageMetrics(featureName?: string): Promise<FeatureUsageMetric[]> {
    if (featureName) {
      return await db
        .select()
        .from(featureUsageMetrics)
        .where(eq(featureUsageMetrics.featureName, featureName))
        .orderBy(desc(featureUsageMetrics.calculatedAt));
    }
    return await db
      .select()
      .from(featureUsageMetrics)
      .orderBy(desc(featureUsageMetrics.calculatedAt));
  }

  async createFeatureUsageMetric(
    insertMetric: InsertFeatureUsageMetric
  ): Promise<FeatureUsageMetric> {
    const [metric] = await db.insert(featureUsageMetrics).values(insertMetric).returning();
    return metric;
  }

  // Admin Settings
  async getAdminSettings(): Promise<AdminSetting[]> {
    return await db.select().from(adminSettings);
  }

  async getAdminSettingByKey(key: string): Promise<AdminSetting | undefined> {
    const [setting] = await db.select().from(adminSettings).where(eq(adminSettings.key, key));
    return setting || undefined;
  }

  async createAdminSetting(insertSetting: InsertAdminSetting): Promise<AdminSetting> {
    const [setting] = await db.insert(adminSettings).values(insertSetting).returning();
    return setting;
  }

  async updateAdminSetting(key: string, value: string): Promise<AdminSetting> {
    const [setting] = await db
      .update(adminSettings)
      .set({ value, updatedAt: new Date() })
      .where(eq(adminSettings.key, key))
      .returning();
    return setting;
  }
}
