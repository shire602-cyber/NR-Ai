// DatabaseStorage part: Bank accounts, bank transactions, bank connections and reconciliation rules.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  bankAccounts,
  bankConnections,
  bankTransactions,
  reconciliationRules,
  type BankAccount,
  type BankConnection,
  type BankTransaction,
  type InsertBankAccount,
  type InsertBankConnection,
  type InsertBankTransaction,
  type InsertReconciliationRule,
  type ReconciliationRule,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { encryptSecret } from "../services/secret-vault";
import { IntegrationStorage } from "./integrations";

export class BankingStorage extends IntegrationStorage {
  // Bank Accounts
  async createBankAccount(account: InsertBankAccount): Promise<BankAccount> {
    const [result] = await db.insert(bankAccounts).values(account).returning();
    return result;
  }

  async getBankAccountsByCompanyId(companyId: string): Promise<BankAccount[]> {
    return await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.companyId, companyId))
      .orderBy(bankAccounts.nameEn);
  }

  async getBankAccountById(id: string, companyId?: string): Promise<BankAccount | undefined> {
    const [result] = await db
      .select()
      .from(bankAccounts)
      .where(
        companyId
          ? and(eq(bankAccounts.id, id), eq(bankAccounts.companyId, companyId))
          : eq(bankAccounts.id, id)
      );
    return result;
  }

  async updateBankAccount(id: string, data: Partial<InsertBankAccount>): Promise<BankAccount> {
    const [result] = await db
      .update(bankAccounts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(bankAccounts.id, id))
      .returning();
    if (!result) throw new Error("Bank account not found");
    return result;
  }

  // Bank Transactions
  async createBankTransaction(insertTransaction: InsertBankTransaction): Promise<BankTransaction> {
    const [transaction] = await db.insert(bankTransactions).values(insertTransaction).returning();
    return transaction;
  }

  async bulkCreateBankTransactions(
    transactions: InsertBankTransaction[]
  ): Promise<BankTransaction[]> {
    if (transactions.length === 0) return [];
    return await db.insert(bankTransactions).values(transactions).returning();
  }

  async getBankTransactionById(
    id: string,
    companyId: string
  ): Promise<BankTransaction | undefined> {
    const [transaction] = await db
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, id), eq(bankTransactions.companyId, companyId)));
    return transaction;
  }

  async getBankTransactionsByCompanyId(companyId: string): Promise<BankTransaction[]> {
    return await db
      .select()
      .from(bankTransactions)
      .where(and(eq(bankTransactions.companyId, companyId), isNull(bankTransactions.deletedAt)))
      .orderBy(desc(bankTransactions.transactionDate));
  }

  async getUnreconciledBankTransactions(companyId: string): Promise<BankTransaction[]> {
    return await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.companyId, companyId),
          eq(bankTransactions.isReconciled, false),
          isNull(bankTransactions.deletedAt),
          isNull(bankTransactions.excludedAt)
        )
      )
      .orderBy(desc(bankTransactions.transactionDate));
  }

  // Compatibility records are read without opening historical credentials.
  async getBankConnectionsByCompanyId(companyId: string): Promise<BankConnection[]> {
    return db
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.companyId, companyId))
      .orderBy(desc(bankConnections.createdAt));
  }

  async getBankConnection(id: string): Promise<BankConnection | undefined> {
    const [connection] = await db
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.id, id))
      .limit(1);
    return connection;
  }

  async createBankConnection(data: InsertBankConnection): Promise<BankConnection> {
    const [connection] = await db
      .insert(bankConnections)
      .values({
        ...data,
        accessToken: encryptSecret(data.accessToken ?? null),
        refreshToken: encryptSecret(data.refreshToken ?? null),
      })
      .returning();
    return connection;
  }

  async updateBankConnection(
    id: string,
    data: Partial<InsertBankConnection>
  ): Promise<BankConnection | undefined> {
    const patch: Partial<InsertBankConnection> = { ...data };
    if ("accessToken" in patch) patch.accessToken = encryptSecret(patch.accessToken ?? null);
    if ("refreshToken" in patch) patch.refreshToken = encryptSecret(patch.refreshToken ?? null);
    const [connection] = await db
      .update(bankConnections)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(bankConnections.id, id))
      .returning();
    return connection;
  }

  async updateBankConnectionTokens(
    id: string,
    tokens: {
      accessToken?: string;
      refreshToken?: string | null;
      tokenExpiresAt?: Date | null;
      status?: string;
      lastError?: string | null;
    }
  ): Promise<void> {
    await db
      .update(bankConnections)
      .set({
        ...(tokens.accessToken !== undefined
          ? { accessToken: encryptSecret(tokens.accessToken) }
          : {}),
        ...(tokens.refreshToken !== undefined
          ? { refreshToken: encryptSecret(tokens.refreshToken) }
          : {}),
        ...(tokens.tokenExpiresAt !== undefined ? { tokenExpiresAt: tokens.tokenExpiresAt } : {}),
        ...(tokens.status !== undefined ? { status: tokens.status } : {}),
        ...(tokens.lastError !== undefined ? { lastError: tokens.lastError } : {}),
        updatedAt: new Date(),
      })
      .where(eq(bankConnections.id, id));
  }

  async deleteBankConnection(id: string): Promise<void> {
    await db.delete(bankConnections).where(eq(bankConnections.id, id));
  }

  // Reconciliation rules
  async getReconciliationRulesByCompanyId(companyId: string): Promise<ReconciliationRule[]> {
    return await db
      .select()
      .from(reconciliationRules)
      .where(eq(reconciliationRules.companyId, companyId))
      .orderBy(desc(reconciliationRules.priority), reconciliationRules.createdAt);
  }

  async getReconciliationRule(id: string): Promise<ReconciliationRule | undefined> {
    const [rule] = await db
      .select()
      .from(reconciliationRules)
      .where(eq(reconciliationRules.id, id))
      .limit(1);
    return rule;
  }

  async createReconciliationRule(data: InsertReconciliationRule): Promise<ReconciliationRule> {
    const [rule] = await db.insert(reconciliationRules).values(data).returning();
    return rule;
  }

  async updateReconciliationRule(
    id: string,
    data: Partial<InsertReconciliationRule>
  ): Promise<ReconciliationRule | undefined> {
    const [rule] = await db
      .update(reconciliationRules)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(reconciliationRules.id, id))
      .returning();
    return rule;
  }

  async deleteReconciliationRule(id: string): Promise<void> {
    await db.delete(reconciliationRules).where(eq(reconciliationRules.id, id));
  }

  async incrementRuleAppliedCount(id: string): Promise<void> {
    await db
      .update(reconciliationRules)
      .set({ timesApplied: sql`${reconciliationRules.timesApplied} + 1`, updatedAt: new Date() })
      .where(eq(reconciliationRules.id, id));
  }
}
