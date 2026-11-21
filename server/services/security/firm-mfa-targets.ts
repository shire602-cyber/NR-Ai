import type { Request } from "express";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { zUuid } from "../../../shared/validators/primitives";
import {
  accessibleClientsQuery,
  canAccessFirmClient,
  listAccessibleClientIds,
  resolveFirmContext,
  type FirmContext,
} from "../firm/scope";

const BODY_COMPANY_ROUTES = new Set([
  "firm/tasks",
  "firm/time-entries",
  "firm/time-entries/start",
  "firm/vat-workpapers",
  "firm/command-center/staff/assign",
  "firm/comms/send-email",
  "firm/comms/send-whatsapp",
  "firm/email-intake/sources",
]);

const COMPANY_LIST_ROUTES = new Set([
  "firm/tasks/generate",
  "firm/bulk/invoices",
  "firm/bulk/period-close",
  "firm/command-center/batch/vat-calculate",
  "firm/command-center/batch/chase-payments",
  "firm/command-center/batch/chase-documents",
]);

const ALL_CLIENT_ROUTES = new Set([
  "firm/billing/run-recurring",
  "firm/bulk/journal-import",
  "firm/command-center/alerts/refresh",
  "firm/email-intake/poll",
  "firm/growth-opportunities/refresh",
  "firm/comms/bulk-remind",
]);

// These list handlers read client records across the authorized set when no filter is supplied.
const FILTERED_CLIENT_LISTS = new Set(["firm/tasks", "firm/time-entries"]);
const ALL_CLIENT_LISTS = new Set(["firm/wip", "firm/service-invoices"]);

const ROW_ROUTES = [
  {
    path: /^firm\/tasks\/([^/]+)$/,
    table: sql`firm_tasks`,
    scope: (ctx: FirmContext) => sql`AND firm_id = ${ctx.firmId}`,
  },
  {
    path: /^firm\/requests\/([^/]+)\/review$/,
    table: sql`firm_document_requests`,
    scope: (ctx: FirmContext) => sql`AND firm_id = ${ctx.firmId}`,
  },
  {
    path: /^firm\/engagement-letters\/([^/]+)\/(?:send|withdraw)$/,
    table: sql`firm_engagement_letters`,
    scope: (ctx: FirmContext) => sql`AND firm_id = ${ctx.firmId}`,
  },
  {
    path: /^firm\/time-entries\/([^/]+)\/stop$/,
    table: sql`firm_time_entries`,
    scope: (ctx: FirmContext) => sql`AND firm_id = ${ctx.firmId} AND user_id = ${ctx.userId}`,
  },
  {
    path: /^firm\/client-links\/([^/]+)$/,
    table: sql`firm_client_links`,
    scope: (ctx: FirmContext) => sql`AND firm_id = ${ctx.firmId}`,
  },
  {
    path: /^firm\/vat-workpapers\/([^/]+)(?:\/|$)/,
    table: sql`vat_workpapers`,
    scope: () => sql``,
  },
  {
    path: /^firm\/growth-opportunities\/([^/]+)$/,
    table: sql`firm_growth_opportunities`,
    scope: () => sql``,
  },
  {
    path: /^firm\/command-center\/alerts\/([^/]+)\/(?:read|resolve)$/,
    table: sql`firm_alerts`,
    scope: (ctx: FirmContext) => sql`AND firm_id = ${ctx.userId}`,
  },
  {
    path: /^firm\/email-intake\/messages\/([^/]+)\/task$/,
    table: sql`email_intake_messages`,
    scope: () => sql``,
  },
  {
    path: /^firm\/email-intake\/sources\/([^/]+)$/,
    table: sql`client_email_sources`,
    scope: (ctx: FirmContext) => sql`AND firm_id = ${ctx.userId}`,
  },
];

function parsedId(value: unknown): string | undefined {
  return zUuid.safeParse(value).data;
}

function pathId(segment: string): string | undefined {
  try {
    return parsedId(decodeURIComponent(segment));
  } catch {
    return undefined; // Route-specific validation handles malformed path input.
  }
}

/** Resolve the company the firm route can act on, independently of the company RBAC exemption. */
export async function firmMfaTargetCompanies(req: Request, user: Express.User): Promise<string[]> {
  const path = req.path.toLowerCase().split("/").filter(Boolean).join("/");
  const named = /^(?:firm\/clients|firm\/email-intake\/completeness)\/([^/]+)(?:\/|$)/.exec(path);
  const rowRoute = ROW_ROUTES.find(({ path: pattern }) => pattern.test(path));
  const { companyId, companyIds, items } = (req.body ?? {}) as {
    companyId?: unknown;
    companyIds?: unknown;
    items?: unknown;
  };
  const reads = req.method === "GET" || req.method === "HEAD";
  const filteredList = reads && FILTERED_CLIENT_LISTS.has(path);
  const fromBody = !reads && BODY_COMPANY_ROUTES.has(path);
  const fromList = !reads && COMPANY_LIST_ROUTES.has(path);
  const allClients = reads ? ALL_CLIENT_LISTS.has(path) : ALL_CLIENT_ROUTES.has(path);
  const bulkOcr = path === "firm/bulk/ocr";
  if (!named && !rowRoute && !filteredList && !fromBody && !fromList && !allClients && !bulkOcr)
    return [];
  const ctx = await resolveFirmContext(user);
  if (!ctx?.isNr) return [];

  // A record ID wins over any company named in request input.
  if (rowRoute && !fromBody && !fromList && !allClients) {
    const id = pathId(rowRoute.path.exec(path)![1]);
    if (!id) return [];
    const result = await db.execute<{ company_id: string }>(sql`
      SELECT company_id FROM ${rowRoute.table}
      WHERE id = ${id} ${rowRoute.scope(ctx)}
        AND company_id IN (${accessibleClientsQuery(ctx)})
    `);
    return result.rows.map(({ company_id }) => company_id);
  }
  if (named || fromBody) {
    const id = named ? pathId(named[1]) : parsedId(companyId);
    return id && (await canAccessFirmClient(ctx, id)) ? [id] : [];
  }

  if (filteredList && req.query.companyId !== undefined) {
    const id = parsedId(req.query.companyId);
    return id && (await canAccessFirmClient(ctx, id)) ? [id] : [];
  }
  const accessible = await listAccessibleClientIds(ctx);
  if (filteredList) return accessible;
  if (allClients || (fromList && companyIds === undefined)) return accessible;
  const candidates = bulkOcr
    ? Array.isArray(items)
      ? items.map((item: { companyId?: unknown } | null) => item?.companyId)
      : []
    : Array.isArray(companyIds)
      ? companyIds
      : [];
  const requested = new Set(candidates.map(parsedId));
  return accessible.filter((id) => requested.has(id));
}
