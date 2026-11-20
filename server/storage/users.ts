// DatabaseStorage part: Users, password reset tokens, admin user management and user types.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import { companies, passwordResetTokens, users, type Company, type User } from "@shared/schema";
import { db } from "../db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { NewUserInput } from "./types";
import { normalizeEmail } from "./helpers";

export class UserStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  // R01-05: emails are stored lower-cased and compared case-insensitively
  // (0092 adds a unique index on lower(email)).
  async getUserByEmail(email: string): Promise<User | undefined> {
    if (typeof email !== "string" || !email.trim()) return undefined;
    const normalized = normalizeEmail(email);
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalized}`)
      .orderBy(users.createdAt)
      .limit(1);
    return user || undefined;
  }

  async createUser(insertUser: NewUserInput): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        ...insertUser,
        email: normalizeEmail(insertUser.email),
        passwordHash: insertUser.passwordHash || "",
      })
      .returning();
    return user;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await db
      .update(users)
      .set({ passwordHash, passwordChangedAt: new Date() })
      .where(eq(users.id, userId));
  }

  // Password reset tokens
  async createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await db.insert(passwordResetTokens).values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
    });
  }

  async findValidPasswordResetToken(
    tokenHash: string
  ): Promise<{ id: string; userId: string } | undefined> {
    const [row] = await db
      .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date())
        )
      );
    return row || undefined;
  }

  async markPasswordResetTokenUsed(id: string): Promise<void> {
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, id));
  }

  async deletePasswordResetTokensForUser(userId: string): Promise<void> {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  }

  // Admin Stats
  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getAllCompanies(): Promise<Company[]> {
    return await db
      .select()
      .from(companies)
      .where(isNull(companies.deletedAt))
      .orderBy(desc(companies.createdAt));
  }

  // Admin User Management
  async updateUser(
    id: string,
    data: { name?: string; email?: string; isAdmin?: boolean }
  ): Promise<User> {
    const patch = data.email !== undefined ? { ...data, email: normalizeEmail(data.email) } : data;
    const [user] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  // User type management
  async updateUserType(id: string, userType: string): Promise<User> {
    const [user] = await db.update(users).set({ userType }).where(eq(users.id, id)).returning();
    return user;
  }

  async getUsersByType(userType: string): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(eq(users.userType, userType))
      .orderBy(desc(users.createdAt));
  }

  async getClientCompanies(): Promise<Company[]> {
    return await db
      .select()
      .from(companies)
      .where(and(eq(companies.companyType, "client"), isNull(companies.deletedAt)))
      .orderBy(desc(companies.createdAt));
  }

  async getCustomerCompanies(): Promise<Company[]> {
    return await db
      .select()
      .from(companies)
      .where(and(eq(companies.companyType, "customer"), isNull(companies.deletedAt)))
      .orderBy(desc(companies.createdAt));
  }
}
