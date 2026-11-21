/**
 * Central company-role enforcement (R01-02, R01-14).
 *
 * Mounted once in server/routes.ts on /api, BEFORE every route module, so
 * route files owned by other workstreams do not have to change. For each
 * request it:
 *
 *   1. resolves the permission from POLICY_RULES (method + path; first match
 *      wins). Unlisted company-scoped requests default to `reports.read` for
 *      GET/HEAD/OPTIONS and `documents.write` for mutations, so a viewer is
 *      read-only everywhere unless a rule says otherwise;
 *   2. resolves the company: `/companies/:companyId/...`, a tenant row id in
 *      the path (`/invoices/:id/...` → invoices.company_id, see RESOURCES),
 *      or a `companyId` in the body/query;
 *   3. authenticates with the same memoised check authMiddleware uses (a
 *      request with no or a bad credential passes through and the route's
 *      own authMiddleware answers 401);
 *   4. loads the caller's company_users role and answers 403
 *      PERMISSION_DENIED when the role lacks the permission, or 403
 *      COMPANY_ACCESS_DENIED when the caller is not a member of a company it
 *      named (URL/body/query). A non-member addressing another tenant's row
 *      id gets 404 NOT_FOUND, so row ids are no existence oracle.
 *
 * Platform admins and NR firm staff (users.firm_role) are not company
 * members in the RBAC sense; they pass through to the route's existing
 * firm-aware checks (hasCompanyAccess / requireNraAccess).
 *
 * Rollout: RBAC_ENFORCE=enforce (default; also "true"/"on"), "report" (log
 * what would be denied, deny nothing) or "off". See .env.example.
 *
 * Later workstreams: use `requirePermission(...)` on new routes for
 * belt-and-braces checks and `assertDifferentActor(maker, checker)` for
 * maker-checker approvals.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq, exists, isNull, notExists, or, sql } from "drizzle-orm";
import { db, pool, type AppDatabase } from "../db";
import {
  companies,
  companyUsers,
  firmClientLinks,
  firmCompanyGrants,
  firmMembers,
  firms,
  firmStaffAssignments,
} from "../../shared/schema";
import {
  acceptedCompanyInvite,
  historicDirectCompanyRole,
  recordedFirmOrigin,
  canAccessFirmClient,
  NR_FIRM_ID,
  resolveFirmContext,
} from "../services/firm/scope";
import { storage } from "../storage";
import { createLogger } from "../config/logger";
import { DomainError } from "../errors";
import { authenticateRequest } from "./auth";
import {
  FIRM_ROLE_COMPANY_ROLE,
  firmRoleSeesAllClients,
  isFirmRole,
  isNraFirmRole,
} from "../../shared/access";
import {
  normalizeCompanyRole,
  roleHasAnyPermission,
  type CompanyRole,
  type Permission,
} from "../../shared/permissions";

const log = createLogger("rbac-policy");

// ─── Mode ────────────────────────────────────────────────────────────────

export type RbacMode = "enforce" | "report" | "off";

export function rbacMode(raw: string | undefined = process.env.RBAC_ENFORCE): RbacMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "report" || v === "log" || v === "dry-run") return "report";
  if (v === "off" || v === "false" || v === "0" || v === "no") return "off";
  return "enforce";
}

// ─── Policy table ────────────────────────────────────────────────────────

type MethodSpec = "*" | "READ" | "MUT" | string; // "POST|PUT" etc.

export interface PolicyRule {
  methods: MethodSpec;
  /** Path under /api, "/"-separated; "*" = one segment, "**" = the rest. */
  pattern: string;
  /** Any one of these is sufficient. */
  permission: Permission | readonly Permission[];
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const r = (
  methods: MethodSpec,
  pattern: string,
  permission: Permission | readonly Permission[]
): PolicyRule => ({ methods, pattern, permission });

const PAYROLL_READ: readonly Permission[] = ["payroll.manage", "payroll.approve"];
const ACTIVITY_READ: readonly Permission[] = [
  "settings.company",
  "documents.approve",
  "ledger.post",
];

/**
 * Explicit entries. Order matters (first match wins), so specific actions sit
 * above the broad prefix they belong to.
 */
