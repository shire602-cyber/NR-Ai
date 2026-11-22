// DatabaseStorage part: Companies, company users, team management and company access.
// Domain classes are chained with `extends` and composed into DatabaseStorage in
// server/storage.ts (R20-09); import `storage` from "./storage", not these classes.

import {
  companies,
  companyUsers,
  journalEntries,
  users,
  type Company,
  type CompanyUser,
  type InsertCompany,
  type InsertCompanyUser,
} from "@shared/schema";
import {
  NR_FIRM_ID,
  accessibleClientCondition,
  canAccessFirmClient,
  hasFirmCreatedCompanyMembership,
  reconcileCompanyMembershipOrigin,
  type FirmContext,
} from "../services/firm/scope";
import { db, type AppDatabase } from "../db";
import { DomainError } from "../errors";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { isScopedIdPair, scopedGet } from "../tenancy";
import { UserStorage } from "./users";
import type { CompanyMemberWithUser } from "./types";

const companyMemberUserColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  userType: users.userType,
  avatarUrl: users.avatarUrl,
  emailVerified: users.emailVerified,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

/** users.user_type of a customer-portal login (never a company member). */
const PORTAL_USER_TYPE = "client_portal";

export class CompanyStorage extends UserStorage {
  // Companies
  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.id, id), isNull(companies.deletedAt)));
    return company || undefined;
  }

  async ownerHasCompanyNamed(
    userId: string,
    name: string,
    excludeCompanyId?: string
  ): Promise<boolean> {
    // Company names are unique per owner (case-insensitive), never across tenants (R14-09).
    const rows = await db
      .select({ id: companies.id })
      .from(companies)
      .innerJoin(companyUsers, eq(companyUsers.companyId, companies.id))
      .where(
        and(
          eq(companyUsers.userId, userId),
          eq(companyUsers.role, "owner"),
          isNull(companies.deletedAt),
          sql`lower(btrim(${companies.name})) = lower(btrim(${name}))`,
          excludeCompanyId ? sql`${companies.id} <> ${excludeCompanyId}` : sql`true`
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async companyHasPostedJournal(companyId: string): Promise<boolean> {
    const rows = await db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted")))
      .limit(1);
    return rows.length > 0;
  }

  async getCompanyByName(name: string): Promise<Company | undefined> {
    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.name, name), isNull(companies.deletedAt)));
    return company || undefined;
  }

  async getCompaniesByUserId(userId: string): Promise<Company[]> {
    const results = await db
      .select()
      .from(companies)
      .innerJoin(companyUsers, eq(companies.id, companyUsers.companyId))
      .innerJoin(users, eq(users.id, companyUsers.userId))
      .where(
        and(
          eq(companyUsers.userId, userId),
          isNull(companies.deletedAt),
          // Portal customers are never company members (see PORTAL_USER_TYPE).
          ne(users.userType, PORTAL_USER_TYPE)
        )
      );

    return results.map((r) => r.companies);
  }

  /** The user's membership role per company id (direct memberships only). */
  async getCompanyRolesByUserId(userId: string): Promise<Record<string, string>> {
    const rows = await db
      .select({ companyId: companyUsers.companyId, role: companyUsers.role })
      .from(companyUsers)
      .innerJoin(users, eq(users.id, companyUsers.userId))
      .where(and(eq(companyUsers.userId, userId), ne(users.userType, PORTAL_USER_TYPE)));
    const out: Record<string, string> = {};
    for (const r of rows) out[r.companyId] = r.role;
    return out;
  }

  async createCompany(
    insertCompany: InsertCompany,
    conn: Pick<AppDatabase, "insert"> = db
  ): Promise<Company> {
    const [company] = await conn.insert(companies).values(insertCompany).returning();
    return company;
  }

  async updateCompany(id: string, data: Partial<InsertCompany>): Promise<Company> {
    const [company] = await db.update(companies).set(data).where(eq(companies.id, id)).returning();
    return company;
  }

  // Company Users
  async createCompanyUser(insertCompanyUser: InsertCompanyUser): Promise<CompanyUser> {
    const [companyUser] = await db.insert(companyUsers).values(insertCompanyUser).returning();
    return companyUser;
  }

  async getUserRole(companyId: string, userId: string): Promise<CompanyUser | undefined> {
    // A `client_portal` user is a customer, never a member: a stray company_users row grants
    // nothing. This is the single choke point for hasCompanyAccess and the RBAC role lookup.
    const [row] = await db
      .select({ companyUser: companyUsers })
      .from(companyUsers)
      .innerJoin(users, eq(users.id, companyUsers.userId))
      .where(
        and(
          eq(companyUsers.companyId, companyId),
          eq(companyUsers.userId, userId),
          ne(users.userType, PORTAL_USER_TYPE)
        )
      );
    return row?.companyUser || undefined;
  }

  /**
   * Resolve a valid actor user id for a company — used wherever a system /
   * automated action (AI auto-post, scheduled jobs) must satisfy a created_by
   * FK. Firm-client companies have no company_users rows, so a bare
   * role='owner' lookup returns nothing; fall back to any member, then to a
   * firm owner who has access to all client companies.
   */
  async resolveCompanyActorUserId(companyId: string): Promise<string | null> {
    const [owner] = await db
      .select({ userId: companyUsers.userId })
      .from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.role, "owner")))
      .limit(1);
    if (owner?.userId) return owner.userId;

    const [anyMember] = await db
      .select({ userId: companyUsers.userId })
      .from(companyUsers)
      .where(eq(companyUsers.companyId, companyId))
      .limit(1);
    if (anyMember?.userId) return anyMember.userId;

    // Firm-client company: any firm owner can act for it.
    const company = await this.getCompany(companyId);
    if (company?.companyType === "client") {
      const [firmOwner] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.firmRole, "firm_owner"))
        .limit(1);
      if (firmOwner?.id) return firmOwner.id;
    }
    return null;
  }

  async hasCompanyAccess(
    userId: string,
    companyId: string,
    firmRole?: string | null
  ): Promise<boolean> {
    // Direct company_users membership (includes firm grants, W5-D).
    if (await this.getUserRole(companyId, userId)) return true;

    // Look up firm role if caller didn't pass it. This makes all existing
    // call sites firm-aware without per-route changes.
    let role: string | null = firmRole ?? null;
    if (firmRole === undefined) {
      const [u] = await db
        .select({ firmRole: users.firmRole })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      role = u?.firmRole ?? null;
    }

    // Legacy NR bypass roles only; preparer / reviewer / viewer and staff of
    // other firms reach client books through company_users grants.
    if (role !== "firm_owner" && role !== "firm_admin") return false;

    // firm_owner: any client of the NR firm. firm_admin: assigned NR clients.
    // A revoked link or another firm's client is never reachable (R15-12).
    return canAccessFirmClient(
      { firmId: NR_FIRM_ID, isNr: true, role, userId, platformAdmin: false },
      companyId
    );
  }

  async getAccessibleCompanies(
    userId: string,
    firmRole?: string | null,
    isAdmin = false
  ): Promise<Company[]> {
    const direct = await this.getCompaniesByUserId(userId);

    if (!isAdmin && firmRole !== "firm_owner" && firmRole !== "firm_admin") {
      return direct;
    }

    // Add firm-accessible client companies (not already in direct list).
    const directIds = new Set(direct.map((c) => c.id));

    const ctx: FirmContext =
      firmRole === "firm_owner" || firmRole === "firm_admin"
        ? { firmId: NR_FIRM_ID, isNr: true, role: firmRole, userId, platformAdmin: false }
        : { firmId: NR_FIRM_ID, isNr: true, role: "firm_owner", userId, platformAdmin: true };
    const firmCompanies: Company[] = await db
      .select()
      .from(companies)
      .where(accessibleClientCondition(ctx));

    const merged = [...direct];
    for (const c of firmCompanies) {
      if (!directIds.has(c.id)) merged.push(c);
    }
    return merged;
  }

  async getCompanyUsersByCompanyId(companyId: string): Promise<CompanyUser[]> {
    return await db.select().from(companyUsers).where(eq(companyUsers.companyId, companyId));
  }

  // Team Management
  // R01-01: membership writes are always scoped by (membership id, company id);
  // a membership of another company is "not found".
  async updateCompanyUser(
    companyId: string,
    id: string,
    data: Pick<Partial<InsertCompanyUser>, "role">,
    tx?: Pick<AppDatabase, "select" | "update">
  ): Promise<CompanyUser | undefined> {
    if (!isScopedIdPair(companyId, id)) return undefined;
    if (data.role === undefined) return scopedGet(companyUsers, companyId, id);
    if (!tx) return db.transaction((conn) => this.updateCompanyUser(companyId, id, data, conn));
    const scope = and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id));
    const [member] = await tx
      .select({ userId: companyUsers.userId })
      .from(companyUsers)
      .where(scope);
    if (!member) return undefined;
    await tx.select({ id: users.id }).from(users).where(eq(users.id, member.userId)).for("update");
    await reconcileCompanyMembershipOrigin(companyId, member.userId, tx);
    if (
      data.role === "owner" &&
      (await hasFirmCreatedCompanyMembership(companyId, member.userId, tx))
    ) {
      throw new DomainError("ROLE_NOT_GRANTABLE", 403);
    }
    const [updated] = await tx.update(companyUsers).set(data).where(scope).returning();
    return updated;
  }

  async deleteCompanyUser(
    companyId: string,
    id: string,
    tx?: Pick<AppDatabase, "select" | "delete">
  ): Promise<boolean> {
    if (!isScopedIdPair(companyId, id)) return false;
    if (!tx) return db.transaction((conn) => this.deleteCompanyUser(companyId, id, conn));
    const scope = and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id));
    const [member] = await tx
      .select({ userId: companyUsers.userId })
      .from(companyUsers)
      .where(scope);
    if (!member) return false;
    await tx.select({ id: users.id }).from(users).where(eq(users.id, member.userId)).for("update");
    const [removed] = await tx.delete(companyUsers).where(scope).returning({ id: companyUsers.id });
    return !!removed;
  }

  async getCompanyUser(companyId: string, id: string): Promise<CompanyUser | undefined> {
    return scopedGet(companyUsers, companyId, id);
  }

  // PR-62 port: the joined user is a PUBLIC projection. Firm and admin client screens send
  // this list straight to the browser, so password_hash, token_version and the MFA flags
  // must never be selected here.
  async getCompanyUserWithUser(companyId: string): Promise<CompanyMemberWithUser[]> {
    const results = await db
      .select({ member: companyUsers, user: companyMemberUserColumns })
      .from(companyUsers)
      .innerJoin(users, eq(companyUsers.userId, users.id))
      .where(eq(companyUsers.companyId, companyId));

    return results.map((r) => ({ ...r.member, user: r.user }));
  }

  // Admin Company Management
  async deleteCompany(id: string): Promise<void> {
    await db
      .update(companies)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(companies.id, id));
  }
}
