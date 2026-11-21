import { and, eq, exists, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  companies,
  companyUsers,
  firmStaffAssignments,
  notifications,
  users,
} from "../../shared/schema";
import { RETIRED_BANK_NOTIFICATION_PREFIX } from "../../shared/notification-copy";
import { firmClientCondition, NR_FIRM_ID } from "../services/firm/scope";

/** Company notices need current access at the point a stored row is read or acted on. */
export function customerVisibleNotification() {
  const membership = db
    .select({ id: companyUsers.id })
    .from(companyUsers)
    .where(and(eq(companyUsers.companyId, companies.id), eq(companyUsers.userId, users.id)));
  const assignment = db
    .select({ id: firmStaffAssignments.id })
    .from(firmStaffAssignments)
    .where(
      and(
        eq(firmStaffAssignments.companyId, companies.id),
        eq(firmStaffAssignments.userId, users.id)
      )
    );
  // Match the direct membership and legacy NR portfolio access used by hasCompanyAccess.
  const currentAccess = db
    .select({ id: companies.id })
    .from(companies)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(
      and(
        eq(companies.id, notifications.companyId),
        isNull(companies.deletedAt),
        ne(users.userType, "client_portal"),
        or(
          exists(membership),
          and(
            firmClientCondition(NR_FIRM_ID, true),
            or(
              eq(users.firmRole, "firm_owner"),
              and(eq(users.firmRole, "firm_admin"), exists(assignment))
            )
          )
        )
      )
    );
  return and(
    sql`starts_with(${notifications.eventKey}, ${RETIRED_BANK_NOTIFICATION_PREFIX}) IS NOT TRUE`,
    or(isNull(notifications.companyId), exists(currentAccess))
  );
}
