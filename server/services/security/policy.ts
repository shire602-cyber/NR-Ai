/**
 * Central security policy (W5-E), mounted once on /api right after companyRolePolicy:
 *
 *   1. Company MFA policy (R01-11): a company can require MFA for owners/admins or for all
 *      members. A member covered by the policy who has not enrolled gets 403
 *      MFA_ENROLLMENT_REQUIRED on that company's routes (account routes stay reachable so
 *      they can enrol).
 *   2. Step-up (R17-19): sensitive actions (team role change, backup restore, API key
 *      creation, period unlock, security policy change) need a TOTP verification within
 *      MFA_STEP_UP_WINDOW_MINUTES when the caller has MFA enabled: 403
 *      MFA_STEP_UP_REQUIRED, recovered with POST /api/auth/mfa/step-up. Routes can also use
 *      the exported `requireRecentMfa()` directly.
 *   3. Email verification gating (R01-11): once the grace period has passed, unverified
 *      accounts cannot issue documents or invite users (403 EMAIL_VERIFICATION_REQUIRED).
 *      Only active while EMAIL_VERIFICATION_ENFORCE is on AND an email provider exists.
 *
 * Platform admins retain the support exemption. The company MFA policy covers NR staff
 * acting through authorized client access, including staff without a company membership.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { sql } from "./sql";
import { createLogger } from "../../config/logger";
import { authenticateRequest } from "../../middleware/auth";
import {
  getCompanyRole,
  isSignedProviderCallback,
  resolveRequestCompany,
} from "../../middleware/companyRolePolicy";
import { isFirmRole } from "../../../shared/access";
import { canAccessFirmClient, resolveFirmContext } from "../firm/scope";
import { firmMfaTargetCompanies } from "./firm-mfa-targets";
import type { AppDatabase } from "../../db";
import { firmMfaRequirement, policyCoversRole } from "./firm-company-mfa";
export { policyCoversRole } from "./firm-company-mfa";
import { COMPANY_MFA_POLICIES, type CompanyMfaPolicy } from "../../../shared/schema";
import { emailVerificationConfig, mfaStepUpWindowMs } from "./config";

const log = createLogger("security-policy");

// ─── Path rules ────────────────────────────────────────────────────────────

interface PathRule {
  methods: string[];
  pattern: string[];
  /** Optional body predicate (e.g. only status changes to "sent"). */
  when?: (req: Request) => boolean;
}

const rule = (methods: string, pattern: string, when?: PathRule["when"]): PathRule => ({
  methods: methods.split("|"),
  pattern: pattern.split("/"),
  when,
});

function segs(path: string): string[] {
  return path.split("?")[0].split("/").filter(Boolean);
}

function matchSegs(pattern: string[], s: string[]): boolean {
  let i = 0;
  for (const tok of pattern) {
    if (tok === "**") return true;
    if (i >= s.length) return false;
    if (tok !== "*" && tok !== s[i]) return false;
    i++;
  }
  return i === s.length;
}

function matchRule(rules: readonly PathRule[], req: Request, path: string): boolean {
  const s = segs(path);
  return rules.some(
    (r) =>
      r.methods.includes(req.method.toUpperCase()) &&
      matchSegs(r.pattern, s) &&
      (!r.when || r.when(req))
  );
}

/** Sensitive actions that need a recent MFA verification (paths relative to /api). */
export const STEP_UP_RULES: readonly PathRule[] = [
  rule("PUT|PATCH", "companies/*/team/*"),
  rule("POST", "backups/*/restore"),
  rule("POST", "companies/*/api-keys"),
  rule("POST", "companies/*/period-lock/unlock"),
  rule("POST", "period-lock/unlock"),
  rule("PUT", "companies/*/security/policy"),
];

const ISSUE_STATUSES = new Set(["sent", "issued", "approved"]);

/** Document issue and invitation actions gated on email verification. */
export const VERIFIED_EMAIL_RULES: readonly PathRule[] = [
  rule("POST", "companies/*/team/invite"),
  rule("POST", "companies/*/team/invitations/*/resend"),
  rule("PATCH|PUT", "invoices/*/status", (req) =>
    ISSUE_STATUSES.has(String((req.body as { status?: unknown } | undefined)?.status ?? ""))
  ),
  rule("POST", "invoices/*/post"),
  rule("POST", "invoices/*/einvoice/submit"),
  rule("POST", "credit-notes/*/issue"),
  rule("POST", "companies/*/invoices/*/send-email"),
  // STEP5: inviting a customer to the portal sends email in the company's name.
  rule("POST", "companies/*/customer-contacts/*/portal-invitations"),
  rule("POST", "companies/*/portal-invitations/bulk"),
  rule("POST", "companies/*/portal-invitations/*/resend"),
];