export const POLICY_RULES: readonly PolicyRule[] = [
  // Company record and settings
  r("PUT|PATCH", "companies/*", "settings.company"),
  r("DELETE", "companies/*", "company.delete"),
  r("MUT", "companies/*/preferences/**", "settings.company"),
  r("POST", "companies/*/seed-accounts", "settings.company"),
  r("DELETE", "companies/*/customer-contacts/clear-all", "settings.company"),
  r("MUT", "companies/*/reminder-settings/**", "settings.company"),
  r("MUT", "reminder-settings/**", "settings.company"),
  r("MUT", "companies/*/report-delivery/subscriptions/*/settings", "settings.company"),
  r("*", "companies/*/api-keys/**", "settings.company"),
  r("*", "api-keys/**", "settings.company"),
  r("MUT", "companies/*/webhooks/**", "settings.company"),
  r("MUT", "webhooks/*/**", "settings.company"),
  r("POST", "companies/*/bank-connections/*/import", "documents.write"),
  r("POST", "bank-connections/*/sync", "documents.write"),
  r("MUT", "companies/*/bank-connections/**", "settings.company"),
  r("MUT", "bank-connections/**", "settings.company"),
  r("MUT", "companies/*/bank-accounts/**", "settings.company"),
  r("MUT", "companies/*/invoice-templates/**", "settings.company"),
  r("MUT", "invoice-templates/**", "settings.company"),
  // WQ5: e-invoicing tax identity, partner choice and approver links (links carry an email and a
  // no-login URL, so even listing them is an admin action). The first-invoice prompt's "shown"
  // marker is written by whoever drafts the invoice.
  r("MUT", "companies/*/einvoicing/settings", "settings.company"),
  r("MUT", "companies/*/einvoicing/identity", "settings.company"),
  r("MUT", "companies/*/einvoicing/acube/**", "settings.company"),
  r("POST", "companies/*/einvoicing/complyance/connect", "settings.company"),
  r("POST", "companies/*/einvoicing/complyance/sync", "settings.company"),
  r("MUT", "companies/*/einvoicing/partner/**", "settings.company"),
  r("*", "companies/*/einvoicing/approver-links/**", "settings.company"),
  r("POST", "companies/*/einvoicing/tax-ready/shown", "documents.write"),
  // WQ7: automation switches, document numbering, approval rules and the setup wizard's
  // progress are company settings.
  r("MUT", "companies/*/automations/**", "settings.company"),
  r("MUT", "companies/*/numbering/**", "settings.company"),
  r("MUT", "companies/*/approval-rules/**", "settings.company"),
  r("MUT", "companies/*/approval-settings", "settings.company"),
  r("MUT", "companies/*/onboarding/**", "settings.company"),

  // Activity History (J4): the feed merges audit rows (IP address, user agent, before/after
  // metadata), so it is not general reporting data. Same audience as the audit log's finance
  // readers: admins (settings.company), approvers/accountants (documents.approve) and anyone who
  // posts to the ledger. Viewers and employees are refused, matching the denied audit-log API.
  r("GET", "companies/*/activity-logs", ACTIVITY_READ),

  // STEP5: customer-portal invitations. Anyone who can create documents may invite a customer
  // (the same audience as the portal share link); viewers see the status read-only.
  r("MUT", "companies/*/customer-contacts/*/portal-invitations", "documents.write"),
  r("MUT", "companies/*/portal-invitations/**", "documents.write"),
  r("DELETE", "companies/*/portal-accounts/*", "documents.write"),

  // Team, billing, backups
  r("*", "companies/*/team/invitations/**", "team.manage"),
  r("MUT", "companies/*/team/**", "team.manage"),
  // Also covers STEP4 PUT .../billing/chosen-plan and POST .../billing/activation-request.
  r("MUT", "companies/*/billing/**", "billing.manage"),
  // X6d: any member who can read reports may ask the firm for help (viewers included).
  r("POST", "companies/*/najma-handoff", "reports.read"),
  r("*", "companies/*/backups/**", "backups.manage"),
  r("*", "backups/**", "backups.manage"),

  // Period lock / unlock
  r("POST", "companies/*/month-end/lock-period", "period.lock"),
  r("POST", "period-lock/unlock", "period.unlock"),

  // Ledger posting and chart of accounts
  r("MUT", "companies/*/accounts/**", "ledger.post"),
  r("MUT", "accounts/**", "ledger.post"),
  r("MUT", "companies/*/journal/**", "ledger.post"),
  r("MUT", "journal/**", "ledger.post"),
  r("POST", "invoices/*/post", "ledger.post"),
  // Sending an e-invoice through an ASP is an external tax transmission.
  r("POST", "invoices/*/einvoice/submit", "tax.submit"),
  r("POST", "invoices/*/einvoice/resubmit", "tax.submit"),
  r("POST", "invoices/*/einvoice/confirm-environment", "tax.submit"),
  r("POST", "invoices/*/einvoice/refresh-status", "reports.read"),
  // X6a: linking an e-invoice the provider already holds changes what the invoice reports to the
  // FTA (Complyance manual link after GETS-HEAD-010).
  r("POST", "companies/*/einvoicing/complyance/link", "tax.submit"),
  // Status / transition routes that write or reverse journal entries (J4): issuing ("sent"/"posted")
  // and voiding an invoice, issuing/voiding a credit note, debit/credit notes raised from an
  // invoice, recording a customer payment, applying/refunding customer credit and undoing an FX
  // revaluation all post to the GL, so they need the same permission as `invoices/*/post`.
  r("PATCH", "invoices/*/status", "ledger.post"),
  r("POST", "credit-notes/*/issue", "ledger.post"),
  r("POST", "credit-notes/*/void", "ledger.post"),
  r("POST", "companies/*/invoices/*/credit-note", "ledger.post"),
  r("POST", "companies/*/invoices/*/debit-note", "ledger.post"),
  r("POST", "companies/*/invoices/*/payments", "ledger.post"),
  // A3 (H1, M5): bad-debt write-off / reinstatement and the doubtful-debt allowance post to GL.
  r("POST", "companies/*/invoices/*/write-off", "ledger.post"),
  r("POST", "companies/*/invoices/*/write-off/reinstate", "ledger.post"),
  // WQ1: one receipt over several invoices and a cash sale post to the GL (payments, revenue).
  r("POST", "companies/*/receive-payments", "ledger.post"),
  r("POST", "companies/*/cash-sales", "ledger.post"),
  // WQ1: invoice attachments and emailing a quote are document work.
  r("MUT", "invoices/*/attachments/**", "documents.write"),
  r("POST", "quotes/*/send-email", "documents.write"),
  r("POST", "companies/*/receivables/allowance", "ledger.post"),
  r("POST", "companies/*/customer-credits/*/apply", "ledger.post"),
  r("POST", "companies/*/customer-credits/*/refund", "ledger.post"),
  // A4 (M1): a customer deposit posts Dr bank / Cr 2050 / Cr 2020 VAT on receipt.
  r("POST", "companies/*/customer-deposits", "ledger.post"),
  r("POST", "companies/*/debit-notes/*/apply", "ledger.post"),
  r("POST", "companies/*/fx-revaluations/*/undo", "ledger.post"),
  r("POST", "receipts/*/post", "ledger.post"),
  r("POST", "companies/*/bills/backfill-gl", "ledger.post"),
  r("POST", "companies/*/month-end/generate-closing-entries", "ledger.post"),
  r("POST", "companies/*/vat-workpapers/*/rows/*/post", "ledger.post"),
  r("POST", "companies/*/bank-statements/*/create-entry", "ledger.post"),
  r("POST", "companies/*/exchange-rates/revalue", "ledger.post"),
  r("POST", "companies/*/fixed-assets/run-depreciation", "ledger.post"),
  r("POST", "fixed-assets/*/depreciate", "ledger.post"),
  r("POST", "fixed-assets/*/dispose", "ledger.post"),

  // Approvals
  r("POST", "bills/*/approve", "documents.approve"),
  r("POST", "purchase-orders/*/approve", "documents.approve"),
  r("POST", "expense-claims/*/approve", "documents.approve"),
  r("POST", "expense-claims/*/reject", "documents.approve"),
  r("POST", "budget-plans/*/approve", "documents.approve"),
  r("POST", "companies/*/receipts/*/review-decision", "documents.approve"),
  r("POST", "companies/*/ai-gl/queue/*/*", "documents.approve"),

  // WQ2: reading a supplier invoice spends AI credits and stores nothing; purchase files
  // (bill attachments, claim receipts) are document writes. Viewers are refused.
  r("POST", "companies/*/bills/capture", "documents.write"),
  r("POST", "bills/*/attachment", "documents.write"),
  r("POST", "companies/*/expense-claims/receipts", "documents.write"),

  // Payment release
  r("POST", "bills/*/payments", "payments.release"),
  r("POST", "expense-claims/*/mark-paid", "payments.release"),

  // Payroll (salary data is not general reporting data)
  r("POST", "payroll-runs/*/approve", "payroll.approve"),
  r("MUT", "companies/*/payroll-runs/**", "payroll.manage"),
  r("MUT", "payroll-runs/**", "payroll.manage"),
  r("MUT", "payroll-items/**", "payroll.manage"),
  r("MUT", "companies/*/employees/**", "payroll.manage"),
  r("MUT", "employees/**", "payroll.manage"),
  // E2 (J3-r2): booking the opening gratuity provision posts Dr 3040 / Cr 2036.
  r("POST", "companies/*/payroll/opening-gratuity/book", "payroll.manage"),
  r("*", "companies/*/payroll/**", PAYROLL_READ),
  r("*", "companies/*/payroll-runs/**", PAYROLL_READ),
  r("*", "payroll-runs/**", PAYROLL_READ),
  r("*", "payroll-items/**", PAYROLL_READ),
  r("*", "companies/*/employees/**", PAYROLL_READ),
  r("*", "employees/**", PAYROLL_READ),

  // Tax filing
  r("POST", "corporate-tax/returns/*/unfile", "tax.submit"),
  // A4: year-end CT accrual and deferred-tax adjustments post to the GL; returns filed outside
  // Muhasib set the losses brought forward.
  r("POST", "corporate-tax/returns/*/accrue", "ledger.post"),
  r("POST", "companies/*/corporate-tax/deferred-tax", "ledger.post"),
  r("POST", "companies/*/corporate-tax/deferred-tax/*/reverse", "ledger.post"),
  r("MUT", "companies/*/corporate-tax/external-returns", "tax.submit"),
  r("MUT", "companies/*/corporate-tax/external-returns/*", "tax.submit"),
  r("POST", "vat-returns/*/submit", "tax.submit"),
  // VAT paid to / refunded by the FTA for a submitted return (posts Dr 2020 / Cr 1050 / bank).
  r("POST", "vat-returns/*/settlement", "tax.submit"),
  r("POST", "vat-returns/*/settlement/reverse", "tax.submit"),
  r("PATCH", "vat/autopilot/periods/*/status", "tax.submit"),

  // Read-only computations and exports sent as POST
  r("POST", "companies/*/receipts/export-excel", "reports.read"),
  r("POST", "companies/*/invoices/check-similar", "reports.read"),
  r("POST", "companies/*/receipts/check-similar", "reports.read"),
  r("POST", "export/excel", "reports.read"),
  r("POST", "ocr/export-excel", "reports.read"),
];

