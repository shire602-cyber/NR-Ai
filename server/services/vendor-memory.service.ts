// Vendor-to-account memory keyed by supplier TRN (R05-24). A TRN identifies a supplier far
// more reliably than a (possibly Arabic or OCR-garbled) merchant name, so once a user
// accepts an account for a TRN the classifier reuses it. Stored as an ai_company_rules row
// whose merchant_pattern is "trn:<15 digits>" - no schema change needed.

import { validateUaeTrn } from "../../shared/receipt-ocr-parser";
import { createLogger } from "../config/logger";
import type { CompanyRuleSnapshot } from "./receipt-classifier.service";

const log = createLogger("vendor-memory");

export function trnRulePattern(trn: string): string | null {
  const check = validateUaeTrn(trn);
  return check.valid ? `trn:${check.trn}` : null;
}

/** Pure lookup used by the classifier: a remembered rule for this supplier TRN, if any. */
export function findTrnRule(
  trn: string | null | undefined,
  rules: CompanyRuleSnapshot[]
): CompanyRuleSnapshot | null {
  if (!trn) return null;
  const pattern = trnRulePattern(trn);
  if (!pattern) return null;
  return (
    rules.find(
      (r) => r.merchantPattern?.toLowerCase() === pattern && r.confidence >= 0.7 && r.accountId
    ) ?? null
  );
}

export interface VendorMemoryDeps {
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, any>> }>;
}

async function defaultDeps(): Promise<VendorMemoryDeps> {
  const { pool } = await import("../db");
  return { query: (sql, params) => (pool as any).query(sql, params) };
}

/** Remember (or reinforce) the account a user accepted for a supplier TRN. */
export async function rememberVendorAccount(
  companyId: string,
  trn: string | null | undefined,
  accountId: string | null | undefined,
  deps?: VendorMemoryDeps
): Promise<boolean> {
  const pattern = trn ? trnRulePattern(trn) : null;
  if (!pattern || !accountId) return false;
  try {
    const db = deps ?? (await defaultDeps());
    const existing = await db.query(
      `SELECT id FROM ai_company_rules
        WHERE company_id = $1 AND merchant_pattern = $2 AND account_id = $3 LIMIT 1`,
      [companyId, pattern, accountId]
    );
    if (existing.rows[0]) {
      await db.query(
        `UPDATE ai_company_rules
            SET times_accepted = times_accepted + 1, times_applied = times_applied + 1,
                confidence = LEAST(0.99, confidence + 0.02), is_active = true, updated_at = now()
          WHERE id = $1`,
        [existing.rows[0].id]
      );
    } else {
      // A different account for the same TRN supersedes the old memory.
      await db.query(
        `UPDATE ai_company_rules SET is_active = false, updated_at = now()
          WHERE company_id = $1 AND merchant_pattern = $2`,
        [companyId, pattern]
      );
      await db.query(
        `INSERT INTO ai_company_rules
           (company_id, merchant_pattern, account_id, times_applied, times_accepted, confidence)
         VALUES ($1, $2, $3, 4, 1, 0.9)`,
        [companyId, pattern, accountId]
      );
    }
    return true;
  } catch (err) {
    log.warn({ err: (err as Error).message }, "Could not remember vendor account (non-fatal)");
    return false;
  }
}
