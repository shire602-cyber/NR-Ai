// DatabaseStorage part: Report delivery subscriptions, automation preferences, runs and scheduler scans.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  companyReportAutomationPreferences,
  companyReportDeliveryRuns,
  companyReportDeliverySchedulerScans,
  companyReportDeliverySubscriptions,
  type CompanyReportAutomationPreference,
  type CompanyReportDeliveryRun,
  type CompanyReportDeliverySchedulerScan,
  type CompanyReportDeliverySubscription,
  type InsertCompanyReportAutomationPreference,
  type InsertCompanyReportDeliveryRun,
  type InsertCompanyReportDeliverySchedulerScan,
  type InsertCompanyReportDeliverySubscription,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import { CompanyStorage } from "./companies";

export class ReportDeliveryStorage extends CompanyStorage {
  async getReportDeliverySubscriptionSettings(
    companyId: string
  ): Promise<CompanyReportDeliverySubscription[]> {
    return await db
      .select()
      .from(companyReportDeliverySubscriptions)
      .where(eq(companyReportDeliverySubscriptions.companyId, companyId))
      .orderBy(companyReportDeliverySubscriptions.subscriptionId);
  }

  async getReportAutomationPreferences(
    companyId: string,
    userId: string
  ): Promise<CompanyReportAutomationPreference[]> {
    return await db
      .select()
      .from(companyReportAutomationPreferences)
      .where(
        and(
          eq(companyReportAutomationPreferences.companyId, companyId),
          eq(companyReportAutomationPreferences.userId, userId)
        )
      )
      .orderBy(companyReportAutomationPreferences.persona);
  }

  async getReportAutomationPreference(
    companyId: string,
    userId: string,
    persona: string
  ): Promise<CompanyReportAutomationPreference | undefined> {
    const [preference] = await db
      .select()
      .from(companyReportAutomationPreferences)
      .where(
        and(
          eq(companyReportAutomationPreferences.companyId, companyId),
          eq(companyReportAutomationPreferences.userId, userId),
          eq(companyReportAutomationPreferences.persona, persona)
        )
      )
      .limit(1);
    return preference || undefined;
  }

  async upsertReportAutomationPreference(
    preference: InsertCompanyReportAutomationPreference
  ): Promise<CompanyReportAutomationPreference> {
    const [row] = await db
      .insert(companyReportAutomationPreferences)
      .values(preference)
      .onConflictDoUpdate({
        target: [
          companyReportAutomationPreferences.companyId,
          companyReportAutomationPreferences.userId,
          companyReportAutomationPreferences.persona,
        ],
        set: {
          preferredDeliveryAutomationCommand: preference.preferredDeliveryAutomationCommand,
          updatedAt: new Date(),
        },
      })
      .returning();

    return row;
  }

  async getReportDeliverySubscriptionSetting(
    companyId: string,
    subscriptionId: string
  ): Promise<CompanyReportDeliverySubscription | undefined> {
    const [setting] = await db
      .select()
      .from(companyReportDeliverySubscriptions)
      .where(
        and(
          eq(companyReportDeliverySubscriptions.companyId, companyId),
          eq(companyReportDeliverySubscriptions.subscriptionId, subscriptionId)
        )
      )
      .limit(1);
    return setting || undefined;
  }

  async upsertReportDeliverySubscriptionSetting(
    setting: InsertCompanyReportDeliverySubscription
  ): Promise<CompanyReportDeliverySubscription> {
    const updateSet: Partial<InsertCompanyReportDeliverySubscription> & { updatedAt: Date } = {
      updatedAt: new Date(),
    };

    if (setting.enabled !== undefined) updateSet.enabled = setting.enabled;
    if (setting.cadenceOverride !== undefined) updateSet.cadenceOverride = setting.cadenceOverride;
    if (setting.channelOverride !== undefined) updateSet.channelOverride = setting.channelOverride;
    if (setting.formatOverride !== undefined) updateSet.formatOverride = setting.formatOverride;
    if (setting.recipientsOverride !== undefined)
      updateSet.recipientsOverride = setting.recipientsOverride;
    if (setting.deliveryGuardrailOverride !== undefined) {
      updateSet.deliveryGuardrailOverride = setting.deliveryGuardrailOverride;
    }
    if (setting.updatedBy !== undefined) updateSet.updatedBy = setting.updatedBy;

    const [row] = await db
      .insert(companyReportDeliverySubscriptions)
      .values(setting)
      .onConflictDoUpdate({
        target: [
          companyReportDeliverySubscriptions.companyId,
          companyReportDeliverySubscriptions.subscriptionId,
        ],
        set: updateSet,
      })
      .returning();

    return row;
  }

  async getReportDeliveryRuns(
    companyId: string,
    options: { subscriptionId?: string; limit?: number } = {}
  ): Promise<CompanyReportDeliveryRun[]> {
    const whereClause = options.subscriptionId
      ? and(
          eq(companyReportDeliveryRuns.companyId, companyId),
          eq(companyReportDeliveryRuns.subscriptionId, options.subscriptionId)
        )
      : eq(companyReportDeliveryRuns.companyId, companyId);

    return await db
      .select()
      .from(companyReportDeliveryRuns)
      .where(whereClause)
      .orderBy(desc(companyReportDeliveryRuns.createdAt))
      .limit(options.limit ?? 20);
  }

  async getReportDeliveryRun(
    companyId: string,
    runId: string
  ): Promise<CompanyReportDeliveryRun | undefined> {
    const [row] = await db
      .select()
      .from(companyReportDeliveryRuns)
      .where(
        and(
          eq(companyReportDeliveryRuns.companyId, companyId),
          eq(companyReportDeliveryRuns.id, runId)
        )
      )
      .limit(1);
    return row;
  }

  async createReportDeliveryRun(
    run: InsertCompanyReportDeliveryRun
  ): Promise<CompanyReportDeliveryRun> {
    const [row] = await db.insert(companyReportDeliveryRuns).values(run).returning();
    return row;
  }

  async getReportDeliverySchedulerScans(
    companyId: string,
    options: { limit?: number } = {}
  ): Promise<CompanyReportDeliverySchedulerScan[]> {
    return await db
      .select()
      .from(companyReportDeliverySchedulerScans)
      .where(eq(companyReportDeliverySchedulerScans.companyId, companyId))
      .orderBy(desc(companyReportDeliverySchedulerScans.finishedAt))
      .limit(options.limit ?? 10);
  }

  async getLatestReportDeliverySchedulerScan(
    companyId: string
  ): Promise<CompanyReportDeliverySchedulerScan | undefined> {
    const [row] = await this.getReportDeliverySchedulerScans(companyId, { limit: 1 });
    return row;
  }

  async createReportDeliverySchedulerScan(
    scan: InsertCompanyReportDeliverySchedulerScan
  ): Promise<CompanyReportDeliverySchedulerScan> {
    const [row] = await db.insert(companyReportDeliverySchedulerScans).values(scan).returning();
    return row;
  }
}
