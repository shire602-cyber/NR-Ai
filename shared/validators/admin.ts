/**
 * Platform-admin write contracts (R17-20): subscription plans, admin company / client edits and
 * client notes. Every schema is `.strict()` so `strictBody` rejects unknown keys (ids, timestamps,
 * server-owned fields) with a 400 instead of passing them to a Drizzle write.
 */
import { z } from "zod";
import { updateCompanyBody } from "./companies";
import { zCurrency, zMoney, zText } from "./primitives";

const optText = (max: number) => zText(max).optional().nullable();
const optCount = z.number().int().min(0).max(1_000_000).optional().nullable();
/** Plan price in major units (2dp, >= 0) → number, as the numeric money column stores it. */
const planPrice = zMoney.transform(Number);

const planFields = {
  name: zText(120, { min: 1 }),
  nameAr: optText(120),
  description: optText(2000),
  descriptionAr: optText(2000),
  priceMonthly: planPrice,
  priceYearly: planPrice.optional().nullable(),
  currency: zCurrency.optional(),
  /** JSON array of feature labels, stored as text. */
  features: z.string().max(10_000).optional().nullable(),
  maxCompanies: optCount,
  maxUsers: optCount,
  maxInvoicesPerMonth: optCount,
  maxReceiptsPerMonth: optCount,
  aiCreditsPerMonth: optCount,
  hasWhatsappIntegration: z.boolean().optional(),
  hasAdvancedReports: z.boolean().optional(),
  hasApiAccess: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000).optional().nullable(),
};

/** POST /api/admin/plans */
export const createSubscriptionPlanBody = z.object(planFields).strict();
export type CreateSubscriptionPlanBody = z.output<typeof createSubscriptionPlanBody>;

/** PUT /api/admin/plans/:id — every field optional. */
export const updateSubscriptionPlanBody = z
  .object(planFields)
  .partial()
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "No fields to update");
export type UpdateSubscriptionPlanBody = z.output<typeof updateSubscriptionPlanBody>;

/**
 * PATCH /api/admin/companies/:companyId and PATCH /api/admin/clients/:clientId: the same
 * company field contract as the tenant routes (companyType is allowed: these are admin-only).
 */
export const adminUpdateCompanyBody = updateCompanyBody.strict();
export type AdminUpdateCompanyBody = z.output<typeof adminUpdateCompanyBody>;

/** PATCH /api/admin/notes/:noteId */
export const updateClientNoteBody = z
  .object({
    content: zText(10_000, { min: 1 }).optional(),
    isPinned: z.boolean().optional(),
  })
  .strict();
export type UpdateClientNoteBody = z.output<typeof updateClientNoteBody>;
