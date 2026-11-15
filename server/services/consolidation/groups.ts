/**
 * Company groups: membership, ownership, intercompany account maps, manual elimination
 * journals, recorded consolidation runs (W5-C: R14-18, R12-12).
 *
 * Access (binding):
 *  - VIEW a group (detail, consolidated statements, exports, runs): the caller must have access
 *    to EVERY member company (storage.hasCompanyAccess: membership, firm owner or assigned firm
 *    admin). One inaccessible member is 403 GROUP_MEMBER_ACCESS_DENIED: a consolidated statement
 *    would otherwise disclose that member's figures.
 *  - MANAGE a group (rename, members, maps, eliminations, runs): view access plus the
 *    `settings.company` permission on the parent company. Adding a member also needs
 *    `settings.company` on the member company (its own admins consent to being consolidated).
 *  - A group the caller cannot see at all (no access to the parent company) is 404.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { DomainError } from "../../errors";
import {
  accounts,
  companies,
  companyGroupMembers,
  companyGroups,
  consolidationRuns,
  eliminationJournals,
  eliminationLines,
  intercompanyAccountMaps,
  users,
  type CompanyGroup,
  type ConsolidationMethod,
  type IntercompanyMapKind,
} from "../../../shared/schema";
import { isNraFirmRole } from "../../../shared/access";
import { normalizeCompanyRole, roleHasPermission } from "../../../shared/permissions";
import { baseCurrencyOf } from "../../ledger";
import { normalizeCurrency } from "../fx";
import {
  buildConsolidatedStatements,
  loadGroupBundle,
  type ConsolidatedStatements,
} from "./engine";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Access ────────────────────────────────────────────────────────────────

async function firmRoleOf(userId: string): Promise<string | null> {
  const [u] = await db
    .select({ firmRole: users.firmRole })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.firmRole ?? null;
}

/** Company access + the permission (firm staff with access pass, like requirePermission). */
export async function hasCompanyPermission(
  userId: string,
  companyId: string,
  permission: "settings.company" | "reports.read"
): Promise<boolean> {
  const membership = await storage.getUserRole(companyId, userId);
  if (membership) return roleHasPermission(normalizeCompanyRole(membership.role), permission);
  const firm = await firmRoleOf(userId);
  if (!isNraFirmRole(firm)) return false;
  return storage.hasCompanyAccess(userId, companyId, firm);
}

export async function loadGroup(groupId: string): Promise<CompanyGroup> {
  if (!UUID_RE.test(groupId)) throw new DomainError("GROUP_NOT_FOUND", 404);
  const [g] = await db.select().from(companyGroups).where(eq(companyGroups.id, groupId)).limit(1);
  if (!g) throw new DomainError("GROUP_NOT_FOUND", 404);
  return g;
}

async function memberIds(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ companyId: companyGroupMembers.companyId })
    .from(companyGroupMembers)
    .where(eq(companyGroupMembers.groupId, groupId));
  return rows.map((r: { companyId: string }) => r.companyId);
}

/** 404 when the caller cannot see the parent; 403 when any member is inaccessible. */
export async function assertCanViewGroup(userId: string, groupId: string): Promise<CompanyGroup> {
  const group = await loadGroup(groupId);
  if (!(await storage.hasCompanyAccess(userId, group.parentCompanyId))) {
    throw new DomainError("GROUP_NOT_FOUND", 404);
  }
  const ids = await memberIds(groupId);
  const denied: string[] = [];
  for (const id of ids) {
    if (!(await storage.hasCompanyAccess(userId, id))) denied.push(id);
  }
  if (denied.length) {
    throw new DomainError(
      "GROUP_MEMBER_ACCESS_DENIED",
      403,
      { inaccessibleMembers: denied.length },
      "You need access to every company in the group to view it"
    );
  }
  return group;
}

