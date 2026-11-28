import { and, eq, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { FIRM_ROLES } from "../../../shared/access";
import { firmMembers, users } from "../../../shared/schema";
import type { db } from "../../db";
import { DomainError } from "../../errors";
import { NR_FIRM_ID } from "./scope";

/** Lock after the affected user and before any client locks. */
export async function lockFirmMembership(exec: Pick<typeof db, "execute">, firmId: string) {
  await exec.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('firm_membership'), hashtext(${firmId.toLowerCase()}))`
  );
}

/** Check actual owners while holding the firm membership lock. */
export async function firmHasOwner(
  exec: Pick<typeof db, "select">,
  firmId: string,
  exceptUserId?: string
): Promise<boolean> {
  const [owner] = await exec
    .select({ id: users.id })
    .from(users)
    .leftJoin(
      firmMembers,
      and(
        eq(firmMembers.userId, users.id),
        eq(firmMembers.firmId, firmId),
        eq(firmMembers.role, "firm_owner")
      )
    )
    .where(
      and(
        ne(users.userType, "client_portal"),
        exceptUserId ? ne(users.id, exceptUserId) : undefined,
        or(
          firmId === NR_FIRM_ID ? eq(users.firmRole, "firm_owner") : undefined,
          and(
            isNotNull(firmMembers.userId),
            firmId === NR_FIRM_ID ? undefined : eq(users.isAdmin, false),
            or(isNull(users.firmRole), notInArray(users.firmRole, [...FIRM_ROLES]))
          )
        )
      )
    )
    .limit(1);
  return Boolean(owner);
}

export async function requireFirmOwner(
  exec: Pick<typeof db, "select">,
  firmId: string,
  exceptUserId?: string
) {
  if (!(await firmHasOwner(exec, firmId, exceptUserId))) {
    throw new DomainError("LAST_FIRM_OWNER", 409);
  }
}
