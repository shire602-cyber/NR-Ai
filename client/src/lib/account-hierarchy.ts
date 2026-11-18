/**
 * Chart-of-accounts hierarchy helpers (W2-D R02-16c display; S5 parent selection).
 *
 * Pure so they can be unit tested; the server enforces the same rules in
 * server/routes/accounts.routes.ts (assertValidParent: same company, same type, no cycle).
 */
import { CONTROL_ACCOUNT_CODES } from "@shared/control-accounts";

export interface HierarchyAccount {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  type: string;
  parentId?: string | null;
  isArchived?: boolean | null;
}

/**
 * Depth-first order for a flat list using `parentId`. A child follows its parent and gets
 * `depth`; a child whose parent is filtered out (or missing) is shown at the top level. A
 * cycle guard keeps bad data from looping; unreachable rows are appended flat, never dropped.
 */
export function orderByHierarchy<T>(
  items: T[],
  accountOf: (item: T) => Pick<HierarchyAccount, "id" | "parentId">
): Array<T & { depth: number }> {
  const ids = new Set(items.map((i) => accountOf(i).id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const item of items) {
    const { id, parentId } = accountOf(item);
    if (parentId && ids.has(parentId) && parentId !== id) {
      const list = children.get(parentId) ?? [];
      list.push(item);
      children.set(parentId, list);
    } else {
      roots.push(item);
    }
  }
  const out: Array<T & { depth: number }> = [];
  const seen = new Set<string>();
  const visit = (item: T, depth: number) => {
    const id = accountOf(item).id;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ ...item, depth });
    for (const child of children.get(id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  for (const item of items) visit(item, 0);
  return out;
}

/** Ids of `accountId` and every account below it (a parent may not be one of these). */
export function descendantIds(accounts: HierarchyAccount[], accountId: string): Set<string> {
  const out = new Set<string>([accountId]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const a of accounts) {
      if (a.parentId && out.has(a.parentId) && !out.has(a.id)) {
        out.add(a.id);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * Accounts that may become the parent of `accountId`: same type, not archived, not the
 * account itself and not one of its descendants. Sorted by code.
 */
export function parentCandidates(
  accounts: HierarchyAccount[],
  accountId: string
): HierarchyAccount[] {
  const self = accounts.find((a) => a.id === accountId);
  if (!self) return [];
  const blocked = descendantIds(accounts, accountId);
  return accounts
    .filter((a) => a.type === self.type && !a.isArchived && !blocked.has(a.id))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/** True when the account is a control account by its own code or input / output VAT flag. */
function ownControl(a: {
  code: string;
  isVatAccount?: boolean | null;
  vatType?: string | null;
}): boolean {
  return (
    !!CONTROL_ACCOUNT_CODES[a.code] ||
    (a.isVatAccount === true && (a.vatType === "input" || a.vatType === "output"))
  );
}

type RoleAccount = HierarchyAccount & { isVatAccount?: boolean | null; vatType?: string | null };

/**
 * D2 (N8): a sub-account that is a control account only through a control parent keeps that
 * parent (moving it out would let manual journals reach the sub-ledger's GL). Mirrors the server
 * rule in server/routes/accounts.routes.ts (assertAccountRoleUnchanged).
 */
export function parentLocked(account: RoleAccount, all: RoleAccount[]): boolean {
  if (ownControl(account)) return false;
  const byId = new Map(all.map((a) => [a.id, a]));
  const seen = new Set<string>([account.id]);
  let cur = account.parentId ? byId.get(account.parentId) : undefined;
  while (cur && !seen.has(cur.id)) {
    if (ownControl(cur)) return true;
    seen.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}
