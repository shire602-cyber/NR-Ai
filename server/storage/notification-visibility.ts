import { and, eq, exists, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  companies,
  companyUsers,
  firmStaffAssignments,
  notifications,
  users,
} from "../../shared/schema";
import {
  LEGACY_BANK_RECONCILIATION_NOTICE,
  RETIRED_BANK_NOTIFICATION_PREFIX,
} from "../../shared/notification-copy";
import { firmClientCondition, NR_FIRM_ID } from "../services/firm/scope";

// The same pattern runs in PostgreSQL for inbox queries and in JavaScript for stored emails.
const retiredCopyPattern = String.raw`(^|[^a-z0-9_])(?:bank(?:\s|[‑–—-])+feeds?|live\s+(?:bank\s+)?feeds?|open(?:\s|-)+banking)([^a-z0-9_]|$)|الربط\s+(?:البنكي|المصرفي)|مزامنة\s+(?:الحساب|الخلاصة)\s+البنكي`;
const retiredCopy = new RegExp(retiredCopyPattern, "i");

export function containsRetiredNotificationCopy(text: string): boolean {
  return retiredCopy.test(text);
}

function companyNoticeAccess() {
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
  return and(
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
  );
}

/** Company notices need current access at the point a stored row is read or acted on. */
export function customerVisibleNotification({ refreshingDigest = false } = {}) {
  const currentAccess = db
    .select({ id: companies.id })
    .from(companies)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(eq(companies.id, notifications.companyId), companyNoticeAccess()));
  const visibleCopy = and(
    sql`starts_with(${notifications.eventKey}, ${RETIRED_BANK_NOTIFICATION_PREFIX}) IS NOT TRUE`,
    sql`concat(${notifications.title}, ' ', ${notifications.message}) !~* ${retiredCopyPattern}`
  );
  // A queued digest can recover this known reminder by replacing its copy before delivery.
  const legacyReminder = refreshingDigest
    ? and(
        eq(notifications.title, LEGACY_BANK_RECONCILIATION_NOTICE.title),
        eq(notifications.message, LEGACY_BANK_RECONCILIATION_NOTICE.message)
      )
    : undefined;
  return and(
    or(visibleCopy, legacyReminder),
    or(isNull(notifications.companyId), exists(currentAccess))
  );
}

export async function canDeliverCompanyNotification(
  userId: string,
  email: string,
  companyId: string
): Promise<boolean> {
  const [recipient] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(companies, eq(companies.id, companyId))
    .where(
      and(eq(users.id, userId), sql`lower(${users.email}) = lower(${email})`, companyNoticeAccess())
    )
    .limit(1);
  return !!recipient;
}