/**
 * Prefixes that are never company-role checked here: identity endpoints,
 * NR firm/admin surfaces (own gates), public portals, signed webhooks and
 * per-user preferences. `POST /api/companies` creates a company (no role yet).
 */
const SKIP_PREFIXES = [
  "auth",
  "firm",
  "admin",
  "nra",
  "portal",
  "portal-invitations",
  "client-portal",
  "team-invitations",
  "invitations",
  "notifications",
  "notification-preferences",
  "onboarding",
  "push",
  "feedback",
  "client-errors",
  "analytics/event",
  "waitlist",
  "referrals",
  "csrf-token",
  "version",
  "webhooks/email-intake",
  "webhooks/stripe",
  "csp-report",
];

function splitPath(path: string): string[] {
  return path.split("?")[0].split("/").filter(Boolean);
}

function matchSegments(pattern: string[], segs: string[]): boolean {
  let i = 0;
  for (const tok of pattern) {
    if (tok === "**") return true;
    if (i >= segs.length) return false;
    if (tok !== "*" && tok !== segs[i]) return false;
    i++;
  }
  return i === segs.length;
}

function methodMatches(spec: MethodSpec, method: string): boolean {
  if (spec === "*") return true;
  if (spec === "READ") return READ_METHODS.has(method);
  if (spec === "MUT") return !READ_METHODS.has(method);
  return spec.split("|").includes(method);
}

