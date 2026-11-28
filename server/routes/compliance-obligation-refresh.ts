/**
 * Compliance obligation refresh observer (S4, W4-A follow-up).
 *
 * The compliance calendar/overview GETs are read-only. The stored calendar
 * (reminders, manual completion, task feed) is refreshed:
 *
 *   - by the daily job `compliance.deadlineScan`;
 *   - by POST /api/companies/:companyId/compliance-calendar/generate;
 *   - here, after a successful write that changes an obligation input:
 *     company create/settings (VAT stagger, frequency, TRN, fiscal year,
 *     CT TRN), the corporate-tax profile (licence expiry, excise, UBO), VAT
 *     returns / workpapers / autopilot periods (filings), corporate-tax
 *     returns, employees and payroll runs (WPS).
 *
 * The refresh runs after the response is sent, one at a time per company, and
 * never fails the request. Reads stay correct meanwhile because they merge the
 * live obligation specs (compliance-obligations.service listCalendar).
 */
import type { NextFunction, Request, Response } from "express";
import { createLogger } from "../config/logger";
import { resolveRequestCompany } from "../middleware/companyRolePolicy";
import { ensureGenerated } from "../services/compliance-obligations.service";

const log = createLogger("compliance-obligation-refresh");

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Paths below /api whose successful writes change obligation inputs. */
const OBLIGATION_INPUT_PATHS: readonly RegExp[] = [
  /^\/companies\/[^/]+\/?$/,
  /^\/companies\/[^/]+\/preferences\/?$/,
  /^\/companies\/[^/]+\/corporate-tax\/(profile|returns)(\/|$)/,
  /^\/corporate-tax\/returns\/[^/]+(\/|$)/,
  /^\/companies\/[^/]+\/vat-returns(\/|$)/,
  /^\/vat-returns\/[^/]+(\/|$)/,
  /^\/companies\/[^/]+\/vat-workpapers\/[^/]+\/(status|generate-return)\/?$/,
  /^\/vat\/autopilot\/periods\/[^/]+\/status\/?$/,
  /^\/companies\/[^/]+\/employees(\/|$)/,
  /^\/employees\/[^/]+(\/|$)/,
  /^\/companies\/[^/]+\/payroll-runs\/?$/,
  /^\/payroll-runs\/[^/]+\/(pay|unpay|approve|unapprove)\/?$/,
];

/** POST /api/companies creates a company; its id comes from the response body. */
const COMPANY_CREATE = /^\/companies\/?$/;

export function isObligationInputWrite(method: string, path: string): boolean {
  if (!MUTATIONS.has(method.toUpperCase())) return false;
  if (method.toUpperCase() === "POST" && COMPANY_CREATE.test(path)) return true;
  return OBLIGATION_INPUT_PATHS.some((re) => re.test(path));
}

const queues = new Map<string, Promise<void>>();
const pendingAgain = new Set<string>();

/** Queue a stored-calendar refresh for one company (coalesced, serialised). */
export function scheduleObligationRefresh(companyId: string): Promise<void> {
  const running = queues.get(companyId);
  if (running) {
    // A refresh is in flight; make sure one more runs after it with fresh inputs.
    pendingAgain.add(companyId);
    return running;
  }
  const run = (async () => {
    do {
      pendingAgain.delete(companyId);
      try {
        await ensureGenerated(companyId);
      } catch (err) {
        log.warn({ companyId, err: (err as Error).message }, "obligation refresh failed");
      }
    } while (pendingAgain.has(companyId));
  })().finally(() => queues.delete(companyId));
  queues.set(companyId, run);
  return run;
}

/** Wait for every queued refresh (tests, graceful shutdown). */
export async function flushObligationRefreshes(): Promise<void> {
  while (queues.size > 0) await Promise.all([...queues.values()]);
}

/** Express middleware mounted on /api (server/routes.ts). */
export function complianceObligationRefreshObserver(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isObligationInputWrite(req.method, req.path)) return next();
  const path = req.path;
  const creating = req.method.toUpperCase() === "POST" && COMPANY_CREATE.test(path);
  let createdId: string | null = null;
  if (creating) {
    const json = res.json.bind(res);
    res.json = ((body: unknown) => {
      const id = (body as { id?: unknown } | null)?.id;
      if (typeof id === "string") createdId = id;
      return json(body);
    }) as Response["json"];
  }
  // Resolve the company before the handler runs (a DELETE removes the row).
  const resolved: Promise<string | null> = creating
    ? Promise.resolve(null)
    : resolveRequestCompany(req, path).catch(() => null);
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    void resolved.then((companyId) => {
      const id = creating ? createdId : companyId;
      if (id) void scheduleObligationRefresh(id);
    });
  });
  next();
}
