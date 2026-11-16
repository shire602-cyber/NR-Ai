// Module-level helpers shared by the server/storage/* domain classes (R20-09).
// normalizeEmail is re-exported by server/storage.ts; the rest are internal.

import { auditLogs, type ActivityLog, type AuditLog, type InsertJournalLine } from "@shared/schema";
import { eq, gte, inArray, lte, sql } from "drizzle-orm";
import { DomainError } from "../errors";
import { legacyLinesToInput } from "../ledger/legacy";
import type { AuditLogFilter } from "./types";

/** R01-05: canonical form of an email address (trimmed, lower-cased). */
export function normalizeEmail(email: string): string {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

// Default cap on list-endpoint queries. Without this, a single tenant with
// runaway invoice/journal volume can pull tens of MB into memory. Pages that
// truly need the full dataset (PDF export, GL ledger) pass an explicit limit.
export const DEFAULT_LIST_LIMIT = 1000;

// R02-01/R02-18: journal balance is exact in integer fils (no tolerance).
// Legacy float amounts are rounded per line half-up to 2dp (the numeric(15,2)
// rule) by the ledger adapter before the exact comparison.
export function assertBalanced(
  lines: Array<{ debit?: number | null; credit?: number | null }>
): void {
  const normalized = legacyLinesToInput(lines as Array<Omit<InsertJournalLine, "entryId">>);
  const debit = normalized.reduce((sum, l) => sum + (l.debitFils ?? 0), 0);
  const credit = normalized.reduce((sum, l) => sum + (l.creditFils ?? 0), 0);
  if (debit !== credit) {
    throw new DomainError(
      "ENTRY_UNBALANCED",
      422,
      { debitFils: debit, creditFils: credit },
      `Journal entry is unbalanced: debits ${(debit / 100).toFixed(2)} ≠ credits ${(credit / 100).toFixed(2)}`
    );
  }
}

export function parseAuditDetails(details: string | null): Record<string, unknown> {
  if (!details) return {};
  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function sentenceCase(value: string): string {
  const cleaned = value.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return "Activity recorded";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function describeAuditLog(row: AuditLog): string {
  const details = parseAuditDetails(row.details ?? null);
  const after =
    details.after && typeof details.after === "object"
      ? (details.after as Record<string, unknown>)
      : {};
  const before =
    details.before && typeof details.before === "object"
      ? (details.before as Record<string, unknown>)
      : {};
  const documentNumber =
    after.number ||
    after.entryNumber ||
    after.code ||
    before.number ||
    before.entryNumber ||
    row.resourceId;
  const entityLabel = row.resourceType.replace(/_/g, " ");

  switch (row.action) {
    case "invoice.create":
      return `Invoice ${documentNumber || row.resourceId || ""} created`.trim();
    case "invoice.status_change":
      return `Invoice ${documentNumber || row.resourceId || ""} status changed`.trim();
    case "journal.create_posted":
      return `Journal entry ${documentNumber || row.resourceId || ""} posted`.trim();
    case "journal.create_draft":
      return `Journal entry ${documentNumber || row.resourceId || ""} saved as draft`.trim();
    case "journal.reverse":
      return `Journal entry ${documentNumber || row.resourceId || ""} reversed`.trim();
    case "account.create":
      return `Account ${documentNumber || row.resourceId || ""} created`.trim();
    case "account.update":
      return `Account ${documentNumber || row.resourceId || ""} updated`.trim();
    case "account.type_change":
      return `Account ${documentNumber || row.resourceId || ""} type changed`.trim();
    case "receipt.create":
      return `Receipt ${documentNumber || row.resourceId || ""} created`.trim();
    case "receipt.update":
      return `Receipt ${documentNumber || row.resourceId || ""} updated`.trim();
    case "receipt.post":
      return `Receipt ${documentNumber || row.resourceId || ""} posted to ledger`.trim();
    case "bank_statement.match_confirmed":
      return `Bank transaction ${documentNumber || row.resourceId || ""} match confirmed`.trim();
    case "payroll.run_approved":
      return `Payroll run ${documentNumber || row.resourceId || ""} approved`.trim();
    default:
      return `${sentenceCase(row.action)} on ${entityLabel}${row.resourceId ? ` ${row.resourceId}` : ""}`;
  }
}

export function auditFilterConditions(filter: AuditLogFilter) {
  const conds = [];
  if (filter.actions?.length) conds.push(inArray(auditLogs.action, filter.actions));
  if (filter.actionPrefix) {
    const escaped = filter.actionPrefix.replace(/[\\%_]/g, (c) => `\\${c}`);
    conds.push(sql`${auditLogs.action} LIKE ${`${escaped}%`}`);
  }
  if (filter.userId) conds.push(eq(auditLogs.userId, filter.userId));
  if (filter.resourceType) conds.push(eq(auditLogs.resourceType, filter.resourceType));
  if (filter.from) conds.push(gte(auditLogs.createdAt, filter.from));
  if (filter.to) conds.push(lte(auditLogs.createdAt, filter.to));
  return conds;
}

export function auditLogToActivityLog(row: AuditLog, companyId: string | null): ActivityLog {
  const details = parseAuditDetails(row.details ?? null);
  const rowCompanyId =
    companyId || (typeof details.companyId === "string" ? details.companyId : null);

  return {
    id: row.id,
    userId: row.userId,
    companyId: rowCompanyId,
    action: row.action,
    entityType: row.resourceType,
    entityId: row.resourceId,
    description: describeAuditLog(row),
    metadata: row.details,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}