export async function assertCanManageGroup(userId: string, groupId: string): Promise<CompanyGroup> {
  const group = await assertCanViewGroup(userId, groupId);
  if (!(await hasCompanyPermission(userId, group.parentCompanyId, "settings.company"))) {
    throw new DomainError(
      "PERMISSION_DENIED",
      403,
      { permission: "settings.company" },
      "Managing a company group needs the company settings permission on the parent company"
    );
  }
  return group;
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export async function listGroupsForUser(userId: string) {
  const mine = await storage.getCompaniesByUserId(userId);
  const companyIds = new Set<string>(mine.map((c) => c.id));
  if (!companyIds.size) return [];
  const groups = await db
    .select()
    .from(companyGroups)
    .where(inArray(companyGroups.parentCompanyId, [...companyIds]));
  const out = [];
  for (const g of groups) {
    const ids = await memberIds(g.id);
    let canView = true;
    for (const id of ids) {
      if (!(await storage.hasCompanyAccess(userId, id))) {
        canView = false;
        break;
      }
    }
    if (!canView) continue;
    out.push({ ...g, memberCount: ids.length });
  }
  return out;
}

export async function groupDetail(groupId: string) {
  const bundle = await loadGroupBundle(groupId);
  const journals = await db
    .select()
    .from(eliminationJournals)
    .where(eq(eliminationJournals.groupId, groupId));
  const jIds = journals.map((j: { id: string }) => j.id);
  const lines = jIds.length
    ? await db.select().from(eliminationLines).where(inArray(eliminationLines.journalId, jIds))
    : [];
  return {
    ...bundle.group,
    basis: "management_consolidation" as const,
    members: bundle.members.map((m) => ({
      id: m.id,
      companyId: m.companyId,
      name: m.name,
      functionalCurrency: m.baseCurrency,
      ownershipPercent: Math.round(Number(m.ownershipPercent) * 10000) / 100,
      method: m.method,
      effectiveFrom: m.effectiveFrom,
      effectiveTo: m.effectiveTo,
      isParent: m.companyId === bundle.group.parentCompanyId,
    })),
    intercompanyMaps: bundle.maps,
    eliminationJournals: journals
      .sort((a: { date: string }, b: { date: string }) =>
        String(b.date).localeCompare(String(a.date))
      )
      .map((j: (typeof journals)[number]) => ({
        ...j,
        lines: lines
          .filter((l: (typeof lines)[number]) => l.journalId === j.id)
          .map((l: (typeof lines)[number]) => ({
            ...l,
            debit: Number(l.debitMinor) / 100,
            credit: Number(l.creditMinor) / 100,
          })),
      })),
  };
}

export async function consolidatedStatements(
  groupId: string,
  range: { from: string; to: string }
): Promise<ConsolidatedStatements> {
  return buildConsolidatedStatements(await loadGroupBundle(groupId), range);
}

// ─── Writes ────────────────────────────────────────────────────────────────

export async function createGroup(args: {
  parentCompanyId: string;
  userId: string;
  name: string;
  reportingCurrency?: string;
}) {
  const [parent] = await db
    .select({ baseCurrency: companies.baseCurrency })
    .from(companies)
    .where(eq(companies.id, args.parentCompanyId));
  if (!parent) throw new DomainError("COMPANY_NOT_FOUND", 404);
  const reportingCurrency = args.reportingCurrency
    ? normalizeCurrency(args.reportingCurrency, "reportingCurrency")
    : baseCurrencyOf(parent);
  return db.transaction(async (tx: typeof db) => {
    const [group] = await tx
      .insert(companyGroups)
      .values({
        name: args.name,
        parentCompanyId: args.parentCompanyId,
        reportingCurrency,
        createdBy: args.userId,
      })
      .returning();
    await tx.insert(companyGroupMembers).values({
      groupId: group.id,
      companyId: args.parentCompanyId,
      ownershipPercent: 1,
      method: "full",
    });
    return group;
  });
}

export async function updateGroup(
  groupId: string,
  patch: { name?: string; reportingCurrency?: string }
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.reportingCurrency !== undefined) {
    set.reportingCurrency = normalizeCurrency(patch.reportingCurrency, "reportingCurrency");
  }
  const [g] = await db
    .update(companyGroups)
    .set(set)
    .where(eq(companyGroups.id, groupId))
    .returning();
  return g;
}

