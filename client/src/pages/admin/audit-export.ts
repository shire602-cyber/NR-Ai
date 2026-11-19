/**
 * Admin > Audit log (STEP1 F6): the search box, the action filter and "Export" work on the same
 * localised rows the table shows. Pure helpers so they are unit-tested.
 */
import { activityActionLabel, activityEntityLabel, withoutIds } from "@/lib/activity-log-labels";
import { formatDateTime } from "@/lib/format-date";
import { auditDetailEntries } from "@/pages/admin/audit-details";

export interface AuditRow {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string;
  details: string | null;
  ipAddress: string | null;
  createdAt: string | Date;
}

type Translations = Record<string, string>;

export function auditActor(
  t: Translations,
  log: AuditRow,
  users: ReadonlyArray<{ id: string; name?: string | null; email?: string | null }>
): string {
  if (!log.userId) return t["shell.themeSystem"];
  const actor = users.find((u) => u.id === log.userId);
  return actor?.name ?? actor?.email ?? t["settingsPages.auditUnknownUser"];
}

export function filterAuditLogs<T extends AuditRow>(
  t: Translations,
  logs: readonly T[],
  users: ReadonlyArray<{ id: string; name?: string | null; email?: string | null }>,
  { search, action }: { search: string; action: string }
): T[] {
  const needle = search.trim().toLowerCase();
  return logs.filter((log) => {
    if (action !== "all" && !log.action.toLowerCase().includes(action)) return false;
    if (!needle) return true;
    const haystack = [
      activityActionLabel(t, log.action),
      activityEntityLabel(t, log.resourceType),
      auditActor(t, log, users),
      log.ipAddress ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function auditExportRows(
  t: Translations,
  logs: readonly AuditRow[],
  users: ReadonlyArray<{ id: string; name?: string | null; email?: string | null }>,
  locale: string
) {
  return logs.map((log) => ({
    date: formatDateTime(log.createdAt, locale),
    action: activityActionLabel(t, log.action),
    resource: activityEntityLabel(t, log.resourceType),
    user: auditActor(t, log, users),
    // Record ids never appear in the export: they are in the details popover of the table.
    details: auditDetailEntries(log.details, t)
      .map((e) => withoutIds(e.key ? `${e.key}: ${e.value}` : e.value))
      .join("; "),
    ip: log.ipAddress ?? "",
  }));
}
