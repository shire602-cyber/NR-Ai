/**
 * Schema-introspecting row factory for the DB harness.
 *
 * insertRow(sql, table, ctx, overrides) inserts a minimal valid row into any
 * table by reading information_schema: NOT NULL columns without defaults get
 * type-appropriate dummy values, `company_id` always points at the tenant,
 * user references point at the tenant's user, and other required foreign keys
 * are satisfied by recursively creating parent rows (or re-using a parent
 * created earlier for the same request, so nested route params line up).
 * CHECK constraints of the `col = ANY (ARRAY['a','b'])` / `col IN (...)` form
 * are learned on failure and retried.
 *
 * It exists so the cross-tenant route matrix can create a resource for every
 * `:id` route without a hand-written fixture per table. Prefer API-level
 * fixtures for behaviour tests.
 */
import { randomBytes, randomUUID } from "node:crypto";

export type SqlFn = <T = any>(text: string, params?: unknown[]) => Promise<T[]>;

export interface RowContext {
  companyId: string;
  userId: string;
  /** Rows already created for this request, by table name. */
  created?: Map<string, string>;
}

interface ColumnInfo {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
}

interface FkInfo {
  column_name: string;
  ref_table: string;
  ref_column: string;
}

const columnCache = new Map<string, ColumnInfo[]>();
const fkCache = new Map<string, FkInfo[]>();
const enumCache = new Map<string, string[]>();
const learnedValues = new Map<string, Record<string, unknown>>();

async function columns(sql: SqlFn, table: string): Promise<ColumnInfo[]> {
  if (!columnCache.has(table)) {
    columnCache.set(
      table,
      await sql<ColumnInfo>(
        `SELECT column_name, data_type, udt_name, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [table]
      )
    );
  }
  return columnCache.get(table)!;
}

async function foreignKeys(sql: SqlFn, table: string): Promise<FkInfo[]> {
  if (!fkCache.has(table)) {
    fkCache.set(
      table,
      await sql<FkInfo>(
        `SELECT a.attname AS column_name, rt.relname AS ref_table, ra.attname AS ref_column
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_class rt ON rt.oid = c.confrelid
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
           JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
          WHERE c.contype = 'f' AND t.relname = $1 AND array_length(c.conkey, 1) = 1`,
        [table]
      )
    );
  }
  return fkCache.get(table)!;
}

async function enumLabels(sql: SqlFn, udt: string): Promise<string[]> {
  if (!enumCache.has(udt)) {
    const rows = await sql<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = $1 ORDER BY e.enumsortorder`,
      [udt]
    );
    enumCache.set(
      udt,
      rows.map((r) => r.enumlabel)
    );
  }
  return enumCache.get(udt)!;
}

function rand(): string {
  return randomBytes(4).toString("hex");
}

async function dummyValue(sql: SqlFn, col: ColumnInfo): Promise<unknown> {
  const t = col.data_type;
  if (col.udt_name === "uuid") return randomUUID();
  if (t === "USER-DEFINED") {
    const labels = await enumLabels(sql, col.udt_name);
    return labels[0] ?? null;
  }
  if (t === "ARRAY") return "{}";
  if (t === "boolean") return false;
  if (["integer", "bigint", "smallint"].includes(t)) return 1;
  if (["numeric", "double precision", "real"].includes(t)) return "1.00";
  if (t === "date") return "2026-01-15";
  if (t.startsWith("timestamp")) return new Date("2026-01-15T10:00:00Z");
  if (t === "json" || t === "jsonb") return "{}";
  if (col.column_name.includes("email")) return `xt-${rand()}@harness.test`;
  if (col.column_name.includes("currency")) return "AED";
  return `xt-${rand()}`;
}

function parseCheckFirstValue(def: string): { column: string; value: string } | null {
  // e.g. CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text])))
  //      CHECK (((type)::text = ANY ((ARRAY['a'::character varying])::text[])))
  //      CHECK ((role IN ('x','y')))
  const m = def.match(
    /\(+\s*"?([a-z_]+)"?\s*\)?(?:::[a-z ]+)?\)?\s*(?:=\s*ANY|IN)\s*\(+(?:ARRAY\[)?\s*'([^']*)'/i
  );
  if (!m) return null;
  return { column: m[1], value: m[2] };
}

/**
 * Insert one row and return its id. `overrides` win over everything else.
 */