/** Never subject to the company MFA policy (so a covered user can still enrol). */
const MFA_POLICY_EXEMPT_PREFIXES = ["auth", "csrf-token", "health", "version"];

// ─── Company policy store ──────────────────────────────────────────────────

const POLICY_TTL_MS = 30_000;
const policyCache = new Map<string, { value: CompanyMfaPolicy; at: number }>();

export function isCompanyMfaPolicy(v: unknown): v is CompanyMfaPolicy {
  return typeof v === "string" && (COMPANY_MFA_POLICIES as readonly string[]).includes(v);
}

export async function getCompanyMfaPolicy(companyId: string): Promise<CompanyMfaPolicy> {
  const hit = policyCache.get(companyId);
  if (hit && Date.now() - hit.at < POLICY_TTL_MS) return hit.value;
  const { rows } = await sql<{ require_mfa: string }>(
    `SELECT require_mfa FROM company_security_policies WHERE company_id = $1`,
    [companyId]
  );
  const value = isCompanyMfaPolicy(rows[0]?.require_mfa) ? rows[0].require_mfa : "none";
  policyCache.set(companyId, { value, at: Date.now() });
  return value;
}

export async function setCompanyMfaPolicy(
  companyId: string,
  requireMfa: CompanyMfaPolicy,
  updatedBy: string
): Promise<void> {
  await sql(
    `INSERT INTO company_security_policies (company_id, require_mfa, updated_by, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (company_id) DO UPDATE
       SET require_mfa = EXCLUDED.require_mfa, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [companyId, requireMfa, updatedBy]
  );
  policyCache.set(companyId, { value: requireMfa, at: Date.now() });
}

function sendMfaEnrollmentRequired(
  res: Response,
  requirement: { companyId: string; policy: string }
) {
  res.status(403).json({
    message: "This company requires two-factor authentication. Set it up in Security settings.",
    code: "MFA_ENROLLMENT_REQUIRED",
    details: { ...requirement, setupUrl: "/settings/security" },
  });
}

/** Check enrollment against the same authorized targets a firm handler will act on. */
export async function requireFirmCompanyMfa(
  user: Express.User,
  res: Response,
  companyIds: string[],
  exec?: Pick<AppDatabase, "execute">
): Promise<boolean> {
  if (user.isAdmin === true || companyIds.length === 0) return true;
  const requirement = await firmMfaRequirement(companyIds, user.id, exec);
  if (!requirement) return true;
  sendMfaEnrollmentRequired(res, requirement);
  return false;
}

async function companyMfaRequirement(req: Request, user: Express.User) {
  if (segs(req.path)[0]?.toLowerCase() === "firm") {
    return firmMfaRequirement(
      await firmMfaTargetCompanies(req, user, { preDispatch: true }),
      user.id
    );
  }
  const companyId = await resolveRequestCompany(req, req.path);
  if (!companyId) return undefined;
  const policy = await getCompanyMfaPolicy(companyId);
  if (policy === "none") return undefined;
  const membership = await getCompanyRole(user.id, companyId);
  if (policyCoversRole(policy, membership)) return { companyId, policy };
  if (policy === "all" && !membership && isFirmRole(user.firmRole)) {
    const ctx = await resolveFirmContext(user);
    if (ctx && (await canAccessFirmClient(ctx, companyId))) return { companyId, policy };
  }
}

// ─── Per-user state ────────────────────────────────────────────────────────

interface UserSecurityRow {
  mfa_enabled: boolean;
  email_verified: boolean;
  created_at: Date;
}

async function loadUserSecurity(userId: string): Promise<UserSecurityRow | null> {
  const { rows } = await sql<UserSecurityRow>(
    `SELECT mfa_enabled, email_verified, created_at FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

/** Use after authentication and company resolution on routes whose scope is set by the handler. */
export async function requireCompanyMfaEnrollment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (await requireFirmCompanyMfa(req.user!, res, [req.params.companyId])) next();
  } catch (err) {
    next(err);
  }
}

/**
 * Accounts that existed before email verification shipped get the full grace period
 * from the rollout date rather than being restricted on deploy.
 */
export const EMAIL_VERIFICATION_ROLLOUT_AT = new Date("2026-11-15T00:00:00Z");

