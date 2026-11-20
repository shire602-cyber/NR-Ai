// DatabaseStorage part: AI anomaly alerts, cash flow forecasts, transaction classifications, budgets, e-commerce, KPIs, AI conversations.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  aiConversations,
  anomalyAlerts,
  budgets,
  cashFlowForecasts,
  ecommerceIntegrations,
  ecommerceTransactions,
  financialKpis,
  transactionClassifications,
  type AiConversation,
  type AnomalyAlert,
  type Budget,
  type CashFlowForecast,
  type EcommerceIntegration,
  type EcommerceTransaction,
  type FinancialKpi,
  type InsertAiConversation,
  type InsertAnomalyAlert,
  type InsertBudget,
  type InsertCashFlowForecast,
  type InsertEcommerceIntegration,
  type InsertEcommerceTransaction,
  type InsertFinancialKpi,
  type InsertTransactionClassification,
  type TransactionClassification,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import { encryptSecret } from "../services/secret-vault";
import { OperationsStorage } from "./operations";

export class InsightStorage extends OperationsStorage {
  // AI Anomaly Alerts
  async createAnomalyAlert(insertAlert: InsertAnomalyAlert): Promise<AnomalyAlert> {
    const [alert] = await db.insert(anomalyAlerts).values(insertAlert).returning();
    return alert;
  }

  async createAnomalyAlertIfNew(
    insertAlert: InsertAnomalyAlert
  ): Promise<AnomalyAlert | undefined> {
    const [alert] = await db
      .insert(anomalyAlerts)
      .values(insertAlert)
      .onConflictDoNothing()
      .returning();
    return alert;
  }

  async getAnomalyAlertById(id: string): Promise<AnomalyAlert | undefined> {
    const [alert] = await db.select().from(anomalyAlerts).where(eq(anomalyAlerts.id, id));
    return alert;
  }

  async getAnomalyAlertsByCompanyId(companyId: string): Promise<AnomalyAlert[]> {
    return await db
      .select()
      .from(anomalyAlerts)
      .where(eq(anomalyAlerts.companyId, companyId))
      .orderBy(desc(anomalyAlerts.createdAt));
  }

  async getUnresolvedAnomalyAlerts(companyId: string): Promise<AnomalyAlert[]> {
    return await db
      .select()
      .from(anomalyAlerts)
      .where(and(eq(anomalyAlerts.companyId, companyId), eq(anomalyAlerts.isResolved, false)))
      .orderBy(desc(anomalyAlerts.createdAt));
  }

  async updateAnomalyAlert(id: string, data: Partial<InsertAnomalyAlert>): Promise<AnomalyAlert> {
    const [alert] = await db
      .update(anomalyAlerts)
      .set(data)
      .where(eq(anomalyAlerts.id, id))
      .returning();
    if (!alert) {
      throw new Error("Anomaly alert not found");
    }
    return alert;
  }

  async resolveAnomalyAlert(id: string, userId: string, note?: string): Promise<AnomalyAlert> {
    const [alert] = await db
      .update(anomalyAlerts)
      .set({
        isResolved: true,
        resolvedBy: userId,
        resolvedAt: new Date(),
        resolutionNote: note,
      })
      .where(eq(anomalyAlerts.id, id))
      .returning();
    if (!alert) {
      throw new Error("Anomaly alert not found");
    }
    return alert;
  }

  // Cash Flow Forecasts
  async createCashFlowForecast(insertForecast: InsertCashFlowForecast): Promise<CashFlowForecast> {
    const [forecast] = await db.insert(cashFlowForecasts).values(insertForecast).returning();
    return forecast;
  }

  async getCashFlowForecastsByCompanyId(companyId: string): Promise<CashFlowForecast[]> {
    return await db
      .select()
      .from(cashFlowForecasts)
      .where(eq(cashFlowForecasts.companyId, companyId))
      .orderBy(cashFlowForecasts.forecastDate);
  }