export async function insertRow(
  sql: SqlFn,
  table: string,
  ctx: RowContext,
  overrides: Record<string, unknown> = {},
  depth = 0
): Promise<string> {
  if (depth > 4) throw new Error(`insertRow: FK recursion too deep at ${table}`);
  const created = ctx.created ?? new Map<string, string>();
  ctx.created = created;
  const cols = await columns(sql, table);
  if (!cols.length) throw new Error(`insertRow: unknown table ${table}`);
  const fks = await foreignKeys(sql, table);
  const fkByCol = new Map(fks.map((f) => [f.column_name, f]));
  const values: Record<string, unknown> = {};

  for (const col of cols) {
    const name = col.column_name;
    if (name in overrides) continue;
    const fk = fkByCol.get(name);
    const required = col.is_nullable === "NO" && col.column_default === null;
    if (name === "company_id" || (fk && fk.ref_table === "companies")) {
      values[name] = ctx.companyId;
      continue;
    }
    if (fk && fk.ref_table === "users") {
      values[name] = ctx.userId;
      continue;
    }
    if (fk && created.has(fk.ref_table)) {
      values[name] = created.get(fk.ref_table);
      continue;
    }
    if (!required) continue;
    if (fk) {
      if (fk.ref_table === table) continue;
      values[name] = await insertRow(sql, fk.ref_table, ctx, {}, depth + 1);
      continue;
    }
    values[name] = await dummyValue(sql, col);
  }
  Object.assign(values, learnedValues.get(table) ?? {}, overrides);

  for (let attempt = 0; attempt < 24; attempt++) {
    const keys = Object.keys(values);
    const text = keys.length
      ? `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")})
           VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`
      : `INSERT INTO "${table}" DEFAULT VALUES RETURNING *`;
    try {
      const rows = await sql<Record<string, any>>(
        text,
        keys.map((k) => values[k])
      );
      const row = rows[0];
      const id = row.id ?? row[Object.keys(row)[0]];
      if (!created.has(table)) created.set(table, String(id));
      return String(id);
    } catch (err: any) {
      if (err?.code === "23514" && err.constraint) {
        const defs = await sql<{ def: string }>(
          `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
            WHERE c.conname = $1 AND t.relname = $2`,
          [err.constraint, table]
        );
        const parsed = defs[0] ? parseCheckFirstValue(defs[0].def) : null;
        if (parsed && !(parsed.column in overrides)) {
          values[parsed.column] = parsed.value;
          learnedValues.set(table, {
            ...(learnedValues.get(table) ?? {}),
            [parsed.column]: parsed.value,
          });
          continue;
        }
      }
      if (err?.code === "23505") {
        // Unique clash on a dummy text value — re-roll text columns.
        for (const col of cols) {
          const k = col.column_name;
          if (k in overrides || !(k in values)) continue;
          if (typeof values[k] === "string" && String(values[k]).startsWith("xt-")) {
            values[k] = col.column_name.includes("email")
              ? `xt-${rand()}@harness.test`
              : `xt-${rand()}`;
          } else if (["integer", "bigint", "smallint"].includes(col.data_type)) {
            values[k] = 1 + Math.floor(Math.random() * 30_000);
          } else if (col.data_type === "date" || col.data_type.startsWith("timestamp")) {
            const d = new Date(Date.UTC(2000 + Math.floor(Math.random() * 25), 0, 1));
            d.setUTCDate(1 + Math.floor(Math.random() * 360));
            values[k] = col.data_type === "date" ? d.toISOString().slice(0, 10) : d;
          }
        }
        continue;
      }
      if (err?.code === "23502" && err.column && !(err.column in values)) {
        const col = cols.find((c) => c.column_name === err.column);
        if (col) {
          values[err.column] = await dummyValue(sql, col);
          continue;
        }
      }
      throw new Error(`insertRow(${table}) failed: ${err?.code ?? ""} ${err?.message ?? err}`);
    }
  }
  throw new Error(`insertRow(${table}) gave up after retries`);
}

/** JSON snapshot of a row (null when it no longer exists). */
export async function snapshotRow(sql: SqlFn, table: string, id: string): Promise<string | null> {
  const rows = await sql<{ j: unknown }>(
    `SELECT to_jsonb(t) AS j FROM "${table}" t WHERE t.id::text = $1`,
    [id]
  );
  return rows[0] ? JSON.stringify(rows[0].j) : null;
}
