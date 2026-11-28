import type { RequestHandler } from "express";
import { storage } from "../storage";
import { DomainError } from "../errors";
import { authenticateRequest } from "./auth";
import { isSignedProviderCallback, resolveRequestCompany } from "./companyRolePolicy";
import {
  billingEnforced,
  companyEntitlement,
  refuseExpiredTrial,
  TRIAL_LOCK_MESSAGE,
} from "./featureGate";

export function bypassesTrialLock(user: { isAdmin?: boolean; firmRole?: string | null }): boolean {
  return user.isAdmin === true || !!user.firmRole;
}

export async function companyTrialLocked(companyId: string): Promise<boolean> {
  return (await companyEntitlement(companyId))?.state === "expired";
}

export async function assertTrialAccess(companyId: string, user: Express.User): Promise<void> {
  if (billingEnforced() && !bypassesTrialLock(user) && (await companyTrialLocked(companyId))) {
    throw new DomainError("PLAN_REQUIRED", 402, { companyId }, TRIAL_LOCK_MESSAGE);
  }
}

/** Billing recovers the workspace. Identity and separately authorised public links stay usable. */
function isTrialRecoveryRequest(method: string, path: string): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(method) || isSignedProviderCallback(method, path))
    return true;
  if (/^\/companies\/[^/]+\/billing(?:\/|$)/i.test(path)) return true;
  // Reading your own data out stays possible after the trial: taking a current full backup.
  // Only the create route is lifted; restore, clone and delete stay locked, and the route keeps
  // its own auth, backups.manage RBAC and tenant checks.
  if (method === "POST" && /^\/companies\/[^/]+\/backups$/i.test(path)) return true;
  if (
    /^\/(auth|billing|admin|firm|nra|client-portal|portal-invitations|public|payslips|team-invitations|invitations)(\/|$)/i.test(
      path
    )
  ) {
    return true;
  }
  return (
    /^\/portal\//i.test(path) &&
    !/^\/portal\/(generate-access|revoke-access|contacts)(\/|$)/i.test(path)
  );
}

/** Keep expired workspaces readable and block writes before workspace handlers run. */
export const trialAccessPolicy: RequestHandler = async (req, res, next) => {
  try {
    const path = req.path.replace(/\/+$/, "").toLowerCase();
    if (!billingEnforced() || isTrialRecoveryRequest(req.method, path)) return next();
    const auth = await authenticateRequest(req);
    if (!auth || "code" in auth || bypassesTrialLock(auth.user)) return next();

    // These handlers return data for the account across companies.
    const accountWide = /^\/notifications(?:\/|$)/.test(path) || path === "/analytics/my-dashboard";
    const companyId = accountWide ? null : await resolveRequestCompany(req, path);
    if (companyId) {
      // Preserve the route's authorization response for users outside the tenant.
      if (
        !req.companyRole &&
        !(await storage.hasCompanyAccess(auth.user.id, companyId, auth.user.firmRole))
      ) {
        return next();
      }
      if (await companyTrialLocked(companyId)) {
        return refuseExpiredTrial(res, companyId);
      }
      return next();
    }

    // Some workspace routes are account-scoped and have no company ID, e.g. notifications.
    const companies = await storage.getCompaniesByUserId(auth.user.id);
    if (companies.length > 0) {
      const locks = await Promise.all(companies.map(({ id }) => companyTrialLocked(id)));
      if (locks.every(Boolean)) return refuseExpiredTrial(res);
      if (locks.some(Boolean) && (accountWide || path === "/vat/autopilot/due-dates")) {
        return refuseExpiredTrial(res);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};