  async deleteCashFlowForecastsByCompanyId(companyId: string): Promise<void> {
    await db.delete(cashFlowForecasts).where(eq(cashFlowForecasts.companyId, companyId));
  }

  // Transaction Classifications
  async createTransactionClassification(
    insertClassification: InsertTransactionClassification
  ): Promise<TransactionClassification> {
    const [classification] = await db
      .insert(transactionClassifications)
      .values(insertClassification)
      .returning();
    return classification;
  }

  async getTransactionClassification(id: string): Promise<TransactionClassification | undefined> {
    const [classification] = await db
      .select()
      .from(transactionClassifications)
      .where(eq(transactionClassifications.id, id))
      .limit(1);
    return classification || undefined;
  }

  async getTransactionClassificationsByCompanyId(
    companyId: string
  ): Promise<TransactionClassification[]> {
    return await db
      .select()
      .from(transactionClassifications)
      .where(eq(transactionClassifications.companyId, companyId))
      .orderBy(desc(transactionClassifications.createdAt));
  }

  async updateTransactionClassification(
    id: string,
    companyId: string,
    data: Partial<InsertTransactionClassification>
  ): Promise<TransactionClassification> {
    // Scoping by company_id is defense-in-depth: the route layer already
    // verifies tenant access, but a regression there must not silently mutate
    // another tenant's row. The UPDATE returns no rows when the id/company
    // pair doesn't match, which we surface as a not-found error.
    const [classification] = await db
      .update(transactionClassifications)
      .set(data)
      .where(
        and(
          eq(transactionClassifications.id, id),
          eq(transactionClassifications.companyId, companyId)
        )
      )
      .returning();
    if (!classification) {
      throw new Error("Transaction classification not found");
    }
    return classification;
  }

  // Budgets
  async getBudgetsByCompanyId(companyId: string, year: number, month: number): Promise<Budget[]> {
    return await db
      .select()
      .from(budgets)
      .where(
        and(eq(budgets.companyId, companyId), eq(budgets.year, year), eq(budgets.month, month))
      );
  }

  async createBudget(insertBudget: InsertBudget): Promise<Budget> {
    const [budget] = await db.insert(budgets).values(insertBudget).returning();
    return budget;
  }

  async updateBudget(id: string, companyId: string, data: Partial<InsertBudget>): Promise<Budget> {
    const [budget] = await db
      .update(budgets)
      .set(data)
      .where(and(eq(budgets.id, id), eq(budgets.companyId, companyId)))
      .returning();
    if (!budget) {
      throw new Error("Budget not found");
    }
    return budget;
  }

  // E-Commerce Integrations
  async getEcommerceIntegrations(companyId: string): Promise<EcommerceIntegration[]> {
    return await db
      .select()
      .from(ecommerceIntegrations)
      .where(eq(ecommerceIntegrations.companyId, companyId))
      .orderBy(desc(ecommerceIntegrations.createdAt));
  }

  async getEcommerceIntegrationById(id: string): Promise<EcommerceIntegration | undefined> {
    const [integration] = await db
      .select()
      .from(ecommerceIntegrations)
      .where(eq(ecommerceIntegrations.id, id));
    return integration || undefined;
  }

  async createEcommerceIntegration(
    insertIntegration: InsertEcommerceIntegration
  ): Promise<EcommerceIntegration> {
    const [integration] = await db
      .insert(ecommerceIntegrations)
      .values({
        ...insertIntegration,
        // Same at-rest encryption as bank connection tokens.
        apiKey: encryptSecret(insertIntegration.apiKey ?? null),
        accessToken: encryptSecret(insertIntegration.accessToken ?? null),
        refreshToken: encryptSecret(insertIntegration.refreshToken ?? null),
        webhookSecret: encryptSecret(insertIntegration.webhookSecret ?? null),
      })
      .returning();
    return integration;
  }

