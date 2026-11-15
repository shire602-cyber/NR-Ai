import type { z } from "zod";

/**
 * S-M1 (mass-assignment guard): return a copy of `body` containing ONLY the
 * keys defined on `schema` (a drizzle-zod insert schema, which already omits
 * id/createdAt). This strips unknown/system fields before the object is spread
 * into a Drizzle write, without type-coercing values (so it won't reject
 * otherwise-valid payloads — e.g. date strings normalized downstream).
 *
 * Optionally drop additional keys (e.g. `companyId` on an update path).
 */
export function pickAllowed<T extends z.ZodObject<z.ZodRawShape>>(
  body: unknown,
  schema: T,
  omitKeys: string[] = []
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== "object") return out;
  const src = body as Record<string, unknown>;
  const omit = new Set(omitKeys);
  for (const key of Object.keys(schema.shape)) {
    if (omit.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key];
  }
  return out;
}
