/**
 * Input-VAT recoverability (W4-E, R05-28). Some purchases carry VAT that the buyer may not
 * recover (Executive Regulations Art. 53): entertainment for non-employees, motor vehicles
 * available for personal use, and anything else the company configures. The non-recoverable
 * part is added to the expense instead of Input VAT, at receipt and bill posting.
 *
 * Built-in defaults (overridable by a company rule on the same category / account):
 *   entertainment            0%
 *   motor vehicle (personal) 0%
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { DomainError } from "../errors";

export interface RecoveryRule {
  matchType: "category" | "account_code" | "account_id";
  matchValue: string;
  recoverablePercent: number;
  label: string;
  builtIn?: boolean;
}

export const DEFAULT_RECOVERY_RULES: readonly RecoveryRule[] = [
  {
    matchType: "category",
    matchValue: "entertainment",
    recoverablePercent: 0,
    label: "Entertainment: input VAT blocked (Art. 53)",
    builtIn: true,
  },
  {
    matchType: "category",
    matchValue: "motor vehicle personal",
    recoverablePercent: 0,
    label: "Motor vehicle for personal use: input VAT blocked (Art. 53)",
    builtIn: true,
  },
];

const norm = (s: string | null | undefined) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();

/** Built-in keyword match on a category or account name. */
function builtInMatch(text: string): RecoveryRule | null {
  const t = norm(text);
  if (!t) return null;
  if (/\bentertain/.test(t) || /ضياف|ترفيه/.test(t)) return DEFAULT_RECOVERY_RULES[0];
  if (/(motor|personal|private)\s*(vehicle|car)|vehicle.*personal|car.*personal/.test(t))
    return DEFAULT_RECOVERY_RULES[1];
  return null;
}

/**
 * Resolve the recoverable percentage for one purchase component. Company rules win (exact match
 * on account id, then account code, then category), then built-in keyword defaults, else 100%.
 */
export function resolveRecovery(
  component: {
    category?: string | null;
    accountId?: string | null;
    accountCode?: string | null;
    accountName?: string | null;
  },
  companyRules: readonly RecoveryRule[]
): { percent: number; label: string | null } {
  const byType = (t: RecoveryRule["matchType"], v: string | null | undefined) =>
    v ? companyRules.find((r) => r.matchType === t && norm(r.matchValue) === norm(v)) : undefined;
  const rule =
    byType("account_id", component.accountId) ??
    byType("account_code", component.accountCode) ??
    byType("category", component.category) ??
    builtInMatch(component.category ?? "") ??
    builtInMatch(component.accountName ?? "");
  if (!rule) return { percent: 100, label: null };
  return { percent: Number(rule.recoverablePercent), label: rule.label };
}

export async function loadRecoveryRules(companyId: string): Promise<RecoveryRule[]> {
  try {
    const { rows } = await pool.query(
      `SELECT match_type, match_value, recoverable_percent, label
         FROM vat_recovery_rules WHERE company_id = $1`,
      [companyId]
    );
    return rows.map(
      (r: {
        match_type: RecoveryRule["matchType"];
        match_value: string;
        recoverable_percent: string;
        label: string;
      }) => ({
        matchType: r.match_type,
        matchValue: r.match_value,
        recoverablePercent: Number(r.recoverable_percent),
        label: r.label,
      })
    );
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return [];
    throw err;
  }
}

export async function upsertRecoveryRule(
  companyId: string,
  userId: string,
  rule: Omit<RecoveryRule, "builtIn">
) {
  if (!(rule.recoverablePercent >= 0 && rule.recoverablePercent <= 100)) {
    throw new DomainError("INVALID_PERCENT", 422, undefined, "Recoverable percent must be 0-100");
  }
  const { rows } = await pool.query(
    `INSERT INTO vat_recovery_rules (company_id, match_type, match_value, recoverable_percent, label, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (company_id, match_type, lower(match_value))
     DO UPDATE SET recoverable_percent = EXCLUDED.recoverable_percent, label = EXCLUDED.label
     RETURNING id, match_type, match_value, recoverable_percent, label`,
    [companyId, rule.matchType, rule.matchValue, rule.recoverablePercent, rule.label, userId]
  );
  return rows[0];
}

export async function deleteRecoveryRule(companyId: string, id: string) {
  const { rowCount } = await pool.query(
    `DELETE FROM vat_recovery_rules WHERE company_id = $1 AND id = $2`,
    [companyId, id]
  );
  if (!rowCount) throw new DomainError("VAT_RECOVERY_RULE_NOT_FOUND", 404);
  return { id };
}

export interface ReceiptVatTreatment {
  receiptId: string;
  companyId: string;
  supplyType: string;
  vatBaseFils: number;
  recoverableVatFils: number;
  nonRecoverableVatFils: number;
  netBaseFils: number;
  ruleLabel: string | null;
  lines: Array<{
    accountId: string;
    supplyType: string;
    netBaseFils: number;
    vatBaseFils: number;
    recoverableFils: number;
    percent: number;
    rule: string | null;
  }>;
}

/** Persist how a posted receipt's VAT was treated; the VAT engine reads it for Box 9/10. */
export async function saveReceiptVatTreatment(t: ReceiptVatTreatment, tx = db): Promise<void> {
  const f = (n: number) => (n / 100).toFixed(2);
  await tx.execute(sql`INSERT INTO receipt_vat_treatments
       (receipt_id, company_id, supply_type, vat_base, recoverable_vat, non_recoverable_vat, net_base, rule_label, lines)
     VALUES (${t.receiptId},${t.companyId},${t.supplyType},${f(t.vatBaseFils)},${f(t.recoverableVatFils)},
             ${f(t.nonRecoverableVatFils)},${f(t.netBaseFils)},${t.ruleLabel},${JSON.stringify(t.lines)}::jsonb)
     ON CONFLICT (receipt_id) DO UPDATE SET
       supply_type = EXCLUDED.supply_type, vat_base = EXCLUDED.vat_base,
       recoverable_vat = EXCLUDED.recoverable_vat, non_recoverable_vat = EXCLUDED.non_recoverable_vat,
       net_base = EXCLUDED.net_base, rule_label = EXCLUDED.rule_label, lines = EXCLUDED.lines,
       updated_at = now()`);
}