const COMPILED = POLICY_RULES.map((rule) => ({ ...rule, segs: rule.pattern.split("/") }));

export function isPolicyExempt(path: string): boolean {
  const p = splitPath(path).join("/");
  if (p === "companies" || p === "") return true;
  return SKIP_PREFIXES.some((s) => p === s || p.startsWith(`${s}/`));
}

/**
 * Permission(s) required for `method path` (path relative to /api, e.g.
 * "/companies/<id>/team/<memberId>"). Returns null for exempt paths.
 */
export function resolvePermission(method: string, path: string): readonly Permission[] | null {
  if (isPolicyExempt(path)) return null;
  const m = method.toUpperCase();
  const segs = splitPath(path);
  for (const rule of COMPILED) {
    if (methodMatches(rule.methods, m) && matchSegments(rule.segs, segs)) {
      return typeof rule.permission === "string" ? [rule.permission] : rule.permission;
    }
  }
  return READ_METHODS.has(m) ? ["reports.read"] : ["documents.write"];
}

// ─── Company resolution ──────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** First path segment → SQL resolving the owning company of row $1. */
const RESOURCES: Record<string, string> = {
  accounts: "SELECT company_id FROM accounts WHERE id = $1",
  invoices: "SELECT company_id FROM invoices WHERE id = $1",
  receipts: "SELECT company_id FROM receipts WHERE id = $1",
  journal: "SELECT company_id FROM journal_entries WHERE id = $1",
  products: "SELECT company_id FROM products WHERE id = $1",
  employees: "SELECT company_id FROM employees WHERE id = $1",
  "payroll-runs": "SELECT company_id FROM payroll_runs WHERE id = $1",
  "payroll-items":
    "SELECT r.company_id FROM payroll_items i JOIN payroll_runs r ON r.id = i.payroll_run_id WHERE i.id = $1",
  "expense-claims": "SELECT company_id FROM expense_claims WHERE id = $1",
  bills: "SELECT company_id FROM vendor_bills WHERE id = $1",
  "fixed-assets": "SELECT company_id FROM fixed_assets WHERE id = $1",
  "budget-plans": "SELECT company_id FROM budget_plans WHERE id = $1",
  "budget-lines":
    "SELECT p.company_id FROM budget_lines l JOIN budget_plans p ON p.id = l.budget_id WHERE l.id = $1",
  "anomaly-alerts": "SELECT company_id FROM anomaly_alerts WHERE id = $1",
  "bank-transactions": "SELECT company_id FROM bank_transactions WHERE id = $1",
  quotes: "SELECT company_id FROM quotes WHERE id = $1",
  // Credit notes live in `invoices` (invoice_type = 'credit_note'); the legacy credit_notes table
  // is no longer what /api/credit-notes/:id addresses.
  "credit-notes": "SELECT company_id FROM invoices WHERE id = $1",
  "purchase-orders": "SELECT company_id FROM purchase_orders WHERE id = $1",
  "cost-centers": "SELECT company_id FROM cost_centers WHERE id = $1",
  "reconciliation-rules": "SELECT company_id FROM reconciliation_rules WHERE id = $1",
  "invoice-templates": "SELECT company_id FROM invoice_templates WHERE id = $1",
  "bank-connections": "SELECT company_id FROM bank_connections WHERE id = $1",
  "api-keys": "SELECT company_id FROM api_keys WHERE id = $1",
  webhooks: "SELECT company_id FROM webhook_endpoints WHERE id = $1",
  "recurring-invoices": "SELECT company_id FROM recurring_invoices WHERE id = $1",
  "reminder-settings": "SELECT company_id FROM reminder_settings WHERE id = $1",
  backups: "SELECT company_id FROM backups WHERE id = $1",
  "vat-returns": "SELECT company_id FROM vat_returns WHERE id = $1",
  "compliance-tasks": "SELECT company_id FROM compliance_tasks WHERE id = $1",
  documents: "SELECT company_id FROM documents WHERE id = $1",
  "tax-returns-archive": "SELECT company_id FROM tax_return_archive WHERE id = $1",
};

