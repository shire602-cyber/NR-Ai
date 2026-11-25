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

// ── WQ3 (9.1 / 9.3): the account drawer and the level toggles ──────────────

/** First digit of a default-chart code for each account type. */
const TYPE_DIGIT: Record<string, string> = {
  asset: "1",
  liability: "2",
  equity: "3",
  income: "4",
  expense: "5",
};

/**
 * A free code for a new account: the next number after the parent and its existing children
 * (5090 -> 5091, or past the last child), or after the highest four-digit code of the type when
 * there is no parent (expense -> 5201 when 5200 is the last). Never a taken code; "" when nothing
 * numeric can be suggested (the user types one).
 */
export function suggestAccountCode(
  accounts: Array<Pick<HierarchyAccount, "id" | "code" | "type" | "parentId">>,
  opts: { type: string; parentId?: string | null }
): string {
  const taken = new Set(accounts.map((a) => a.code.toLowerCase()));
  const numeric = (c: string) => (/^\d{1,9}$/.test(c) ? Number(c) : null);
  let start: number | null = null;
  if (opts.parentId) {
    const parent = accounts.find((a) => a.id === opts.parentId);
    const p = parent ? numeric(parent.code) : null;
    if (p !== null) {
      const kids = accounts
        .filter((a) => a.parentId === opts.parentId)
        .map((a) => numeric(a.code))
        .filter((n): n is number => n !== null);
      start = Math.max(p, ...kids) + 1;
    }
  }
  if (start === null) {
    const digit = TYPE_DIGIT[opts.type];
    if (!digit) return "";
    const same = accounts
      .map((a) => a.code)
      .filter((c) => c.startsWith(digit) && c.length === 4)
      .map(numeric)
      .filter((n): n is number => n !== null);
    start = same.length ? Math.max(...same) + 1 : Number(`${digit}000`) + 10;
  }
  let n = start;
  while (taken.has(String(n))) n += 1;
  return String(n);
}

/** Ids of control accounts, by their own code / VAT flag or through a control parent. */
function controlChain(all: RoleAccount[]): Set<string> {
  const byId = new Map(all.map((a) => [a.id, a]));
  const out = new Set<string>();
  for (const a of all) {
    const seen = new Set<string>();
    let cur: RoleAccount | undefined = a;
    while (cur && !seen.has(cur.id)) {
      if (ownControl(cur)) {
        out.add(a.id);
        break;
      }
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return out;
}

/**
 * Parent choices in the drawer: same type, not archived, never a control account (C1: the
 * server refuses one with 422 CONTROL_ACCOUNT_NOT_ALLOWED) and, when editing, never the account
 * itself or one of its descendants.
 */
export function drawerParentCandidates<T extends RoleAccount>(
  accounts: T[],
  type: string,
  selfId?: string | null
): T[] {
  const control = controlChain(accounts);
  const blocked = selfId ? descendantIds(accounts, selfId) : new Set<string>();
  return accounts
    .filter((a) => a.type === type && !a.isArchived && !control.has(a.id) && !blocked.has(a.id))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/**
 * D2 (N8) mirror for the drawer: a system account, a VAT account or a control account (own code
 * or through its parent) keeps its code, type and sub-type; the server answers 422
 * CONTROL_ACCOUNT_LOCKED otherwise.
 */
export function roleLocked(
  account: RoleAccount & { isSystemAccount?: boolean | null },
  all: RoleAccount[]
): boolean {
  return (
    account.isSystemAccount === true ||
    account.isVatAccount === true ||
    controlChain(all).has(account.id)
  );
}

export interface FigureTotals {
  debitTotal: number;
  creditTotal: number;
  balance: number;
}

/**
 * Subtree totals: each account's own figures plus all of its descendants', so a parent row
 * shows the rolled-up balance when its children are collapsed by the level toggle.
 */
export function rollUpTotals<T extends FigureTotals>(
  items: T[],
  accountOf: (item: T) => Pick<HierarchyAccount, "id" | "parentId">
): Map<string, FigureTotals> {
  const byId = new Map(items.map((i) => [accountOf(i).id, i]));
  const out = new Map<string, FigureTotals>();
  for (const item of items) {
    const seen = new Set<string>();
    let cur: T | undefined = item;
    while (cur && !seen.has(accountOf(cur).id)) {
      const id = accountOf(cur).id;
      seen.add(id);
      const acc = out.get(id) ?? { debitTotal: 0, creditTotal: 0, balance: 0 };
      acc.debitTotal += item.debitTotal;
      acc.creditTotal += item.creditTotal;
      acc.balance += item.balance;
      out.set(id, acc);
      const parentId: string | null | undefined = accountOf(cur).parentId;
      cur = parentId ? byId.get(parentId) : undefined;
    }
  }
  return out;
}

/** Ids of the accounts that have at least one child. */
export function parentIds(accounts: Array<Pick<HierarchyAccount, "parentId">>): Set<string> {
  return new Set(accounts.map((a) => a.parentId).filter((v): v is string => !!v));
}