  async updateEcommerceIntegration(
    id: string,
    data: Partial<InsertEcommerceIntegration>
  ): Promise<EcommerceIntegration> {
    const patch = { ...data };
    if ("apiKey" in patch) patch.apiKey = encryptSecret(patch.apiKey ?? null);
    if ("accessToken" in patch) patch.accessToken = encryptSecret(patch.accessToken ?? null);
    if ("refreshToken" in patch) patch.refreshToken = encryptSecret(patch.refreshToken ?? null);
    if ("webhookSecret" in patch) patch.webhookSecret = encryptSecret(patch.webhookSecret ?? null);
    const [integration] = await db
      .update(ecommerceIntegrations)
      .set(patch)
      .where(eq(ecommerceIntegrations.id, id))
      .returning();
    if (!integration) {
      throw new Error("E-commerce integration not found");
    }
    return integration;
  }

  async deleteEcommerceIntegration(id: string): Promise<void> {
    await db.delete(ecommerceIntegrations).where(eq(ecommerceIntegrations.id, id));
  }

  // E-Commerce Transactions
  async getEcommerceTransactions(companyId: string): Promise<EcommerceTransaction[]> {
    const results = await db
      .select({
        ecommerceTransactions: ecommerceTransactions,
      })
      .from(ecommerceTransactions)
      .innerJoin(
        ecommerceIntegrations,
        eq(ecommerceTransactions.integrationId, ecommerceIntegrations.id)
      )
      .where(eq(ecommerceIntegrations.companyId, companyId));

    return results.map((r) => r.ecommerceTransactions);
  }

  async createEcommerceTransaction(
    insertTransaction: InsertEcommerceTransaction
  ): Promise<EcommerceTransaction> {
    const [transaction] = await db
      .insert(ecommerceTransactions)
      .values(insertTransaction)
      .returning();
    return transaction;
  }

  async updateEcommerceTransaction(
    id: string,
    data: Partial<InsertEcommerceTransaction>
  ): Promise<EcommerceTransaction> {
    const [transaction] = await db
      .update(ecommerceTransactions)
      .set(data)
      .where(eq(ecommerceTransactions.id, id))
      .returning();
    if (!transaction) {
      throw new Error("E-commerce transaction not found");
    }
    return transaction;
  }

  // Financial KPIs
  async getFinancialKpis(companyId: string): Promise<FinancialKpi[]> {
    return await db
      .select()
      .from(financialKpis)
      .where(eq(financialKpis.companyId, companyId))
      .orderBy(desc(financialKpis.calculatedAt));
  }

  async createFinancialKpi(insertKpi: InsertFinancialKpi): Promise<FinancialKpi> {
    const [kpi] = await db.insert(financialKpis).values(insertKpi).returning();
    return kpi;
  }

  // Cash Flow Forecasts (alias for consistency)
  async getCashFlowForecasts(companyId: string): Promise<CashFlowForecast[]> {
    return this.getCashFlowForecastsByCompanyId(companyId);
  }

  // AI Conversations
  async createAiConversation(conversation: InsertAiConversation): Promise<AiConversation> {
    const [result] = await db.insert(aiConversations).values(conversation).returning();
    return result;
  }

  async getAiConversationsByUserId(userId: string, limit: number = 50): Promise<AiConversation[]> {
    return await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.userId, userId))
      .orderBy(desc(aiConversations.createdAt))
      .limit(limit);
  }

  async getAiConversationsByCompanyId(
    companyId: string,
    limit: number = 50
  ): Promise<AiConversation[]> {
    return await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.companyId, companyId))
      .orderBy(desc(aiConversations.createdAt))
      .limit(limit);
  }

  async getAiConversation(id: string): Promise<AiConversation | undefined> {
    const [conversation] = await db
      .select()
      .from(aiConversations)
      .where(eq(aiConversations.id, id));
    return conversation || undefined;
  }

  async deleteAiConversation(id: string): Promise<void> {
    await db.delete(aiConversations).where(eq(aiConversations.id, id));
  }
}
