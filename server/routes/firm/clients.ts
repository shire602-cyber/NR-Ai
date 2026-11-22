// Firm client handlers: list, summary, create, update, assign staff, staff list, switch, archive and import.
// Handlers moved from firm.routes.ts (R20-09); the route registrations (paths and
// middleware order) stay in firm.routes.ts.
import { DEFAULT_CLIENT_SERVICE_CODES, type ClientServiceCode } from "@shared/client-services";
import { isClientImportFileName, type ClientImportRowError } from "@shared/firm-client-import";
import type { Request, Response } from "express";
import { matchesSearchText } from "../../../shared/arabic-text";
import { assignStaff, listFirmStaff } from "../../services/firm/staff.service";
import {
  clientNameKey,
  mapImportRow,
  type ImportedClient,
  validateImportedClient,
  vatPeriodStartMonthForNrClientName,
  withNrClientVatGroup,
} from "../../services/firm-clients.service";
import { companies, invoices, receipts, type InsertCompany } from "../../../shared/schema";
import { db } from "../../db";
import { desc, eq, inArray } from "drizzle-orm";
import {
  endClientLink,
  findDuplicateClient,
  linkNewClientToFirm,
  withFirmClientProvisioning,
  type FirmClientTransaction,
} from "../../services/firm/clients.service";
import type { FirmContext } from "../../services/firm/scope";
import { requireFirmCompanyMfa } from "../../services/security/policy";
import { firmContextOf, getAccessibleCompanyIds } from "../../middleware/rbac";
import { parseSpreadsheet } from "../../services/spreadsheet.service";
import { parsedBody } from "../../http/parsed-body";
import { storage } from "../../storage";
import { z } from "zod";
import {
  assignStaffSchema,
  canAccessClient,
  createClientSchema,
  denyClientAccess,
  getClientStats,
  getClientStatsBatch,
  type ClientStats,
  type FirmClientsImportBody,
  importPayloadSchema,
  loadActiveServicePlans,
  seedChartOfAccounts,
  servicePlanFromEngagement,
  updateClientSchema,
  upsertClientServicePlan,
} from "./shared";

/**
 * Columns of a client company the portfolio and the firm pickers render. Everything else
 * (WPS/e-invoice bank details, payee IBANs, API settings) stays out of the list payload.
 */
export const FIRM_CLIENT_LIST_COLUMNS = [
  "id",
  "name",
  "legalName",
  "legalNameAr",
  "trnVatNumber",
  "companyType",
  "baseCurrency",
  "locale",
  "emirate",
  "industry",
  "contactEmail",
  "contactPhone",
  "vatFilingFrequency",
  "vatPeriodStartMonth",
  "fiscalYearStartMonth",
  "corporateTaxId",
  "isActive",
  "onboardingCompleted",
  "createdAt",
] as const;

type ClientRow = Record<string, unknown> & { id: string; name: string };

function pickClientColumns(company: ClientRow): ClientRow {
  const out: Record<string, unknown> = {};
  for (const key of FIRM_CLIENT_LIST_COLUMNS) {
    if (key in company) out[key] = company[key];
  }
  if ("nrVatGroup" in company) out.nrVatGroup = company.nrVatGroup;
  return out as ClientRow;
}

const CLIENT_SORTS = ["name", "createdAt", "outstandingAr", "vatDueDate", "invoiceCount"] as const;
type ClientSort = (typeof CLIENT_SORTS)[number];

function queryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * GET /firm/clients
 * Query (all optional): `view=names` (id and name only), `q` (name, Arabic name, TRN, e-mail),
 * `sort` (name | createdAt | outstandingAr | vatDueDate | invoiceCount), `order` (asc | desc),
 * `limit` (1-200) and `offset`. A paged answer carries `X-Total-Count`. Without paging the
 * whole accessible set is returned (the portfolio filters and counts it client-side).
 */
