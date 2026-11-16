// Localised labels for audit/activity-log rows. The API stores machine action codes
// (`invoice.create`, `auth.login_success`) and an English description composed server-side
// (server/storage/helpers.ts describeAuditLog). In Arabic mode the UI shows the action and entity
// as catalog labels and rebuilds the description from the same code, keeping the document
// number / id from the server text. English mode keeps the server text unchanged.
import { formatMessage } from "@/lib/i18n";

type Translations = Record<string, string>;

export interface ActivityLogLike {
  action: string;
  entityType?: string | null;
  resourceType?: string | null;
  entityId?: string | null;
  description?: string | null;
}

// English shapes produced by describeAuditLog (server/storage/helpers.ts); `{ref}` is the document
// number or id that the Arabic template re-inserts. Not UI copy: it is matched, never displayed.
const SERVER_SHAPES: Record<string, string> = {
  "invoice.create": "Invoice {ref} created",
  "invoice.status_change": "Invoice {ref} status changed",
  "journal.create_posted": "Journal entry {ref} posted",
  "journal.create_draft": "Journal entry {ref} saved as draft",
  "journal.reverse": "Journal entry {ref} reversed",
  "account.create": "Account {ref} created",
  "account.update": "Account {ref} updated",
  "account.type_change": "Account {ref} type changed",
  "receipt.create": "Receipt {ref} created",
  "receipt.update": "Receipt {ref} updated",
  "receipt.post": "Receipt {ref} posted to ledger",
  "bank_statement.match_confirmed": "Bank transaction {ref} match confirmed",
  "payroll.run_approved": "Payroll run {ref} approved",
};

const humanise = (value: string) => {
  const spaced = value.replace(/[._-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value;
};

/** Label for an action code; falls back to the humanised code. */
export function activityActionLabel(t: Translations, action: string): string {
  return t[`activityLog.action.${action}`] ?? humanise(action);
}

/** Label for an entity / resource type; falls back to the humanised type. */
export function activityEntityLabel(t: Translations, entityType: string): string {
  return t[`activityLog.entity.${entityType}`] ?? humanise(entityType);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Description of one log row in the active language. English returns the server text. Arabic
 * rebuilds it from `activityLog.desc.<action>` (the document number is pulled out of the server text) or, for other codes, from the action and
 * entity labels plus the entity id.
 */
export function activityDescription(t: Translations, log: ActivityLogLike, locale: string): string {
  const server = log.description ?? "";
  if (locale !== "ar") return server;
  const template = t[`activityLog.desc.${log.action}`];
  const twin = SERVER_SHAPES[log.action];
  if (template && twin) {
    const pattern = new RegExp(`^${escapeRegExp(twin).replace("\\{ref\\}", "(.*?)")}$`);
    const match = server.match(pattern);
    return formatMessage(template, { ref: (match?.[1] ?? "").trim() })
      .replace(/\s+/g, " ")
      .trim();
  }
  const entity = log.entityType ?? log.resourceType ?? "";
  const parts = [activityActionLabel(t, log.action)];
  if (entity) parts.push(activityEntityLabel(t, entity));
  if (log.entityId) parts.push(log.entityId);
  return parts.join(" · ");
}
