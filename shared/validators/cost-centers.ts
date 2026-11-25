/**
 * Cost-centre write contracts (W4-B: R10-11, R10-18, R10-19). companyId is server-owned.
 */
import { z } from "zod";
import { zText, zUuid } from "./primitives";

export const COST_CENTER_TYPES = ["cost_centre", "project", "job"] as const;

const fields = {
  code: zText(32, { min: 1 }),
  name: zText(255, { min: 1 }),
  nameAr: zText(255).optional().nullable(),
  type: z.enum(COST_CENTER_TYPES).optional(),
  description: zText(2000).optional().nullable(),
  parentId: zUuid.optional().nullable(),
  isActive: z.boolean().optional(),
};

export const createCostCenterBody = z.object(fields);
export type CreateCostCenterBody = z.output<typeof createCostCenterBody>;

export const updateCostCenterBody = z
  .object(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, "No fields to update");
export type UpdateCostCenterBody = z.output<typeof updateCostCenterBody>;

/** Tag stored document lines owned by other modules (bill lines) with a cost centre. */
export const tagDocumentLinesBody = z.object({
  documentType: z.enum(["bill"]),
  documentId: zUuid,
  lineIds: z.array(zUuid).min(1).max(500),
  costCenterId: zUuid.nullable(),
});
export type TagDocumentLinesBody = z.output<typeof tagDocumentLinesBody>;
