// Firm client handlers: list, summary, create, update, assign staff, staff list, switch, archive and import.
// Handlers moved from firm.routes.ts (R20-09); the route registrations (paths and
// middleware order) stay in firm.routes.ts.
import { DEFAULT_CLIENT_SERVICE_CODES } from "@shared/client-services";
import type { Request, Response } from "express";
import { assignStaff, listFirmStaff } from "../../services/firm/staff.service";
import {
  clientNameKey,
  mapImportRow,
  validateImportedClient,
  vatPeriodStartMonthForNrClientName,
  withNrClientVatGroup,
} from "../../services/firm-clients.service";
import { companies, invoices, receipts } from "../../../shared/schema";
import { db } from "../../db";
import { desc, eq, inArray } from "drizzle-orm";
import {
  endClientLink,
  findDuplicateClient,
  linkNewClientToFirm,
} from "../../services/firm/clients.service";
import { errorMessage } from "../../errors";
import { firmContextOf, getAccessibleCompanyIds } from "../../middleware/rbac";
import { parseSpreadsheet } from "../../services/spreadsheet.service";
import { parsedBody } from "../../http/parsed-body";
import { storage } from "../../storage";
import { z } from "zod";
import {
  assignStaffSchema,
  canAccessClient,
  createClientSchema,
  getClientStats,
  importPayloadSchema,
  loadActiveServicePlans,
  seedChartOfAccounts,
  servicePlanFromEngagement,
  updateClientSchema,
  upsertClientServicePlan,
} from "./shared";

/** GET /firm/clients */
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

  const servicePlans = await loadActiveServicePlans(clientCompanies.map((company) => company.id));

  const clientsWithStats = await Promise.all(
    clientCompanies.map(async (company) => {
      const organisedCompany = withNrClientVatGroup(company);
      const stats = await getClientStats(company.id);
      const servicePlan = servicePlans.get(company.id) ?? servicePlanFromEngagement(undefined);
      return {
        ...organisedCompany,
        ...stats,
        serviceScope: servicePlan.servicesIncluded,
        servicePlan,
      };
    })
  );

  res.json(clientsWithStats);
};

