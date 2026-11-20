/**
 * Platform-admin write contracts (R17-20): admin company / client edits and
 * client notes. Every schema is `.strict()` so `strictBody` rejects unknown keys (ids, timestamps,
 * server-owned fields) with a 400 instead of passing them to a Drizzle write.
 */
import { z } from "zod";
import { companyFields, updateCompanyBody } from "./companies";
import { zEmail, zText } from "./primitives";

const optText = (max: number) => zText(max).optional().nullable();
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

/** PUT /api/admin/settings: upsert one setting; the value column is text, so scalars coerce. */
export const upsertAdminSettingBody = z
  .object({
    key: zText(200, { min: 1 }),
    value: z.union([z.string().max(20_000), z.number(), z.boolean()]).transform((v) => String(v)),
  })
  .strict();
export type UpsertAdminSettingBody = z.output<typeof upsertAdminSettingBody>;

/** POST /api/admin/clients: the company field rules of the PATCH for the fields it always took. */
export const adminCreateClientBody = z
  .object({
    name: companyFields.name,
    baseCurrency: companyFields.baseCurrency,
    locale: companyFields.locale,
    companyType: companyFields.companyType,
    legalStructure: companyFields.legalStructure,
    industry: companyFields.industry,
    registrationNumber: companyFields.registrationNumber,
    businessAddress: companyFields.businessAddress,
    contactPhone: companyFields.contactPhone,
    contactEmail: companyFields.contactEmail,
    websiteUrl: companyFields.websiteUrl,
    logoUrl: companyFields.logoUrl,
    trnVatNumber: companyFields.trnVatNumber,
    taxRegistrationType: companyFields.taxRegistrationType,
    vatFilingFrequency: companyFields.vatFilingFrequency,
    corporateTaxId: companyFields.corporateTaxId,
  })
  .strict();
export type AdminCreateClientBody = z.output<typeof adminCreateClientBody>;

/** PATCH /api/admin/users/:userId */
export const adminUpdateUserBody = z
  .object({
    name: zText(200).optional(),
    email: zEmail.optional(),
    isAdmin: z.boolean().optional(),
  })
  .strict();
export type AdminUpdateUserBody = z.output<typeof adminUpdateUserBody>;

/** POST /api/admin/invitations (companyId is a body field here; the route is admin-only). */
export const adminCreateInvitationBody = z
  .object({
    email: zEmail,
    companyId: z.string().uuid().optional().nullable(),
    role: zText(40).optional(),
    userType: z.enum(["admin", "client", "customer"]).optional(),
  })
  .strict();
export type AdminCreateInvitationBody = z.output<typeof adminCreateInvitationBody>;

/** POST /api/admin/clients/:clientId/notes */
export const createClientNoteBody = z
  .object({ content: zText(10_000, { min: 1 }), isPinned: z.boolean().optional() })
  .strict();
export type CreateClientNoteBody = z.output<typeof createClientNoteBody>;

/** POST /api/admin/import/clients: rows are spreadsheet records; the route reads known columns. */
export const adminImportClientsBody = z
  .object({
    data: z.array(z.record(z.string(), z.unknown())).max(5000),
    createInvitations: z.boolean().optional(),
    sendEmails: z.boolean().optional(),
  })
  .strict();
export type AdminImportClientsBody = z.output<typeof adminImportClientsBody>;

/** POST /api/admin/import/preview: base64 spreadsheet payload. */
export const adminImportPreviewBody = z
  .object({ fileData: z.string().min(1), fileName: zText(300).optional() })
  .strict();
export type AdminImportPreviewBody = z.output<typeof adminImportPreviewBody>;

/** POST /api/admin/clients/:clientId/documents */
export const adminCreateClientDocumentBody = z
  .object({
    name: zText(300, { min: 1 }),
    nameAr: optText(300),
    category: zText(100, { min: 1 }),
    description: optText(5000),
    fileUrl: optText(2048),
    fileName: optText(300),
    fileSize: z.number().int().min(0).optional().nullable(),
    mimeType: optText(150),
    expiryDate: z.string().max(40).optional().nullable(),
    reminderDays: z.number().int().min(0).max(3650).optional().nullable(),
    tags: optText(2000),
  })
  .strict();
export type AdminCreateClientDocumentBody = z.output<typeof adminCreateClientDocumentBody>;