export async function deleteGroup(groupId: string): Promise<void> {
  await db.delete(companyGroups).where(eq(companyGroups.id, groupId));
}

const toFraction = (percent: number): number => {
  if (!(percent > 0 && percent <= 100)) {
    throw new DomainError("INVALID_OWNERSHIP", 400, { ownershipPercent: percent });
  }
  return Math.round(percent * 100) / 10000;
};

function assertDates(from?: string | null, to?: string | null) {
  if (from && to && from > to) {
    throw new DomainError("INVALID_EFFECTIVE_DATES", 400, { effectiveFrom: from, effectiveTo: to });
  }
}

export async function addMember(args: {
  group: CompanyGroup;
  userId: string;
  companyId: string;
  ownershipPercent: number;
  method: ConsolidationMethod;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}) {
  if (!(await hasCompanyPermission(args.userId, args.companyId, "settings.company"))) {
    throw new DomainError(
      "MEMBER_ACCESS_DENIED",
      403,
      { companyId: args.companyId },
      "Adding a company to a group needs the company settings permission on that company"
    );
  }
  assertDates(args.effectiveFrom, args.effectiveTo);
  const existing = await db
    .select({ id: companyGroupMembers.id })
    .from(companyGroupMembers)
    .where(
      and(
        eq(companyGroupMembers.groupId, args.group.id),
        eq(companyGroupMembers.companyId, args.companyId)
      )
    );
  if (existing.length) throw new DomainError("ALREADY_A_MEMBER", 409);
  const [row] = await db
    .insert(companyGroupMembers)
    .values({
      groupId: args.group.id,
      companyId: args.companyId,
      ownershipPercent: toFraction(args.ownershipPercent),
      method: args.method,
      effectiveFrom: args.effectiveFrom ?? null,
      effectiveTo: args.effectiveTo ?? null,
    })
    .returning();
  return row;
}

export async function updateMember(args: {
  group: CompanyGroup;
  memberId: string;
  patch: {
    ownershipPercent?: number;
    method?: ConsolidationMethod;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  };
}) {
  if (!UUID_RE.test(args.memberId)) throw new DomainError("MEMBER_NOT_FOUND", 404);
  const [cur] = await db
    .select()
    .from(companyGroupMembers)
    .where(
      and(eq(companyGroupMembers.id, args.memberId), eq(companyGroupMembers.groupId, args.group.id))
    );
  if (!cur) throw new DomainError("MEMBER_NOT_FOUND", 404);
  const set: Record<string, unknown> = {};
  if (args.patch.ownershipPercent !== undefined)
    set.ownershipPercent = toFraction(args.patch.ownershipPercent);
  if (args.patch.method !== undefined) {
    if (cur.companyId === args.group.parentCompanyId && args.patch.method !== "full") {
      throw new DomainError("PARENT_MUST_BE_CONSOLIDATED", 409);
    }
    set.method = args.patch.method;
  }
  if (args.patch.effectiveFrom !== undefined) set.effectiveFrom = args.patch.effectiveFrom;
  if (args.patch.effectiveTo !== undefined) set.effectiveTo = args.patch.effectiveTo;
  assertDates(
    (set.effectiveFrom as string | null | undefined) ?? cur.effectiveFrom,
    (set.effectiveTo as string | null | undefined) ?? cur.effectiveTo
  );
  if (!Object.keys(set).length) return cur;
  const [row] = await db
    .update(companyGroupMembers)
    .set(set)
    .where(eq(companyGroupMembers.id, cur.id))
    .returning();
  return row;
}

