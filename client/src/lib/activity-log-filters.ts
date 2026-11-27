// Filtering for the admin Activity logs screen. Stored actions are dotted/underscored codes
// (`invoice.create`, `ai_gl_draft_created`), while the dropdown offers plain verbs.
import { activityActionLabel, activityEntityLabel, activitySentence } from "./activity-log-labels";
import type { ActivityLogLike } from "./activity-log-labels";

const actionAliases: Record<string, string> = {
  created: "create",
  add: "create",
  updated: "update",
  edit: "update",
  deleted: "delete",
  remove: "delete",
};

export function matchesActionFilter(action: string, filter: string): boolean {
  if (filter === "all") return true;
  return action
    .toLowerCase()
    .split(/[._-]+/)
    .some((word) => word === filter || actionAliases[word] === filter);
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
