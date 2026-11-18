/**
 * Plan refusals from the server (server/middleware/featureGate.ts) carry a stable code and an
 * upgrade hint. Any API call that receives one announces it, and the app-level PlanLimitDialog
 * shows the upgrade prompt, so every locked write explains itself the same way.
 */
export const PLAN_LIMIT_CODES = [
  "PLAN_REQUIRED",
  "TIER_LOCKED",
  "USAGE_LIMIT_REACHED",
  "STORAGE_LIMIT_REACHED",
  "COMPANY_LIMIT_REACHED",
] as const;
export type PlanLimitCode = (typeof PLAN_LIMIT_CODES)[number];

export interface PlanLimitDetail {
  code: PlanLimitCode;
  feature?: string;
  resource?: string;
  requiredPlan?: string;
  limit?: number;
}

export const PLAN_LIMIT_EVENT = "muhasib:plan-limit";

export function isPlanLimitBody(body: unknown): body is { code: PlanLimitCode } {
  const code = (body as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && (PLAN_LIMIT_CODES as readonly string[]).includes(code);
}

export function planLimitDetail(body: Record<string, unknown>): PlanLimitDetail {
  const upgrade = (body.upgrade ?? {}) as { requiredPlan?: unknown };
  return {
    code: body.code as PlanLimitCode,
    feature: typeof body.feature === "string" ? body.feature : undefined,
    resource: typeof body.resource === "string" ? body.resource : undefined,
    requiredPlan:
      typeof upgrade.requiredPlan === "string"
        ? upgrade.requiredPlan
        : typeof body.requiredTier === "string"
          ? body.requiredTier
          : undefined,
    limit: typeof body.limit === "number" ? body.limit : undefined,
  };
}

export function announcePlanLimit(body: Record<string, unknown> | undefined): void {
  if (!body || !isPlanLimitBody(body) || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PLAN_LIMIT_EVENT, { detail: planLimitDetail(body) }));
}