export async function removeMember(group: CompanyGroup, memberId: string): Promise<void> {
  if (!UUID_RE.test(memberId)) throw new DomainError("MEMBER_NOT_FOUND", 404);
  const [cur] = await db
    .select()
    .from(companyGroupMembers)
    .where(and(eq(companyGroupMembers.id, memberId), eq(companyGroupMembers.groupId, group.id)));
  if (!cur) throw new DomainError("MEMBER_NOT_FOUND", 404);
  if (cur.companyId === group.parentCompanyId) {
    throw new DomainError("PARENT_MUST_BE_CONSOLIDATED", 409);
  }
  await db.delete(companyGroupMembers).where(eq(companyGroupMembers.id, cur.id));
}

/** The account must belong to a member company of the group. */
async function assertMemberAccount(groupId: string, companyId: string, accountId: string) {
  const ids = await memberIds(groupId);
  if (!ids.includes(companyId)) {
    throw new DomainError("NOT_A_GROUP_MEMBER", 422, { companyId });
  }
  if (!UUID_RE.test(accountId)) throw new DomainError("ACCOUNT_NOT_FOUND", 404, { accountId });
  const [a] = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.companyId, companyId)));
  if (!a) throw new DomainError("ACCOUNT_NOT_FOUND", 404, { accountId, companyId });
  return a;
}

const BALANCE_TYPES = new Set(["asset", "liability"]);
const PL_TYPES = new Set(["income", "expense"]);

export async function addIntercompanyMap(args: {
  group: CompanyGroup;
  kind: IntercompanyMapKind;
  label?: string | null;
  companyAId: string;
  accountAId: string;
  companyBId: string;
  accountBId: string;
}) {
  if (args.companyAId === args.companyBId) {
    throw new DomainError("SAME_MEMBER", 422, undefined, "Map accounts of two different members");
  }
  const a = await assertMemberAccount(args.group.id, args.companyAId, args.accountAId);
  const b = await assertMemberAccount(args.group.id, args.companyBId, args.accountBId);
  const allowed = args.kind === "receivable_payable" ? BALANCE_TYPES : PL_TYPES;
  if (!allowed.has(a.type) || !allowed.has(b.type)) {
    throw new DomainError(
      "MAP_ACCOUNT_TYPE",
      422,
      { kind: args.kind, accountAType: a.type, accountBType: b.type },
      args.kind === "receivable_payable"
        ? "Balance maps pair asset/liability accounts"
        : "Transaction maps pair income/expense accounts"
    );
  }
  const [row] = await db
    .insert(intercompanyAccountMaps)
    .values({
      groupId: args.group.id,
      kind: args.kind,
      label: args.label ?? null,
      companyAId: args.companyAId,
      accountAId: args.accountAId,
      companyBId: args.companyBId,
      accountBId: args.accountBId,
    })
    .returning();
  return row;
}

export async function removeIntercompanyMap(group: CompanyGroup, mapId: string): Promise<void> {
  if (!UUID_RE.test(mapId)) throw new DomainError("MAP_NOT_FOUND", 404);
  const rows = await db
    .delete(intercompanyAccountMaps)
    .where(
      and(eq(intercompanyAccountMaps.id, mapId), eq(intercompanyAccountMaps.groupId, group.id))
    )
    .returning({ id: intercompanyAccountMaps.id });
  if (!rows.length) throw new DomainError("MAP_NOT_FOUND", 404);
}

export interface EliminationLineInput {
  companyId: string;
  accountId: string;
  debitMinor: number;
  creditMinor: number;
  description?: string | null;
}

