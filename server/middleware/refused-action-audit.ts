/**
 * Refused attempts are evidence too: a 403 or 409 on a route that moves money, posts to the ledger or
 * files a return is written to the audit trail (who tried what, and why it was refused). One row per
 * refusal, company-scoped where the company can be told, throttled per user so a refusal flood cannot
 * become a write flood.
 */
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db";
import { createLogger } from "../config/logger";
import { recordAudit } from "../services/audit.service";

const log = createLogger("refused-audit");

const MONEY_PATH =
  /^\/api\/(companies\/[^/]+\/(invoices|bills|journal|receipts|payroll|vat|vat-returns|vat-workpapers|tax|tax-filings|corporate-tax|opening-balances|import-opening|credit-notes|quotes|purchase-orders|expense-claims|customer-refunds|vendor-credits|bank|year-end|month-end|sales-orders|customer-advances|payments)|invoices|bills|journal|receipts|payroll|vat-returns|tax-filings|approvals|credit-notes|purchase-orders|expense-claims|customer-refunds|vendor-credits|bank|fixed-assets|opening-balances|year-end|month-end|sales-orders)\b/;

/** `/api/<resource>/:id/...` -> the table that tells us the company. */
const RESOURCE_TABLE: Record<string, string> = {
  bills: "vendor_bills",
  invoices: "invoices",
  journal: "journal_entries",
  receipts: "receipts",
  "vat-returns": "vat_returns",
  "purchase-orders": "purchase_orders",
  "expense-claims": "expense_claims",
  "sales-orders": "sales_orders",
};
const APPROVAL_TABLE: Record<string, string> = { bill: "vendor_bills", manual_journal: "journal_entries", purchase_order: "purchase_orders", expense_claim: "expense_claims" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PER_USER_PER_MINUTE = 30;
const recent = new Map<string, number[]>();

function throttled(userId: string): boolean {
  const now = Date.now();
  const arr = (recent.get(userId) ?? []).filter((t) => t > now - 60_000);
  if (arr.length >= PER_USER_PER_MINUTE) {
    recent.set(userId, arr);
    return true;
  }
  arr.push(now);
  recent.set(userId, arr);
  return false;
}

async function companyOf(path: string): Promise<string | null> {
  const direct = /^\/api\/companies\/([0-9a-f-]{36})\//i.exec(path);
  if (direct && UUID.test(direct[1])) return direct[1];
  const parts = path.split("/").filter(Boolean); // api, resource, id, ...
  let table = RESOURCE_TABLE[parts[1]];
  let id = parts[2];
  if (parts[1] === "approvals") {
    table = APPROVAL_TABLE[parts[2]];
    id = parts[3];
  }
  if (!table || !id || !UUID.test(id)) return null;
  const { rows } = await pool.query(`SELECT company_id FROM ${table} WHERE id = $1`, [id]); // table is from the maps above
  return rows[0]?.company_id ?? null;
}

export function refusedActionAudit(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const path = req.originalUrl.split("?")[0];
  if (!MONEY_PATH.test(path)) return next();
  let code: string | null = null;
  const json = res.json.bind(res);
  res.json = ((body?: any) => {
    if (body && typeof body === "object" && typeof body.code === "string") code = body.code;
    return json(body);
  }) as typeof res.json;
  res.on("finish", () => {
    if ((res.statusCode !== 403 && res.statusCode !== 409) || !req.user?.id || req.apiKeyId) return;
    if (throttled(req.user.id)) return;
    void (async () => {
      try {
        await recordAudit({
          userId: req.user!.id,
          companyId: await companyOf(path),
          action: `refused.${res.statusCode}`,
          entityType: "request",
          entityId: null,
          after: { method: req.method, path, status: res.statusCode, code },
          req,
        });
      } catch (err) {
        log.warn({ err }, "Could not record a refused action");
      }
    })();
  });
  next();
}