/** Deeper resource shapes: [path prefix segments, SQL]. The id follows the prefix. */
const NESTED_RESOURCES: Array<[string[], string]> = [
  [["corporate-tax", "returns"], "SELECT company_id FROM corporate_tax_returns WHERE id = $1"],
  [["chasing", "send"], "SELECT company_id FROM invoices WHERE id = $1"],
  [["chasing", "invoice"], "SELECT company_id FROM invoices WHERE id = $1"],
  [["integrations", "ecommerce"], "SELECT company_id FROM ecommerce_integrations WHERE id = $1"],
  [["vat", "autopilot", "periods"], "SELECT company_id FROM vat_return_periods WHERE id = $1"],
];

/** Routes that carry the company id as a later path parameter. */
const COMPANY_PARAM_PREFIXES: string[][] = [
  ["chasing", "bulk-send"],
  ["chasing", "overdue"],
  ["chasing", "queue"],
  ["chasing", "history"],
  ["chasing", "effectiveness"],
  ["chasing", "config"],
  ["chasing", "templates"],
  ["reports"],
  ["vat", "autopilot", "calculate"],
];

async function lookupCompany(sqlText: string, id: string): Promise<string | null> {
  try {
    const result = await pool.query(sqlText, [id]);
    const row = result?.rows?.[0] as { company_id?: string | null } | undefined;
    return row?.company_id ?? null;
  } catch (err) {
    log.warn({ err: (err as Error).message }, "company lookup failed");
    return null;
  }
}

function startsWith(segs: string[], prefix: string[]): boolean {
  return prefix.every((p, i) => segs[i] === p);
}

/**
 * How the company was found: named by the caller (URL / body / query) or
 * looked up from a tenant row id in the path. A non-member probing another
 * tenant's row id gets 404 (no existence oracle); naming a company gets 403.
 */
export type CompanySource = "named" | "row";