export const handleGetFirmClients = async (req: Request, res: Response) => {
  const { id: userId, firmRole } = req.user!;
  const accessibleIds = await getAccessibleCompanyIds(
    userId,
    firmRole ?? "",
    req.user?.isAdmin === true
  );

  let clientCompanies: Awaited<ReturnType<typeof storage.getClientCompanies>>;
  if (accessibleIds === null) {
    clientCompanies = await storage.getClientCompanies();
  } else if (accessibleIds.length === 0) {
    clientCompanies = [];
  } else {
    clientCompanies = await db.select().from(companies).where(inArray(companies.id, accessibleIds));
  }

  if (queryString(req.query.view) === "names") {
    const rows = clientCompanies
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.setHeader("X-Total-Count", String(rows.length));
    return res.json(rows);
  }

  const q = queryString(req.query.q).trim();
  let rows = (clientCompanies as unknown as ClientRow[]).map((c) => withNrClientVatGroup(c));
  if (q) {
    rows = rows.filter((c) =>
      matchesSearchText(
        q,
        c.name as string,
        c.legalName as string,
        c.legalNameAr as string,
        c.trnVatNumber as string,
        c.contactEmail as string
      )
    );
  }

  const sortKey = queryString(req.query.sort) as ClientSort;
  const hasSort = (CLIENT_SORTS as readonly string[]).includes(sortKey);
  const desc_ = queryString(req.query.order).toLowerCase() === "desc";
  const limitRaw = Number.parseInt(queryString(req.query.limit), 10);
  const paged = Number.isFinite(limitRaw) && limitRaw > 0;
  const total = rows.length;
  const limit = paged ? Math.min(limitRaw, 200) : total;
  const offsetRaw = Number.parseInt(queryString(req.query.offset), 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
  if (offset >= total) {
    res.setHeader("X-Total-Count", String(total));
    return res.json([]);
  }

  // Sort and page before the stats so a page costs one grouped query set for `limit` clients.
  // A financial sort reads every matching candidate, so check the full set before sorting it.
  const statSort = hasSort && ["outstandingAr", "vatDueDate", "invoiceCount"].includes(sortKey);
  let statsMap: Map<string, ClientStats> | null = null;
  if (statSort) {
    const candidateIds = rows.map((c) => c.id);
    if (!(await requireFirmCompanyMfa(req.user!, res, candidateIds))) return;
    statsMap = await getClientStatsBatch(candidateIds);
  }

  if (hasSort) {
    const dir = desc_ ? -1 : 1;
    const value = (c: ClientRow): number | string => {
      if (sortKey === "name") return (c.name as string).toLowerCase();
      if (sortKey === "createdAt") return new Date(c.createdAt as string).getTime();
      const st = statsMap?.get(c.id);
      if (sortKey === "outstandingAr") return st?.outstandingAr ?? 0;
      if (sortKey === "invoiceCount") return st?.invoiceCount ?? 0;
      return st?.vatStatus ? new Date(st.vatStatus.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    };
    rows.sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : av - (bv as number);
      return cmp * dir || (a.name as string).localeCompare(b.name as string);
    });
  }

  const page = paged || offset > 0 ? rows.slice(offset, offset + limit) : rows;
  const pageIds = page.map((c) => c.id);
  if (!statsMap) {
    if (!(await requireFirmCompanyMfa(req.user!, res, pageIds))) return;
    statsMap = await getClientStatsBatch(pageIds);
  }
  const servicePlans = await loadActiveServicePlans(pageIds);

  const result = page.map((company) => {
    const servicePlan = servicePlans.get(company.id) ?? servicePlanFromEngagement(undefined);
    return {
      ...pickClientColumns(company),
      ...statsMap!.get(company.id)!,
      serviceScope: servicePlan.servicesIncluded,
      servicePlan,
    };
  });

  res.setHeader("X-Total-Count", String(total));
  res.json(result);
};