/** GET /firm/clients/:companyId/summary */
export const handleGetFirmClientsSummary = async (req: Request, res: Response) => {
  const { companyId } = req.params;
  if (!(await canAccessClient(req, res, companyId))) {
    return res.status(403).json({ message: "Access denied to this client" });
  }

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

/** POST /firm/clients */
export const handlePostFirmClients = async (req: Request, res: Response) => {
  const { id: userId } = req.user!;
  const ctx = firmContextOf(res);
  const validated = parsedBody<z.output<typeof createClientSchema>>(req);
  const { serviceScope, ...companyInput } = validated;

  // R15-04: case-insensitive duplicate check within the firm's clients.
  const duplicate = await findDuplicateClient(ctx, companyInput.name);
  if (duplicate) {
    return res.status(409).json({
      message: "A client with this name already exists",
      code: "CLIENT_DUPLICATE",
      details: { existingCompanyId: duplicate.id, existingName: duplicate.name },
    });
  }

  const company = await storage.createCompany({
    name: companyInput.name,
    baseCurrency: "AED",
    locale: "en",
    companyType: "client",
    trnVatNumber: companyInput.trnVatNumber,
    legalStructure: companyInput.legalStructure,
    industry: companyInput.industry,
    registrationNumber: companyInput.registrationNumber,
    businessAddress: companyInput.businessAddress,
    contactPhone: companyInput.contactPhone,
    contactEmail: companyInput.contactEmail || undefined,
    websiteUrl: companyInput.websiteUrl,
    emirate: companyInput.emirate || "dubai",
    vatFilingFrequency: companyInput.vatFilingFrequency || "quarterly",
    vatPeriodStartMonth:
      companyInput.vatPeriodStartMonth ?? vatPeriodStartMonthForNrClientName(companyInput.name),
    fiscalYearStartMonth: companyInput.fiscalYearStartMonth,
    taxRegistrationType: companyInput.taxRegistrationType,
    corporateTaxId: companyInput.corporateTaxId,
  });
  const servicePlan = await upsertClientServicePlan(
    company.id,
    userId,
    serviceScope ?? DEFAULT_CLIENT_SERVICE_CODES
  );

  await seedChartOfAccounts(company.id);
  await linkNewClientToFirm(ctx, company.id);

  await storage.createActivityLog({
    userId,
    companyId: company.id,
    action: "create",
    entityType: "company",
    entityId: company.id,
    description: `Firm created client: ${company.name}`,
  });

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
    return res.status(403).json({ message: "Access denied to this client" });
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
    return res.status(403).json({ message: "Access denied to this client" });
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

  await db
    .update(companies)
    .set({ deletedAt: new Date(), isActive: false })
    .where(eq(companies.id, companyId));

  await storage.createActivityLog({
    userId,
    companyId,
    action: "delete",
    entityType: "company",
    entityId: companyId,
    description: `Firm archived client: ${company.name}`,
  });

  res.json({ success: true, archivedAt: new Date().toISOString() });
};

/** POST /firm/clients/import */
export const handlePostFirmClientsImport = async (req: Request, res: Response) => {
  const { id: userId } = req.user!;
  const ctx = firmContextOf(res);

  // Accept either pre-parsed rows or a base64-encoded file.
  let rows: Record<string, unknown>[];
  if (req.body?.fileData) {
    try {
      const buffer = Buffer.from(req.body.fileData, "base64");
      rows = (await parseSpreadsheet(buffer, req.body.fileName)).rows;
    } catch (err: unknown) {
      return res.status(400).json({ message: `Could not parse file: ${errorMessage(err)}` });
    }
  } else {
    const parsed = importPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload", errors: parsed.error.errors });
    }
    rows = parsed.data.rows;
  }

  if (!rows || rows.length === 0) {
    return res.status(400).json({ message: "No rows to import" });
  }
  if (rows.length > 500) {
    return res.status(400).json({ message: "Imports limited to 500 rows per call" });
  }

  const results = {
    created: [] as { id: string; name: string }[],
    errors: [] as { row: number; name: string; error: string; field?: string }[],
  };
  const seenNames = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const mapped = mapImportRow(raw);
    if ("error" in mapped) {
      results.errors.push({ row: i + 1, name: "", error: mapped.error });
      continue;
    }

    const validated = validateImportedClient(mapped);
    if (!validated.ok) {
      results.errors.push({
        row: i + 1,
        name: mapped.name,
        error: validated.error,
        ...(validated.field ? { field: validated.field } : {}),
      });
      continue;
    }

    const key = clientNameKey(validated.value.name);
    if (seenNames.has(key)) {
      results.errors.push({
        row: i + 1,
        name: validated.value.name,
        error: "Duplicate of an earlier row in this file",
        field: "name",
      });
      continue;
    }
    seenNames.add(key);

    try {
      // R15-04: case-insensitive, within the firm's clients.
      const existing = await findDuplicateClient(ctx, validated.value.name);
      if (existing) {
        results.errors.push({
          row: i + 1,
          name: validated.value.name,
          error: "A client with this name already exists",
          field: "name",
        });
        continue;
      }

      const company = await storage.createCompany({
        name: validated.value.name,
        baseCurrency: "AED",
        locale: "en",
        companyType: "client",
        trnVatNumber: validated.value.trnVatNumber || undefined,
        industry: validated.value.industry || undefined,
        legalStructure: validated.value.legalStructure || undefined,
        contactEmail: validated.value.contactEmail || undefined,
        contactPhone: validated.value.contactPhone || undefined,
        businessAddress: validated.value.businessAddress || undefined,
        emirate: validated.value.emirate || "dubai",
        vatFilingFrequency: validated.value.vatFilingFrequency || "quarterly",
        vatPeriodStartMonth: validated.value.vatPeriodStartMonth,
        fiscalYearStartMonth: validated.value.fiscalYearStartMonth,
        corporateTaxId: validated.value.corporateTaxId || undefined,
        registrationNumber: validated.value.registrationNumber || undefined,
        websiteUrl: validated.value.websiteUrl || undefined,
      });

      await upsertClientServicePlan(
        company.id,
        userId,
        validated.value.serviceScope ?? DEFAULT_CLIENT_SERVICE_CODES
      );

      await seedChartOfAccounts(company.id);
      await linkNewClientToFirm(ctx, company.id);

      await storage.createActivityLog({
        userId,
        companyId: company.id,
        action: "create",
        entityType: "company",
        entityId: company.id,
        description: `Bulk-imported firm client: ${company.name}`,
      });

      results.created.push({ id: company.id, name: company.name });
    } catch (err: unknown) {
      results.errors.push({
        row: i + 1,
        name: validated.value.name,
        error: errorMessage(err) ?? "Unknown error",
      });
    }
  }

  res.json({
    message: `Imported ${results.created.length} clients (${results.errors.length} errors)`,
    ...results,
  });
};
