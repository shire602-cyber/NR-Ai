/**
 * Late-bound cross-module service lookup. A module registers a capability
 * once at startup; consumers resolve it by name at call time, so modules do
 * not import each other (and optional modules can be absent).
 *
 *   provide("ledger.postJournal", postJournal);          // provider module
 *   const post = resolve<PostJournal>("ledger.postJournal"); // consumer
 *   if (has("ai.classify")) { ... }
 *
 * resolve() of a missing service throws DomainError("SERVICE_UNAVAILABLE", 503)
 * so an HTTP caller gets a clean 503 rather than a TypeError/500.
 *
 * Naming: "<module>.<verb>" (e.g. "einvoice.submit", "fx.rateFor").
 */
import { DomainError } from "../errors";

type ServiceFn = (...args: never[]) => unknown;

const services = new Map<string, ServiceFn>();

const NAME = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/;

/**
 * Register `fn` under `name`. Re-providing the same name throws unless
 * `{ replace: true }` (tests, hot reload).
 */
export function provide<F extends ServiceFn>(
  name: string,
  fn: F,
  opts: { replace?: boolean } = {}
): void {
  if (!NAME.test(name)) throw new Error(`Invalid service name "${name}" (use "module.verb")`);
  if (typeof fn !== "function") throw new Error(`Service "${name}" must be a function`);
  if (services.has(name) && !opts.replace) throw new Error(`Service "${name}" already provided`);
  services.set(name, fn);
}

/** Look up a service. Throws DomainError SERVICE_UNAVAILABLE (503) when absent. */
export function resolve<F extends ServiceFn>(name: string): F {
  const fn = services.get(name);
  if (!fn) {
    throw new DomainError(
      "SERVICE_UNAVAILABLE",
      503,
      { service: name },
      `Service "${name}" is not available`
    );
  }
  return fn as F;
}

export function has(name: string): boolean {
  return services.has(name);
}

/** Names currently provided (diagnostics). */
export function listServices(): string[] {
  return [...services.keys()].sort();
}

/** Remove one service, or all when no name is given. Tests only. */
export function resetServices(name?: string): void {
  if (name) services.delete(name);
  else services.clear();
}
