import { sql } from "drizzle-orm";
import { notifications } from "../../shared/schema";
import { RETIRED_BANK_NOTIFICATION_PREFIX } from "../../shared/notification-copy";

/** Legacy provider alerts stay in storage for historical records. */
export function customerVisibleNotification() {
  return sql`starts_with(${notifications.eventKey}, ${RETIRED_BANK_NOTIFICATION_PREFIX}) IS NOT TRUE`;
}
