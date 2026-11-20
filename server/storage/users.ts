// DatabaseStorage part: Users, password reset tokens, admin user management and user types.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  companies,
  customerPortalAccounts,
  emailVerificationTokens,
  passwordResetTokens,
  users,
  type Company,
  type User,
} from "@shared/schema";
import { db } from "../db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { NewUserInput } from "./types";
import { normalizeEmail } from "./helpers";
import { DomainError } from "../errors";
import { assertPortalInviteEmailAvailable, lockPortalInviteEmail } from "./portal-invite-email";

function validResetToken(tokenHash: string) {
  return and(
    eq(passwordResetTokens.tokenHash, tokenHash),
    isNull(passwordResetTokens.usedAt),
    gt(passwordResetTokens.expiresAt, new Date())
  );
}

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
    const email = normalizeEmail(insertUser.email);
    return db.transaction(async (tx) => {
      await lockPortalInviteEmail(tx, email);
      await assertPortalInviteEmailAvailable(tx, email);
      const [user] = await tx
        .insert(users)
        .values({
          ...insertUser,
          email,
          passwordHash: insertUser.passwordHash || "",
        })
        .returning();
      return user;
    });
  }

  async claimUncredentialedUser(
    user: User,
    name: string,
    passwordHash: string
  ): Promise<User | undefined> {
    const email = normalizeEmail(user.email);
    return db.transaction(async (tx) => {
      await lockPortalInviteEmail(tx, email);
      await assertPortalInviteEmailAvailable(tx, email);
      const [claimed] = await tx
        .update(users)
        .set({ name, passwordHash, passwordChangedAt: new Date() })
        .where(
          and(
            eq(users.id, user.id),
            eq(users.email, user.email),
            eq(users.passwordHash, user.passwordHash)
          )
        )
        .returning();
      return claimed;
    });
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await db
      .update(users)
      .set({ passwordHash, passwordChangedAt: new Date() })
      .where(eq(users.id, userId));
  }

  // Password reset tokens
  async replacePasswordResetToken(input: {
    userId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [user] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .for("update");
      if (!user || normalizeEmail(user.email) !== normalizeEmail(input.email)) return false;
      await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, input.userId));
      await tx.insert(passwordResetTokens).values({
        userId: input.userId,
        email: normalizeEmail(user.email),
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      });
      return true;
    });
  }

  async findValidPasswordResetToken(
    tokenHash: string
  ): Promise<{ id: string; userId: string } | undefined> {
    const [row] = await db
      .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
      .from(passwordResetTokens)
      .innerJoin(users, eq(users.id, passwordResetTokens.userId))
      .where(
        and(
          validResetToken(tokenHash),
          sql`${passwordResetTokens.email} = lower(btrim(${users.email}))`
        )
      );
    return row || undefined;
  }

  async resetPasswordWithToken(
    userId: string,
    tokenHash: string,
    passwordHash: string
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      // Email changes and reset requests also take the user lock before touching tokens.
      const [user] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (!user) return false;
      const [used] = await tx
        .delete(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.userId, userId),
            eq(passwordResetTokens.email, normalizeEmail(user.email)),
            validResetToken(tokenHash)
          )
        )
        .returning({ id: passwordResetTokens.id });
      if (!used) return false;
      await tx
        .update(users)
        .set({ passwordHash, passwordChangedAt: new Date() })
        .where(eq(users.id, userId));
      await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
      return true;
    });
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
    if (data.email === undefined) {
      const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
      return user;
    }
    const email = normalizeEmail(data.email);
    return db.transaction(async (tx) => {
      await lockPortalInviteEmail(tx, email);
      const [current] = await tx.select().from(users).where(eq(users.id, id)).for("update");
      if (!current || normalizeEmail(current.email) === email) {
        const [user] = await tx
          .update(users)
          .set({ ...data, email })
          .where(eq(users.id, id))
          .returning();
        return user;
      }
      await assertPortalInviteEmailAvailable(tx, email);
      const [binding] = await tx
        .select({ id: customerPortalAccounts.id })
        .from(customerPortalAccounts)
        .where(and(eq(customerPortalAccounts.userId, id), isNull(customerPortalAccounts.revokedAt)))
        .limit(1);
      if (binding) {
        throw new DomainError(
          "PORTAL_ACCOUNT_EMAIL_CHANGE_BLOCKED",
          409,
          undefined,
          "Revoke the user's active portal access before changing their email"
        );
      }
      const [user] = await tx
        .update(users)
        .set({ ...data, email, emailVerified: false, emailVerifiedAt: null })
        .where(eq(users.id, id))
        .returning();
      await tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, id));
      await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, id));
      return user;
    });
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
