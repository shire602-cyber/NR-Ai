import type { Express, Request, Response } from "express";
import { z } from "zod";
import { authMiddleware, requireCompanyAccess, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { recordAudit } from "../services/audit.service";
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  createDefinition,
  deleteDefinition,
  getValues,
  isEntity,
  listDefinitions,
  setValues,
  updateDefinition,
} from "../services/custom-fields.service";

const keySchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "key must be lowercase letters, digits and underscores, starting with a letter (40 characters at most)");
const createSchema = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITIES),
  key: keySchema,
  labelEn: z.string().trim().min(1).max(100),
  labelAr: z.string().trim().min(1).max(100),
  fieldType: z.enum(CUSTOM_FIELD_TYPES),
  options: z.array(z.string()).optional(),
  showOnPdf: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
const updateSchema = z.object({
  labelEn: z.string().trim().min(1).max(100).optional(),
  labelAr: z.string().trim().min(1).max(100).optional(),
  options: z.array(z.string()).optional(),
  showOnPdf: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isArchived: z.boolean().optional(),
});

export function registerCustomFieldRoutes(app: Express) {
  const guards = [authMiddleware, requireCustomer, requireCompanyAccess("params")];

  app.get(
    "/api/companies/:companyId/custom-fields",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const entity = req.query.entity;
      if (entity !== undefined && !isEntity(entity)) {
        return res.status(400).json({ message: "entity must be contact, invoice, quote, bill or sales_order", code: "INVALID_ENTITY" });
      }
      res.json(await listDefinitions(req.params.companyId, entity as any, req.query.includeArchived === "true"));
    })
  );

  app.post(
    "/api/companies/:companyId/custom-fields",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const input = createSchema.parse(req.body ?? {});
      const def = await createDefinition(companyId, input);
      await recordAudit({ userId: (req as any).user.id, companyId, action: "custom_field.create", entityType: "custom_field", entityId: def.id, before: null, after: { entity: def.entity, key: def.key }, req });
      res.status(201).json(def);
    })
  );

  app.put(
    "/api/companies/:companyId/custom-fields/:id",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const def = await updateDefinition(companyId, id, updateSchema.parse(req.body ?? {}));
      if (!def) return res.status(404).json({ message: "Custom field not found" });
      res.json(def);
    })
  );

  app.delete(
    "/api/companies/:companyId/custom-fields/:id",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, id } = req.params;
      const outcome = await deleteDefinition(companyId, id);
      if (!outcome) return res.status(404).json({ message: "Custom field not found" });
      res.json({ outcome });
    })
  );

  app.get(
    "/api/companies/:companyId/custom-fields/values/:entity/:recordId",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, entity, recordId } = req.params;
      if (!isEntity(entity)) return res.status(400).json({ message: "Unknown record type", code: "INVALID_ENTITY" });
      res.json(await getValues(companyId, entity, recordId));
    })
  );

  app.put(
    "/api/companies/:companyId/custom-fields/values/:entity/:recordId",
    ...guards,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId, entity, recordId } = req.params;
      if (!isEntity(entity)) return res.status(400).json({ message: "Unknown record type", code: "INVALID_ENTITY" });
      const body = z.object({ values: z.record(z.string(), z.unknown()) }).parse(req.body ?? {});
      res.json(await setValues(companyId, entity, recordId, body.values));
    })
  );
}