export async function createManualElimination(args: {
  group: CompanyGroup;
  userId: string;
  date: string;
  memo?: string | null;
  lines: EliminationLineInput[];
}) {
  if (args.lines.length < 2) throw new DomainError("ELIMINATION_TOO_FEW_LINES", 422);
  let dr = 0;
  let cr = 0;
  for (const l of args.lines) {
    const oneSide = l.debitMinor > 0 !== l.creditMinor > 0;
    if (!oneSide || l.debitMinor < 0 || l.creditMinor < 0) {
      throw new DomainError(
        "LINE_HAS_BOTH_SIDES",
        422,
        undefined,
        "Each line needs exactly one side"
      );
    }
    dr += l.debitMinor;
    cr += l.creditMinor;
    await assertMemberAccount(args.group.id, l.companyId, l.accountId);
  }
  if (dr !== cr) {
    throw new DomainError("ELIMINATION_UNBALANCED", 422, {
      debit: dr / 100,
      credit: cr / 100,
    });
  }
  return db.transaction(async (tx: typeof db) => {
    const [j] = await tx
      .insert(eliminationJournals)
      .values({
        groupId: args.group.id,
        kind: "manual",
        date: args.date,
        memo: args.memo ?? null,
        createdBy: args.userId,
      })
      .returning();
    await tx.insert(eliminationLines).values(
      args.lines.map((l) => ({
        journalId: j.id,
        companyId: l.companyId,
        accountId: l.accountId,
        debitMinor: l.debitMinor,
        creditMinor: l.creditMinor,
        description: l.description ?? null,
      }))
    );
    return j;
  });
}

export async function voidElimination(group: CompanyGroup, journalId: string, userId: string) {
  if (!UUID_RE.test(journalId)) throw new DomainError("ELIMINATION_NOT_FOUND", 404);
  const rows = await db
    .update(eliminationJournals)
    .set({ status: "void", voidedBy: userId, voidedAt: new Date() })
    .where(
      and(
        eq(eliminationJournals.id, journalId),
        eq(eliminationJournals.groupId, group.id),
        eq(eliminationJournals.status, "posted")
      )
    )
    .returning();
  if (!rows.length) throw new DomainError("ELIMINATION_NOT_FOUND", 404);
  return rows[0];
}

/**
 * Record a run: the full output is stored as the audit snapshot and the rule-generated
 * eliminations are written as `rule` journals tied to the run (for the record only — the
 * statements always recompute rules live, so they are never double counted).
 */
export async function recordConsolidationRun(args: {
  group: CompanyGroup;
  userId: string;
  from: string;
  to: string;
}) {
  const statements = await consolidatedStatements(args.group.id, { from: args.from, to: args.to });
  return db.transaction(async (tx: typeof db) => {
    const [run] = await tx
      .insert(consolidationRuns)
      .values({
        groupId: args.group.id,
        periodFrom: args.from,
        periodTo: args.to,
        reportingCurrency: statements.group.reportingCurrency,
        snapshot: statements,
        createdBy: args.userId,
      })
      .returning();
    for (const e of statements.eliminations) {
      if (e.kind !== "rule" || !e.lines.length) continue;
      const [j] = await tx
        .insert(eliminationJournals)
        .values({
          groupId: args.group.id,
          kind: "rule",
          runId: run.id,
          date: args.to,
          memo: e.label,
          createdBy: args.userId,
        })
        .returning();
      await tx.insert(eliminationLines).values(
        e.lines.map((l) => ({
          journalId: j.id,
          companyId: l.companyId,
          accountId: l.accountId,
          debitMinor: Math.round(l.debit * 100),
          creditMinor: Math.round(l.credit * 100),
          description: l.description,
        }))
      );
    }
    return { run, statements };
  });
}

export async function listRuns(groupId: string) {
  const rows = await db
    .select({
      id: consolidationRuns.id,
      periodFrom: consolidationRuns.periodFrom,
      periodTo: consolidationRuns.periodTo,
      reportingCurrency: consolidationRuns.reportingCurrency,
      createdBy: consolidationRuns.createdBy,
      createdAt: consolidationRuns.createdAt,
    })
    .from(consolidationRuns)
    .where(eq(consolidationRuns.groupId, groupId));
  return rows.sort(
    (a: { createdAt: Date }, b: { createdAt: Date }) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