/** The company a request acts on (and how it was found), or null. */
export async function resolveRequestCompanyWithSource(
  req: Request,
  path: string
): Promise<{ companyId: string; source: CompanySource } | null> {
  const named = (id: string | null) => (id ? { companyId: id, source: "named" as const } : null);
  const row = (id: string | null) => (id ? { companyId: id, source: "row" as const } : null);
  const segs = splitPath(path);
  if (segs[0] === "companies" && segs[1]) {
    return named(UUID_RE.test(segs[1]) ? segs[1].toLowerCase() : null);
  }
  for (const prefix of COMPANY_PARAM_PREFIXES) {
    const id = segs[prefix.length];
    if (startsWith(segs, prefix) && id && UUID_RE.test(id)) return named(id.toLowerCase());
  }
  // A period's status route addresses a row, while list/detail routes name the company first.
  if (startsWith(segs, ["vat", "autopilot", "periods"]) && segs[3] && segs[4] !== "status") {
    return named(UUID_RE.test(segs[3]) ? segs[3].toLowerCase() : null);
  }
  for (const [prefix, sqlText] of NESTED_RESOURCES) {
    const id = segs[prefix.length];
    if (startsWith(segs, prefix) && id && UUID_RE.test(id)) {
      return row(await lookupCompany(sqlText, id));
    }
  }
  const resource = RESOURCES[segs[0]];
  if (resource && segs[1] && UUID_RE.test(segs[1])) {
    return row(await lookupCompany(resource, segs[1]));
  }

  const fromBody = (req.body as Record<string, unknown> | undefined)?.companyId;
  if (typeof fromBody === "string" && UUID_RE.test(fromBody)) return named(fromBody.toLowerCase());
  const fromQuery = (req.query as Record<string, unknown> | undefined)?.companyId;
  if (typeof fromQuery === "string" && UUID_RE.test(fromQuery)) {
    return named(fromQuery.toLowerCase());
  }
  return null;
}

/** The company a request acts on, or null if it cannot be determined. */
export async function resolveRequestCompany(req: Request, path: string): Promise<string | null> {
  return (await resolveRequestCompanyWithSource(req, path))?.companyId ?? null;
}

// ─── Membership ──────────────────────────────────────────────────────────

/** The caller's normalised role in a company, or null when not a member. */
export async function getCompanyRole(
  userId: string,
  companyId: string
): Promise<CompanyRole | null> {
  const membership = await storage.getUserRole(companyId, userId);
  return membership ? normalizeCompanyRole(membership.role) : null;
}

function bypassesCompanyRoles(user: Express.User): boolean {
  return user.isAdmin === true || isNraFirmRole(user.firmRole);
}

function deny(
  res: Response,
  code: "PERMISSION_DENIED" | "COMPANY_ACCESS_DENIED",
  details: Record<string, unknown>
): void {
  res.status(403).json({
    message:
      code === "PERMISSION_DENIED"
        ? "Your role in this company does not allow this action"
        : "Access denied to this company",
    code,
    details,
  });
}

// ─── Central middleware ──────────────────────────────────────────────────

export async function companyRolePolicy(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const mode = rbacMode();
    if (mode === "off") return next();
    const permissions = resolvePermission(req.method, req.path);
    if (!permissions) return next();

    const auth = await authenticateRequest(req);
    if (!auth || "code" in auth) return next(); // route's authMiddleware answers 401
    const user = auth.user;
    if (bypassesCompanyRoles(user)) return next();

    const resolved = await resolveRequestCompanyWithSource(req, req.path);
    if (!resolved) return next();
    const { companyId } = resolved;

    // Defence in depth (STEP5): a portal customer never reaches company routes. The membership
    // lookup below already finds no role for them (storage.getUserRole ignores client_portal).
    if (user.userType === "client_portal") {
      log.info({ userId: user.id, method: req.method, path: req.path }, "Portal user denied");
      res.status(403).json({
        message: "Customer portal accounts cannot use the company app",
        code: "PORTAL_USER_APP_DENIED",
      });
      return;
    }

    const role = await getCompanyRole(user.id, companyId);
    const allowed = !!role && roleHasAnyPermission(role, permissions);
    if (allowed) {
      req.companyRole = role!;
      return next();
    }
    const details = { permission: permissions[0], permissions, role, companyId };
    if (mode === "report") {
      log.warn(
        { userId: user.id, method: req.method, path: req.path, ...details },
        "RBAC (report mode): request would be denied"
      );
      return next();
    }
    log.info({ userId: user.id, method: req.method, path: req.path, ...details }, "RBAC denied");
    if (!role && resolved.source === "row") {
      // Another tenant's row id: answer like a missing row (tenant-scoped 404).
      res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
      return;
    }
    deny(res, role ? "PERMISSION_DENIED" : "COMPANY_ACCESS_DENIED", details);
  } catch (err) {
    next(err);
  }
}

