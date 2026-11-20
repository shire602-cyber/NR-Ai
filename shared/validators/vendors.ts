/**
 * Vendor master and approval-rule write contracts (W3-B: R04-16, R04-19).
 */
import { z } from "zod";
import { COMPANY_ROLES, PERMISSIONS } from "../permissions";
import { zCurrency, zEmail, zEmirate, zMoney, zText, zTrn, zUuid } from "./primitives";

const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, z.literal("").transform(() => null)]);

const vendorFields = {
  name: zText(255, { min: 1 }),
  name_ar: zText(255).optional().nullable(),
  trn: emptyToNull(zTrn).optional().nullable(),
  email: emptyToNull(zEmail).optional().nullable(),
  phone: zText(40).optional().nullable(),
  address: zText(500).optional().nullable(),
  emirate: emptyToNull(zEmirate).optional().nullable(),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Country must be a 2-letter ISO code")
    .transform((s) => s.toUpperCase())
    .optional(),
  payment_terms_days: z.coerce.number().int().min(0).max(365).optional(),
  currency: zCurrency.optional(),
  default_expense_account_id: zUuid.optional().nullable(),
  iban: zText(34).optional().nullable(),
  bank_name: zText(120).optional().nullable(),
  notes: zText(2000).optional().nullable(),
};

export const vendorCreateSchema = z.object(vendorFields);
export type VendorCreateInput = z.output<typeof vendorCreateSchema>;

export const vendorUpdateSchema = z
  .object({
    ...vendorFields,
    name: vendorFields.name.optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update");
export type VendorUpdateInput = z.output<typeof vendorUpdateSchema>;

export const approvalRuleCreateSchema = z
  .object({
    name: zText(120, { min: 1 }),
    document_type: z.enum(["bill", "purchase_order", "expense_claim", "payroll", "budget"]),
    min_amount: zMoney,
    max_amount: zMoney.optional().nullable(),
    step_order: z.coerce.number().int().min(1).max(10).optional(),
    required_permission: z.enum(PERMISSIONS).optional(),
    required_role: z.enum(COMPANY_ROLES).optional().nullable(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.max_amount === null ||
      v.max_amount === undefined ||
      Number(v.max_amount) >= Number(v.min_amount),
    { message: "max_amount must be at least min_amount", path: ["max_amount"] }
  );
export type ApprovalRuleCreateInput = z.output<typeof approvalRuleCreateSchema>;

export const approvalSettingsSchema = z.object({
  allow_single_member_self_approval: z.boolean(),
});
