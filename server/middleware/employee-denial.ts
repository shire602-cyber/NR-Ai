// An employee-role member is limited to their own HR records. storage.hasCompanyAccess refuses their membership unless
// the caller opts in (employee self-service), and the refusal is flagged here so every route answers the same way:
// 403 { code: "ROLE_REQUIRED" }, whatever status or text the route itself would have used (403 "Access denied" or a
// 404 that hides the record). The client keys its "your role only covers your own HR records" screen on the code.

import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

export const EMPLOYEE_ROLE_REFUSAL = { message: "Your role only covers your own HR records.", code: "ROLE_REQUIRED" } as const;

type DenialContext = { employeeRefused: boolean };
const context = new AsyncLocalStorage<DenialContext>();

/** Called by storage.hasCompanyAccess when it refuses an employee-role membership. A no-op outside a request. */
export function markEmployeeRefused(): void {
  const store = context.getStore();
  if (store) store.employeeRefused = true;
}

/** True when an employee-role refusal happened during the current request. */
export function wasEmployeeRefused(): boolean {
  return context.getStore()?.employeeRefused === true;
}

/** Install first: opens the per-request context and rewrites a flagged 403/404 JSON answer to ROLE_REQUIRED. */
export function employeeDenialContext(_req: Request, res: Response, next: NextFunction): void {
  const store: DenialContext = { employeeRefused: false };
  const json = res.json.bind(res);
  res.json = ((body?: unknown) => {
    if (store.employeeRefused && (res.statusCode === 403 || res.statusCode === 404)) {
      res.status(403);
      return json(EMPLOYEE_ROLE_REFUSAL);
    }
    return json(body);
  }) as Response["json"];
  context.run(store, next);
}