/** GET /firm/clients/:companyId/summary */
export const handleGetFirmClientsSummary = async (req: Request, res: Response) => {
  const { companyId } = req.params;
  if (!(await canAccessClient(req, res, companyId))) {
    return denyClientAccess(res, companyId);
  }
  if (!(await requireFirmCompanyMfa(req.user!, res, [companyId]))) return;

  const company = await storage.getCompany(companyId);

  if (!company) {
    return res.status(404).json({ message: "Client not found" });
  }

  const [stats, companyUserList, recentInvoices, recentReceipts, servicePlanMap] =
    await Promise.all([
      getClientStats(companyId),
      storage.getCompanyUserWithUser(companyId),
      db
        .select()
        .from(invoices)
        .where(eq(invoices.companyId, companyId))
        .orderBy(desc(invoices.createdAt))
        .limit(10),
      db
        .select()
        .from(receipts)
        .where(eq(receipts.companyId, companyId))
        .orderBy(desc(receipts.createdAt))
        .limit(10),
      loadActiveServicePlans([companyId]),
    ]);
  const servicePlan = servicePlanMap.get(companyId) ?? servicePlanFromEngagement(undefined);

  const organisedCompany = withNrClientVatGroup(company);

  res.json({
    company: {
      ...organisedCompany,
      serviceScope: servicePlan.servicesIncluded,
      servicePlan,
    },
    stats,
    companyUsers: companyUserList,
    recentInvoices,
    recentReceipts,
    servicePlan,
  });
};

async function provisionFirmClient(
  ctx: FirmContext,
  tx: FirmClientTransaction,
  input: InsertCompany,
  services: readonly ClientServiceCode[] | undefined,
  activity: string
) {
  const company = await storage.createCompany(
    {
      ...input,
      baseCurrency: "AED",
      locale: "en",
      companyType: "client",
      contactEmail: input.contactEmail || undefined,
      emirate: input.emirate || "dubai",
      vatFilingFrequency: input.vatFilingFrequency || "quarterly",
    },
    tx
  );
  const servicePlan = await upsertClientServicePlan(
    company.id,
    ctx.userId,
    services ?? DEFAULT_CLIENT_SERVICE_CODES,
    tx
  );

  await seedChartOfAccounts(company.id, tx);
  await linkNewClientToFirm(ctx, company.id, tx);

  await storage.createActivityLog(
    {
      userId: ctx.userId,
      companyId: company.id,
      action: "create",
      entityType: "company",
      entityId: company.id,
      description: `${activity}: ${company.name}`,
    },
    tx
  );
  return { company, servicePlan };
}

/** POST /firm/clients */
export const handlePostFirmClients = async (req: Request, res: Response) => {
  const { serviceScope, ...companyInput } = parsedBody<z.output<typeof createClientSchema>>(req);
  const result = await withFirmClientProvisioning(firmContextOf(res), async (ctx, tx) => {
    // R15-04: case-insensitive duplicate check within the firm's clients.
    const duplicate = await findDuplicateClient(ctx, companyInput.name, undefined, tx);
    if (duplicate) return { duplicate, client: null };

    const client = await provisionFirmClient(
      ctx,
      tx,
      {
        ...companyInput,
        vatPeriodStartMonth:
          companyInput.vatPeriodStartMonth ?? vatPeriodStartMonthForNrClientName(companyInput.name),
      },
      serviceScope,
      "Firm created client"
    );
    return { duplicate: null, client };
  });
  if (result.duplicate) {
    return res.status(409).json({
      message: "A client with this name already exists",
      code: "CLIENT_DUPLICATE",
      details: { existingCompanyId: result.duplicate.id, existingName: result.duplicate.name },
    });
  }

  const { company, servicePlan } = result.client;
  res.status(201).json({
    ...company,
    serviceScope: servicePlan.servicesIncluded,
    servicePlan,
  });
};

