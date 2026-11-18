/**
 * C1 (RH1 / RM1 / RL1): account pickers for user-chosen fields (a bill line's account, a rule's
 * contra account, a receipt line, a fixed asset's cost account) leave out the control accounts.
 * A control account (receivables 1040, payables 2010, inventory 1070, input / output VAT, goods
 * received not invoiced 2015, payroll payables 2030-2036, or a sub-account of one) is posted only
 * by its own module; the server refuses it with 422 CONTROL_ACCOUNT_NOT_ALLOWED.
 * Mirrors server/ledger/control-accounts.ts (code chain plus the input / output VAT flag).
 */
import { CONTROL_ACCOUNT_CODES } from "@shared/control-accounts";

export interface PickableAccount {
  id: string;
  code?: string | null;
  parentId?: string | null;
  isVatAccount?: boolean | null;
  vatType?: string | null;
}

function ownControl(a: PickableAccount): boolean {
  if (a.code && CONTROL_ACCOUNT_CODES[a.code]) return true;
  return a.isVatAccount === true && (a.vatType === "input" || a.vatType === "output");
}

/** Ids of the control accounts in `accounts` (a sub-account of a control account included). */
export function controlAccountIds(accounts: readonly PickableAccount[]): Set<string> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out = new Set<string>();
  for (const a of accounts) {
    let cur: PickableAccount | undefined = a;
    for (let depth = 0; cur && depth < 9; depth++) {
      if (ownControl(cur)) {
        out.add(a.id);
        break;
      }
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return out;
}

/** `accounts` without the control accounts, for a picker of a user-chosen account field. */
export function withoutControlAccounts<T extends PickableAccount>(accounts: readonly T[]): T[] {
  const control = controlAccountIds(accounts);
  return accounts.filter((a) => !control.has(a.id));
}

export interface PurchaseLineAccount extends PickableAccount {
  type?: string | null;
  subType?: string | null;
  nameEn?: string | null;
  isActive?: boolean | null;
  isArchived?: boolean | null;
}

/**
 * E3 (J1-r3): the accounts a bill or expense line can be booked to, grouped for the picker.
 * Expenses first; fixed assets stay for capital purchases (equipment), other assets (prepaid
 * expenses) last. Left out: control accounts, cash and bank (money leaves through the payment,
 * not the line), receivables, accumulated depreciation (a contra account the depreciation run
 * posts) and header accounts that have sub-accounts.
 */
export function purchaseLineAccountGroups<T extends PurchaseLineAccount>(
  accounts: readonly T[]
): { expenses: T[]; fixedAssets: T[]; otherAssets: T[] } {
  const parents = new Set(accounts.map((a) => a.parentId).filter(Boolean));
  const usable = withoutControlAccounts(accounts).filter(
    (a) => a.isActive !== false && a.isArchived !== true && !parents.has(a.id)
  );
  const byCode = (x: T, y: T) => String(x.code ?? "").localeCompare(String(y.code ?? ""));
  const isAsset = (a: T) => a.type === "asset";
  const excludedAsset = (a: T) =>
    a.subType === "cash" ||
    a.subType === "bank" ||
    a.subType === "receivable" ||
    a.subType === "inventory" ||
    a.code === "1240" ||
    /accumulated/i.test(a.nameEn ?? "");
  return {
    expenses: usable.filter((a) => !a.type || a.type === "expense").sort(byCode),
    fixedAssets: usable
      .filter((a) => isAsset(a) && a.subType === "fixed_asset" && !excludedAsset(a))
      .sort(byCode),
    otherAssets: usable
      .filter((a) => isAsset(a) && a.subType !== "fixed_asset" && !excludedAsset(a))
      .sort(byCode),
  };
}
