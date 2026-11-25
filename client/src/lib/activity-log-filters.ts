// Filtering for the admin Activity logs screen. Stored actions are dotted/underscored codes
// (`invoice.create`, `auth.login_success`), while the action dropdown offers plain verbs
// ("create", "login"); a verb matches when it is one of the code's words.
import { activityActionLabel, activityEntityLabel, activitySentence } from "./activity-log-labels";
import type { ActivityLogLike } from "./activity-log-labels";

export function matchesActionFilter(action: string, filter: string): boolean {
  if (filter === "all") return true;
  if (action === filter) return true;
  return action
    .toLowerCase()
    .split(/[._-]+/)
    .includes(filter);
}

/** Text a user can search: the sentence as displayed (so Arabic mode searches Arabic), the
 *  action and entity labels, and the raw server description. */
export function activitySearchText(
  t: Record<string, string>,
  log: ActivityLogLike,
  locale: string,
  extra: Array<string | null | undefined> = []
): string {
  return [
    activitySentence(t, log, locale),
    activityActionLabel(t, log.action),
    activityEntityLabel(t, log.entityType ?? log.resourceType ?? ""),
    log.description,
    ...extra,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
