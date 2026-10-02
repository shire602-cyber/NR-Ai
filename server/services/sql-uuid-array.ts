// drizzle expands a JS array bound into raw sql`` as a parenthesised tuple, which Postgres cannot cast to uuid[].
// uuidArray builds an explicit ARRAY[...]::uuid[] from the ids (callers return early for an empty list).
import { sql } from "drizzle-orm";

export function uuidArray(ids: string[]) {
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  )}]::uuid[]`;
}