/** PUT /firm/clients/:companyId */
export const handlePutFirmClients = async (req: Request, res: Response) => {
  const { companyId } = req.params;
  const { id: userId } = req.user!;
  const validated = parsedBody<z.output<typeof updateClientSchema>>(req);
  const { serviceScope, ...companyPatch } = validated;

  if (!(await canAccessClient(req, res, companyId))) {
    return denyClientAccess(res, companyId);
  }

  const company = await storage.getCompany(companyId);
  if (!company) {
    return res.status(404).json({ message: "Client not found" });
  }
  if (companyPatch.name) {
    const duplicate = await findDuplicateClient(firmContextOf(res), companyPatch.name, companyId);
    if (duplicate) {
      return res.status(409).json({
        message: "A client with this name already exists",
        code: "CLIENT_DUPLICATE",
        details: { existingCompanyId: duplicate.id, existingName: duplicate.name },
      });
    }
  }

  const updated =
    Object.keys(companyPatch).length > 0
      ? await storage.updateCompany(companyId, companyPatch)
      : company;
  const servicePlan =
    serviceScope !== undefined
      ? await upsertClientServicePlan(companyId, userId, serviceScope)
      : ((await loadActiveServicePlans([companyId])).get(companyId) ??
        servicePlanFromEngagement(undefined));

  await storage.createActivityLog({
    userId,
    companyId,
    action: "update",
    entityType: "company",
    entityId: companyId,
    description: `Firm updated client: ${updated.name}`,
  });

  res.json({
    ...updated,
    serviceScope: servicePlan.servicesIncluded,
    servicePlan,
  });
};

/** POST /firm/clients/:companyId/assign-staff */
export const handlePostFirmClientsAssignStaff = async (req: Request, res: Response) => {
  const { companyId } = req.params;
  const requestingUserId = req.user!.id;
  const { staffUserId, action, role } = parsedBody<z.output<typeof assignStaffSchema>>(req);
  const result = await assignStaff(firmContextOf(res), {
    staffUserId,
    companyId,
    action,
    role,
  });
  await storage.createActivityLog({
    userId: requestingUserId,
    companyId,
    action: action === "assign" ? "create" : "delete",
    entityType: "firm_staff_assignment",
    entityId: staffUserId,
    description: `${action === "assign" ? "Assigned" : "Unassigned"} firm staff ${staffUserId}`,
  });
  res.json({ success: true, ...result });
};

/** GET /firm/staff */
export const handleGetFirmStaff = async (_req: Request, res: Response) => {
  res.json(await listFirmStaff(firmContextOf(res)));
};

/** POST /firm/clients/:companyId/switch */
export const handlePostFirmClientsSwitch = async (req: Request, res: Response) => {
  const { companyId } = req.params;
  const { id: userId } = req.user!;

  if (!(await canAccessClient(req, res, companyId))) {
    return denyClientAccess(res, companyId);
  }

  const company = await storage.getCompany(companyId);
  if (!company) {
    return res.status(404).json({ message: "Client not found" });
  }

  await storage.createActivityLog({
    userId,
    companyId,
    action: "view",
    entityType: "company",
    entityId: companyId,
    description: `Firm staff switched into ${company.name}`,
  });

  res.json({ company });
};

/** DELETE /firm/clients/:companyId */
export const handleDeleteFirmClients = async (req: Request, res: Response) => {
  const { companyId } = req.params;
  const { id: userId } = req.user!;
  const ctx = firmContextOf(res);

  if (!(await canAccessClient(req, res, companyId))) {
    return res.status(404).json({ message: "Client not found", code: "CLIENT_NOT_FOUND" });
  }
  const company = await storage.getCompany(companyId);
  if (!company) {
    return res.status(404).json({ message: "Client not found" });
  }

  if (company.companyType !== "client") {
    // A client organisation that joined by invitation owns its books: the
    // firm can only end its own link, never archive the company.
    await endClientLink(ctx, companyId, userId, "Archived by firm");
    return res.json({ success: true, linkEnded: true, archivedAt: null });
  }

  const archivedAt = await storage.deleteCompany(companyId, ctx);
  if (!archivedAt) {
    return res.status(404).json({ message: "Client not found", code: "CLIENT_NOT_FOUND" });
  }

  await storage.createActivityLog({
    userId,
    companyId,
    action: "delete",
    entityType: "company",
    entityId: companyId,
    description: `Firm archived client: ${company.name}`,
  });

  res.json({ success: true, archivedAt: archivedAt.toISOString() });
};

type PreparedClientImportRow =
  | { row: number; client: ImportedClient }
  | { error: ClientImportRowError };