/**
 * Route-level guard: `router.post(path, authMiddleware, requirePermission("payments.release"), h)`.
 * Reads the company from the URL (`:companyId`), else the body/query. Always
 * enforced (independent of RBAC_ENFORCE); admins and NR firm staff pass.
 */
export function requirePermission(...permissions: [Permission, ...Permission[]]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      if (!req.user) {
        res.status(401).json({ message: "Authentication required", code: "AUTH_REQUIRED" });
        return;
      }
      if (bypassesCompanyRoles(req.user)) return next();
      const raw =
        req.params?.companyId ??
        (req.body as Record<string, unknown> | undefined)?.companyId ??
        (req.query as Record<string, unknown> | undefined)?.companyId;
      if (typeof raw !== "string" || !UUID_RE.test(raw)) {
        res.status(400).json({ message: "Company ID required", code: "COMPANY_REQUIRED" });
        return;
      }
      const role = await getCompanyRole(req.user.id, raw.toLowerCase());
      if (!role) return deny(res, "COMPANY_ACCESS_DENIED", { companyId: raw });
      if (!roleHasAnyPermission(role, permissions)) {
        return deny(res, "PERMISSION_DENIED", { permission: permissions[0], permissions, role });
      }
      req.companyRole = role;
      next();
    })().catch(next);
  };
}

type ScopedCompanyActor = Pick<Express.User, "id" | "isAdmin" | "userType" | "firmRole">;

type ScopedPermissionFailure =
  | { code: "PORTAL_USER_APP_DENIED" }
  | { code: "COMPANY_ACCESS_DENIED" }
  | { code: "PERMISSION_DENIED"; role: CompanyRole };

