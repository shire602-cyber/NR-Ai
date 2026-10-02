// Unrealised exchange differences (bank and open-document revaluations) go to their own income account, so the P&L and the
// corporate-tax add-backs can tell them from the realised ones in 4090 / 5140. One account carries both signs: a credit is an
// unrealised gain, a debit an unrealised loss. It is created when the first revaluation needs it (4095, or the next free
// 40xx code when 4095 is taken by something else).

import { storage } from "../storage";
import { ACCOUNT_CODES } from "../constants";

export const UNREALISED_FX_NAME_EN = "Unrealised Exchange Gain/(Loss)";

export async function ensureUnrealisedFxAccount(companyId: string): Promise<string> {
  const accounts = await storage.getAccountsByCompanyId(companyId);
  const existing = accounts.find((a) => a.type === "income" && a.isActive !== false && (a.nameEn === UNREALISED_FX_NAME_EN || (a.code === ACCOUNT_CODES.FX_UNREALISED && a.isSystemAccount)));
  if (existing) return existing.id;
  const taken = new Set(accounts.map((a) => a.code));
  let code = Number(ACCOUNT_CODES.FX_UNREALISED);
  while (taken.has(String(code))) code++;
  const created = await storage.createAccount({
    companyId,
    code: String(code),
    nameEn: UNREALISED_FX_NAME_EN,
    nameAr: "أرباح (خسائر) فروق العملة غير المحققة",
    description: "Unrealised exchange differences from revaluing foreign-currency bank balances and open invoices and bills; reversed the next day",
    type: "income",
    subType: null,
    isVatAccount: false,
    vatType: null,
    isSystemAccount: true,
  } as any);
  return created.id;
}