function prepareClientImport(rows: Record<string, unknown>[]): PreparedClientImportRow[] {
  const seenNames = new Set<string>();
  return rows.map((raw, index) => {
    const row = index + 1;
    const mapped = mapImportRow(raw);
    if ("error" in mapped) {
      return { error: { row, name: "", code: "NAME_REQUIRED", error: mapped.error } };
    }

    const validated = validateImportedClient(mapped);
    if (!validated.ok) {
      return {
        error: {
          row,
          name: mapped.name,
          code: "INVALID_ROW",
          error: validated.error,
          ...(validated.field ? { field: validated.field } : {}),
        },
      };
    }

    const key = clientNameKey(validated.value.name);
    if (seenNames.has(key)) {
      return {
        error: {
          row,
          name: validated.value.name,
          code: "DUPLICATE_ROW",
          error: "Duplicate of an earlier row in this file",
          field: "name",
        },
      };
    }
    seenNames.add(key);
    return { row, client: validated.value };
  });
}

/** POST /firm/clients/import */
export const handlePostFirmClientsImport = async (req: Request, res: Response) => {
  // Accept either pre-parsed rows or a base64-encoded file.
  const body = parsedBody<FirmClientsImportBody>(req);
  let rows: Record<string, unknown>[];
  if (body.fileData) {
    if (body.fileName !== undefined && !isClientImportFileName(body.fileName)) {
      return res.status(400).json({
        code: "CLIENT_IMPORT_FILE_TYPE",
        message: "Choose a CSV or XLSX file.",
      });
    }
    try {
      const buffer = Buffer.from(body.fileData, "base64");
      rows = (await parseSpreadsheet(buffer, body.fileName)).rows;
    } catch {
      return res.status(400).json({
        code: "CLIENT_IMPORT_UNREADABLE",
        message: "The import file could not be read. Check the file format and try again.",
      });
    }
  } else {
    const parsed = importPayloadSchema.safeParse({ rows: body.rows });
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload", errors: parsed.error.issues });
    }
    rows = parsed.data.rows;
  }

  if (!rows || rows.length === 0) {
    return res.status(400).json({ code: "CLIENT_IMPORT_EMPTY", message: "No rows to import." });
  }
  if (rows.length > 500) {
    return res.status(400).json({
      code: "CLIENT_IMPORT_TOO_MANY_ROWS",
      message: "Imports are limited to 500 rows per upload.",
    });
  }

  const prepared = prepareClientImport(rows);
  const results = await withFirmClientProvisioning(firmContextOf(res), async (ctx, tx) => {
    const created: { id: string; name: string }[] = [];
    const errors: ClientImportRowError[] = [];
    for (const entry of prepared) {
      if ("error" in entry) {
        errors.push(entry.error);
        continue;
      }
      const { row, client } = entry;
      const { serviceScope, ...companyInput } = client;
      try {
        // A failed row rolls back to its savepoint while the caller's permission stays locked.
        const company = await tx.transaction(async (rowTx) => {
          const existing = await findDuplicateClient(ctx, client.name, undefined, rowTx);
          if (existing) return null;
          const { company } = await provisionFirmClient(
            ctx,
            rowTx,
            {
              ...companyInput,
              industry: client.industry || undefined,
              legalStructure: client.legalStructure || undefined,
              contactPhone: client.contactPhone || undefined,
              businessAddress: client.businessAddress || undefined,
              corporateTaxId: client.corporateTaxId || undefined,
              registrationNumber: client.registrationNumber || undefined,
              websiteUrl: client.websiteUrl || undefined,
            },
            serviceScope,
            "Bulk-imported firm client"
          );
          return company;
        });
        if (company) {
          created.push({ id: company.id, name: company.name });
        } else {
          errors.push({
            row,
            name: client.name,
            code: "DUPLICATE_CLIENT",
            error: "A client with this name already exists",
            field: "name",
          });
        }
      } catch {
        errors.push({
          row,
          name: client.name,
          code: "ROW_FAILED",
          error: "The client could not be created. Try this row again.",
        });
      }
    }
    return { created, errors };
  });

  res.json({
    message: `Imported ${results.created.length} clients (${results.errors.length} errors)`,
    ...results,
  });
};
