/**
 * Audit trail + company security policy API (W5-E: R01-16, R02-17, R17-23, R01-11).
 *
 *   GET  /api/companies/:companyId/audit-log           filterable list (security events,
 *                                                     postings, account lifecycle, team)
 *   GET  /api/companies/:companyId/audit-log/verify    walk the hash chain, first broken link
 *   GET  /api/companies/:companyId/audit-log/export    csv | json with hashes + before/after
 *   GET  /api/companies/:companyId/security/policy     MFA policy + member MFA coverage
 *   PUT  /api/companies/:companyId/security/policy     change the MFA policy (step-up)
 *   GET  /api/admin/audit-log/verify                  platform admins: the "global" chain
 *
 * Company routes need `settings.company` (owners and admins). The central policy table
 * already refuses non-members (403) before these handlers run.
 */
import { todayDubai } from "@shared/accounting-date";
import type { Express, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { adminMiddleware, authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requirePermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { listJobs, registerJob } from "../platform/job-registry";
import { storage } from "../storage";
import {
  auditRowsToCsv,
  exportAuditChain,
  sealAllAuditChains,
  verifyAuditChain,
} from "../services/audit-chain.service";
import {
  getCompanyMfaPolicy,
  policyCoversRole,
  setCompanyMfaPolicy,
} from "../services/security/policy";
import { recordSecurityEvent, SECURITY_EVENT_ACTIONS } from "../services/security/security-events";
import { sql } from "../services/security/sql";
import { COMPANY_MFA_POLICIES, type AuditLog } from "../../shared/schema";
import { normalizeCompanyRole } from "../../shared/permissions";

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, "Use YYYY-MM-DD");

const listQuerySchema = z.object({
  category: z.enum(["all", "security", "ledger", "accounts", "team"]).optional(),
  action: z.string().trim().max(80).optional(),
  userId: z.string().guid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

const exportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const policyBodySchema = z.object({ requireMfa: z.enum(COMPANY_MFA_POLICIES) });

const CATEGORY_PREFIX: Record<string, string | undefined> = {
  ledger: "journal.",
  accounts: "account.",
  team: "team.",
};

function toDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const d = new Date(
    value.length === 10 ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}Z` : value
  );
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function badQuery(res: Response) {
  return res.status(400).json({ message: "Invalid query", code: "VALIDATION_ERROR" });
}

function parseDetails(details: string | null): Record<string, unknown> {
  if (!details) return {};
  try {
    const v = JSON.parse(details);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function presentRow(row: AuditLog, emails: Map<string, string>) {
  const details = parseDetails(row.details);
  return {
    id: row.id,
    seq: row.seq,
    at: row.createdAt,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    userId: row.userId,
    userEmail: row.userId ? (emails.get(row.userId) ?? null) : null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    before: details.before ?? null,
    after: details.after ?? null,
    details,
    hash: row.hash,
    prevHash: row.prevHash,
    legacy: row.legacy,
    security: (SECURITY_EVENT_ACTIONS as readonly string[]).includes(row.action),
  };
}

/** Minute job: append audit rows written while their chain lock was busy. Idempotent. */
export function registerAuditSealJob(): void {
  if (listJobs().some((j) => j.name === "audit.sealChains")) return;
  registerJob({
    name: "audit.sealChains",
    cron: "* * * * *",
    description: "Append pending audit-log rows to their tamper-evident hash chain",
    run: async () => {
      await sealAllAuditChains();
    },
  });
}

export function registerAuditRoutes(app: Express): void {
  registerAuditSealJob();
  const router = Router();

  router.get(
    "/companies/:companyId/audit-log",
    authMiddleware,
    requirePermission("settings.company"),
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) return badQuery(res);
      const q = parsed.data;
      const rows = await storage.getCompanyAuditLogs(req.params.companyId, {
        actions: q.action
          ? [q.action]
          : q.category === "security"
            ? [...SECURITY_EVENT_ACTIONS]
            : undefined,
        actionPrefix: q.action ? undefined : CATEGORY_PREFIX[q.category ?? "all"],
        userId: q.userId,
        from: toDate(q.from),
        to: toDate(q.to, true),
        limit: q.limit ?? 100,
        offset: q.offset ?? 0,
      });
      const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
      const emails = new Map<string, string>();
      if (userIds.length) {
        const { rows: users } = await sql<{ id: string; email: string }>(
          `SELECT id::text AS id, email FROM users WHERE id = ANY($1::uuid[])`,
          [userIds]
        );
        for (const u of users) emails.set(u.id, u.email);
      }
      res.json({
        events: rows.map((r) => presentRow(r, emails)),
        actions: SECURITY_EVENT_ACTIONS,
      });
    })
  );

  router.get(
    "/companies/:companyId/audit-log/verify",
    authMiddleware,
    requirePermission("settings.company"),
    asyncHandler(async (req: Request, res: Response) => {
      res.json(await verifyAuditChain(req.params.companyId));
    })
  );

  router.get(
    "/companies/:companyId/audit-log/export",
    authMiddleware,
    requirePermission("settings.company"),
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = exportQuerySchema.safeParse(req.query);
      if (!parsed.success) return badQuery(res);
      const { companyId } = req.params;
      const rows = await exportAuditChain(companyId, {
        from: toDate(parsed.data.from),
        to: toDate(parsed.data.to, true),
      });
      const verification = await verifyAuditChain(companyId);
      await recordSecurityEvent(req, {
        action: "admin_action",
        userId: req.user!.id,
        companyId,
        resourceType: "audit_log",
        resourceId: companyId,
        details: {
          operation: "audit_log.export",
          format: parsed.data.format ?? "csv",
          rows: rows.length,
        },
      });
      const stamp = todayDubai();
      if (parsed.data.format === "json") {
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="audit-log-${companyId.slice(0, 8)}-${stamp}.json"`
        );
        return res.json({ companyId, exportedAt: new Date().toISOString(), verification, rows });
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="audit-log-${companyId.slice(0, 8)}-${stamp}.csv"`
      );
      res.setHeader("X-Audit-Chain-Verified", verification.ok ? "true" : "false");
      res.send(auditRowsToCsv(rows));
    })
  );

  router.get(
    "/companies/:companyId/security/policy",
    authMiddleware,
    requirePermission("settings.company"),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const requireMfa = await getCompanyMfaPolicy(companyId);
      const { rows } = await sql<{
        user_id: string;
        email: string;
        role: string;
        mfa_enabled: boolean;
      }>(
        `SELECT cu.user_id::text AS user_id, u.email, cu.role, u.mfa_enabled
           FROM company_users cu JOIN users u ON u.id = cu.user_id
          WHERE cu.company_id = $1
          ORDER BY u.email`,
        [companyId]
      );
      const members = rows.map((m) => {
        const role = normalizeCompanyRole(m.role);
        return {
          userId: m.user_id,
          email: m.email,
          role,
          mfaEnabled: m.mfa_enabled,
          coveredByPolicy: policyCoversRole(requireMfa, role),
        };
      });
      res.json({
        requireMfa,
        options: COMPANY_MFA_POLICIES,
        members,
        uncovered: members.filter((m) => m.coveredByPolicy && !m.mfaEnabled).length,
      });
    })
  );

  router.put(
    "/companies/:companyId/security/policy",
    authMiddleware,
    requirePermission("settings.company"),
    strictBody(policyBodySchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const { requireMfa } = req.body as z.output<typeof policyBodySchema>;
      const userId = req.user!.id;
      const before = await getCompanyMfaPolicy(companyId);
      // Lock-out guard: whoever turns the policy on must already be covered by MFA.
      const membership = await storage.getUserRole(companyId, userId);
      const actorRole = membership ? normalizeCompanyRole(membership.role) : null;
      if (policyCoversRole(requireMfa, actorRole)) {
        const { rows } = await sql<{ mfa_enabled: boolean }>(
          `SELECT mfa_enabled FROM users WHERE id = $1`,
          [userId]
        );
        if (!rows[0]?.mfa_enabled) {
          return res.status(409).json({
            message: "Turn on two-factor authentication for your own account first.",
            code: "MFA_ENROLL_FIRST",
          });
        }
      }
      await setCompanyMfaPolicy(companyId, requireMfa, userId);
      await recordSecurityEvent(req, {
        action: "security.policy_changed",
        userId,
        companyId,
        resourceType: "company_security_policy",
        resourceId: companyId,
        details: { before: { requireMfa: before }, after: { requireMfa } },
      });
      res.json({ requireMfa });
    })
  );

  router.get(
    "/admin/audit-log/verify",
    authMiddleware,
    adminMiddleware,
    asyncHandler(async (_req: Request, res: Response) => {
      res.json(await verifyAuditChain(null));
    })
  );

  app.use("/api", router);
}
