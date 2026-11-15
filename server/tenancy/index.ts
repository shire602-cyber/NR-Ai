/**
 * Tenant-scoped data access helpers (W2-C, R01-01).
 *
 * Every lookup of a tenant-owned row by id MUST also filter by the company
 * the caller was authorised for. Loading by id alone and checking the
 * company afterwards (or never) is how the team IDOR happened: the owner of
 * company A could PUT /api/companies/A/team/<membership id of company B>.
 *
 *   const member = await scopedUpdate(companyUsers, companyId, memberId, { role });
 *   if (!member) throw new DomainError("NOT_FOUND", 404);
 *
 *   router.delete("/api/companies/:companyId/things/:id",
 *     authMiddleware,
 *     requireOwned((req) => scopedGet(things, req.params.companyId, req.params.id)),
 *     handler); // handler reads res.locals.owned
 *
 * A row in another tenant is indistinguishable from a missing row: callers
 * answer 404, never 403, so ids cannot be probed across tenants.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq, type InferSelectModel, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "../db";

/** A Drizzle table with `id` and `companyId` columns. */
export type TenantTable = PgTable & { id: PgColumn; companyId: PgColumn };
export type TenantRow<T extends TenantTable> = InferSelectModel<T>;

// Drizzle's builder types cannot express "any table with these two columns"
// generically, so the builder is used through this narrow structural view.
interface LooseBuilder {
  select(): {
    from(t: PgTable): { where(w: SQL | undefined): { limit(n: number): Promise<unknown[]> } };
  };
  update(t: PgTable): {
    set(v: Record<string, unknown>): {
      where(w: SQL | undefined): { returning(): Promise<unknown[]> };
    };
  };
  delete(t: PgTable): { where(w: SQL | undefined): { returning(): Promise<unknown[]> } };
}
const loose = db as unknown as LooseBuilder;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when both ids are UUID-shaped (anything else can never match a row). */
export function isScopedIdPair(companyId: unknown, id: unknown): boolean {
  return (
    typeof companyId === "string" &&
    typeof id === "string" &&
    UUID_RE.test(companyId) &&
    UUID_RE.test(id)
  );
}

function scope<T extends TenantTable>(table: T, companyId: string, id: string): SQL | undefined {
  return and(eq(table.id, id), eq(table.companyId, companyId));
}

export async function scopedGet<T extends TenantTable>(
  table: T,
  companyId: string,
  id: string
): Promise<TenantRow<T> | undefined> {
  if (!isScopedIdPair(companyId, id)) return undefined;
  const rows = await loose
    .select()
    .from(table)
    .where(scope(table, companyId, id))
    .limit(1);
  return rows[0] as TenantRow<T> | undefined;
}

export async function scopedUpdate<T extends TenantTable>(
  table: T,
  companyId: string,
  id: string,
  data: Partial<TenantRow<T>>
): Promise<TenantRow<T> | undefined> {
  if (!isScopedIdPair(companyId, id)) return undefined;
  // Never let an update move a row into another tenant or change its id.
  const { companyId: _c, id: _i, ...rest } = data as Record<string, unknown>;
  if (Object.keys(rest).length === 0) return scopedGet(table, companyId, id);
  const rows = await loose
    .update(table)
    .set(rest)
    .where(scope(table, companyId, id))
    .returning();
  return rows[0] as TenantRow<T> | undefined;
}

export async function scopedDelete<T extends TenantTable>(
  table: T,
  companyId: string,
  id: string
): Promise<boolean> {
  if (!isScopedIdPair(companyId, id)) return false;
  const rows = await loose
    .delete(table)
    .where(scope(table, companyId, id))
    .returning();
  return rows.length > 0;
}

/**
 * Middleware: run `loader`; a falsy result answers 404 NOT_FOUND, otherwise
 * the row is stored on res.locals[key] (default "owned") for the handler.
 */
export function requireOwned<R>(
  loader: (req: Request) => Promise<R | null | undefined>,
  opts: { key?: string; notFoundMessage?: string } = {}
): RequestHandler {
  const key = opts.key ?? "owned";
  return (req: Request, res: Response, next: NextFunction) => {
    loader(req)
      .then((row) => {
        if (!row) {
          res.status(404).json({ message: opts.notFoundMessage ?? "Not found", code: "NOT_FOUND" });
          return;
        }
        res.locals[key] = row;
        next();
      })
      .catch(next);
  };
}