export interface EmailVerificationState {
  verified: boolean;
  enforced: boolean;
  providerConfigured: boolean;
  graceDays: number;
  graceEndsAt: string | null;
  /** True when issuing documents / inviting is currently blocked. */
  restricted: boolean;
}

export function emailVerificationState(
  user: { emailVerified: boolean; createdAt: Date | string },
  now: Date = new Date()
): EmailVerificationState {
  const cfg = emailVerificationConfig();
  const created = new Date(user.createdAt);
  const start = created > EMAIL_VERIFICATION_ROLLOUT_AT ? created : EMAIL_VERIFICATION_ROLLOUT_AT;
  const graceEnds = new Date(start.getTime() + cfg.graceDays * 24 * 60 * 60 * 1000);
  const restricted = cfg.enforced && !user.emailVerified && now >= graceEnds;
  return {
    verified: user.emailVerified,
    enforced: cfg.enforced,
    providerConfigured: cfg.providerConfigured,
    graceDays: cfg.graceDays,
    graceEndsAt: user.emailVerified ? null : graceEnds.toISOString(),
    restricted,
  };
}

// ─── Step-up ───────────────────────────────────────────────────────────────

/** MFA verification time (epoch ms) carried by the request's access token, if any. */
export function requestMfaAt(req: Request): number | null {
  const v = req.authMfaAt;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function hasRecentMfa(req: Request, windowMs = mfaStepUpWindowMs()): boolean {
  const at = requestMfaAt(req);
  return at !== null && Date.now() - at <= windowMs;
}

function stepUpRequired(res: Response): void {
  res.status(403).json({
    message: "Confirm this action with your authenticator code.",
    code: "MFA_STEP_UP_REQUIRED",
    details: { stepUpUrl: "/api/auth/mfa/step-up", windowMinutes: mfaStepUpWindowMs() / 60_000 },
  });
}

/**
 * Route-level guard: `router.post(path, authMiddleware, requireRecentMfa(), handler)`.
 * Callers with MFA enabled must have verified a code within the step-up window. Callers
 * without MFA pass (unless a company policy forces enrolment, enforced centrally).
 */
export function requireRecentMfa(windowMs?: number): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      if (!req.user) {
        res.status(401).json({ message: "Authentication required", code: "AUTH_REQUIRED" });
        return;
      }
      const sec = await loadUserSecurity(req.user.id);
      if (sec?.mfa_enabled && !hasRecentMfa(req, windowMs)) return stepUpRequired(res);
      next();
    })().catch(next);
  };
}

// ─── Central middleware ────────────────────────────────────────────────────

export async function securityPolicyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const path = req.path;
    const s = segs(path);
    if (
      s.length === 0 ||
      MFA_POLICY_EXEMPT_PREFIXES.includes(s[0]) ||
      isSignedProviderCallback(req.method, path)
    )
      return next();

    const stepUp = matchRule(STEP_UP_RULES, req, path);
    const verifiedEmail = matchRule(VERIFIED_EMAIL_RULES, req, path);
    const companyScoped = s[0] === "companies" && !!s[1];
    if (!stepUp && !verifiedEmail && !companyScoped && !s[1]) return next();

    const auth = await authenticateRequest(req);
    if (!auth || "code" in auth) return next(); // the route answers 401
    const user = auth.user;
    req.authMfaAt = auth.mfaAt ?? null;
    const sec = await loadUserSecurity(user.id);
    if (!sec) return next();

    // 1. Company MFA policy.
    if (!sec.mfa_enabled && user.isAdmin !== true) {
      const requirement = await companyMfaRequirement(req, user);
      if (requirement) {
        sendMfaEnrollmentRequired(res, requirement);
        return;
      }
    }

    // 2. Step-up for sensitive actions.
    if (stepUp && sec.mfa_enabled && !hasRecentMfa(req)) return stepUpRequired(res);

    // 3. Email verification gating.
    if (verifiedEmail) {
      const state = emailVerificationState({
        emailVerified: sec.email_verified,
        createdAt: sec.created_at,
      });
      if (state.restricted) {
        res.status(403).json({
          message:
            "Verify your email address to issue documents or invite people. We sent you a link; you can request a new one in Security settings.",
          code: "EMAIL_VERIFICATION_REQUIRED",
          details: { graceEndsAt: state.graceEndsAt, resendUrl: "/api/auth/verify-email/resend" },
        });
        return;
      }
    }
    next();
  } catch (err) {
    log.error({ requestId: req.id }, "security policy check failed");
    next(err);
  }
}