/** Permission check for actions that also require an active firm or direct company scope. */
export async function scopedCompanyPermissionFailure(
  user: ScopedCompanyActor,
  companyId: string,
  permission: Permission,
  conn: Pick<AppDatabase, "select"> = db,
  lock?: "share"
): Promise<ScopedPermissionFailure | null> {
  if (user.userType === "client_portal") return { code: "PORTAL_USER_APP_DENIED" };
  const provenance = and(
    eq(firmCompanyGrants.userId, user.id),
    eq(firmCompanyGrants.companyId, companyId)
  );
  const grantQuery = conn
    .select({ firmId: firmCompanyGrants.firmId, generated: sql<boolean>`${recordedFirmOrigin()}` })
    .from(firmCompanyGrants)
    .where(provenance);
  const grants = await (lock ? grantQuery.for(lock) : grantQuery);
  const generated = grants.find((row) => row.generated);
  const historicRole = generated ? await historicDirectCompanyRole(companyId, user.id, conn) : null;
  const grant = generated && generated.firmId !== NR_FIRM_ID ? generated : undefined;
  const firmScoped = isNraFirmRole(user.firmRole);
  const nrRole = isFirmRole(user.firmRole) ? user.firmRole : undefined;
  if (nrRole && (firmScoped || generated?.firmId === NR_FIRM_ID)) {
    const firm = await resolveFirmContext(user, conn);
    if (firm && (await canAccessFirmClient(firm, companyId, conn, lock))) {
      if (firmScoped) return null;
      const role = FIRM_ROLE_COMPANY_ROLE[nrRole];
      if (!roleHasAnyPermission(role, [permission])) return { code: "PERMISSION_DENIED", role };
    } else if (generated && !historicRole) {
      return { code: "COMPANY_ACCESS_DENIED" };
    }
  } else if (!grants.length && user.isAdmin && !nrRole) {
    return null;
  } else if (generated && !grant && !historicRole) {
    return { code: "COMPANY_ACCESS_DENIED" };
  }

  // A legacy invitation may prove an independent role despite an unchanged old firm marker.
  if (historicRole) {
    const role = normalizeCompanyRole(historicRole);
    return roleHasAnyPermission(role, [permission]) ? null : { code: "PERMISSION_DENIED", role };
  }

  // Validate firm and link before locking company_users, following link revocation's lock order.
  const firmAuthority = grant
    ? conn
        .select({ role: firmMembers.role })
        .from(firms)
        .innerJoin(firmMembers, eq(firmMembers.firmId, firms.id))
        .innerJoin(
          firmClientLinks,
          and(
            eq(firmClientLinks.firmId, firms.id),
            eq(firmClientLinks.companyId, companyId),
            eq(firmClientLinks.status, "active")
          )
        )
        .where(
          and(
            eq(firms.id, grant.firmId),
            eq(firms.status, "active"),
            eq(firmMembers.userId, user.id)
          )
        )
        .limit(1)
    : null;
  const [authority] = firmAuthority ? await (lock ? firmAuthority.for(lock) : firmAuthority) : [];
  if (grant && !isFirmRole(authority?.role)) return { code: "COMPANY_ACCESS_DENIED" };

  // For legacy NR roles, a recorded direct grant or an accepted company invitation
  // establishes independent access. Unlinked customer accounts also have direct roles.
  const directScope =
    firmScoped && !grants.length
      ? or(
          acceptedCompanyInvite(companyId, user.id),
          exists(
            conn
              .select({ id: companies.id })
              .from(companies)
              .where(
                and(
                  eq(companies.id, companyId),
                  eq(companies.companyType, "customer"),
                  isNull(companies.deletedAt),
                  notExists(
                    conn
                      .select({ id: firmClientLinks.id })
                      .from(firmClientLinks)
                      .where(eq(firmClientLinks.companyId, companies.id))
                  )
                )
              )
          )
        )
      : undefined;
  const query = conn
    .select({ role: companyUsers.role })
    .from(companyUsers)
    .where(
      and(
        eq(companyUsers.companyId, companyId),
        eq(companyUsers.userId, user.id),
        directScope,
        // If a grant arrived after discovery, do not read its new membership as independent.
        generated
          ? undefined
          : notExists(
              conn
                .select({ id: firmCompanyGrants.id })
                .from(firmCompanyGrants)
                .where(and(provenance, recordedFirmOrigin()))
            )
      )
    )
    .limit(1);
  const [membership] = await (lock ? query.for(lock) : query);
  const role = membership ? normalizeCompanyRole(membership.role) : null;
  if (!role) return { code: "COMPANY_ACCESS_DENIED" };
  if (isFirmRole(authority?.role)) {
    if (!firmRoleSeesAllClients(authority.role)) {
      const assignment = conn
        .select({ userId: firmStaffAssignments.userId })
        .from(firmStaffAssignments)
        .where(
          and(
            eq(firmStaffAssignments.companyId, companyId),
            eq(firmStaffAssignments.userId, user.id)
          )
        )
        .limit(1);
      const [assigned] = await (lock ? assignment.for(lock) : assignment);
      if (!assigned) return { code: "COMPANY_ACCESS_DENIED" };
    }
    const currentRole = FIRM_ROLE_COMPANY_ROLE[authority.role];
    if (!roleHasAnyPermission(currentRole, [permission])) {
      return { code: "PERMISSION_DENIED", role: currentRole };
    }
  }
  return roleHasAnyPermission(role, [permission]) ? null : { code: "PERMISSION_DENIED", role };
}

export async function assertScopedCompanyPermission(
  user: ScopedCompanyActor | undefined,
  companyId: string | undefined,
  permission: Permission
): Promise<void> {
  if (!user) throw new DomainError("AUTH_REQUIRED", 401);
  if (!companyId || !UUID_RE.test(companyId)) throw new DomainError("COMPANY_REQUIRED", 400);
  const failure = await scopedCompanyPermissionFailure(user, companyId, permission);
  if (!failure) return;
  const details = { companyId, permission, role: "role" in failure ? failure.role : null };
  throw new DomainError(failure.code, 403, details);
}

/** Always enforce the named company's permission, including assignment for legacy firm staff. */
export function requireScopedCompanyPermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    void assertScopedCompanyPermission(req.user, req.params.companyId, permission).then(
      () => next(),
      next
    );
  };
}

/**
 * Maker-checker: the approver must not be the person who prepared the item.
 * `allowSingleOwner` lets a company with a single member approve its own
 * work (callers decide that with companyHasSingleMember). Throws
 * DomainError("SAME_ACTOR_APPROVAL", 403).
 */
export function assertDifferentActor(
  makerId: string | null | undefined,
  checkerId: string,
  opts: { allowSingleOwner?: boolean } = {}
): void {
  if (!makerId || makerId !== checkerId) return;
  if (opts.allowSingleOwner) return;
  throw new DomainError(
    "SAME_ACTOR_APPROVAL",
    403,
    { makerId, checkerId },
    "The person who prepared this item cannot also approve it"
  );
}

/** True when exactly one user belongs to the company (solo-owner businesses). */
export async function companyHasSingleMember(companyId: string): Promise<boolean> {
  const members = await storage.getCompanyUsersByCompanyId(companyId);
  return members.length === 1;
}
