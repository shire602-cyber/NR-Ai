// Company-defined custom fields (Phase 8 D1): text, number, date or select fields on contacts, invoices, quotes,
// bills and sales orders, with English and Arabic labels, shown on PDFs and public pages when flagged.
//
// Values are polymorphic (entity + record id), so every read joins company_id and every write first proves the
// record belongs to the company (404 for another tenant's id).

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { customFieldDefinitions, customFieldValues, type CustomFieldDefinition } from "../../shared/schema";
import { AppError } from "../errors";
import { uuidArray } from "./sql-uuid-array";

export const CUSTOM_FIELD_ENTITIES = ["contact", "invoice", "quote", "bill", "sales_order"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select"] as const;
export const MAX_ACTIVE_FIELDS_PER_ENTITY = 30;
export const MAX_SELECT_OPTIONS = 50;
const MAX_TEXT_LENGTH = 500;

const TABLE_OF: Record<CustomFieldEntity, string> = {
  contact: "customer_contacts",
  invoice: "invoices",
  quote: "quotes",
  bill: "vendor_bills",
  sales_order: "sales_orders",
};

const refuse = (statusCode: number, code: string, message: string, details?: unknown) =>
  new AppError({ message, statusCode, code, details });
const rowsOf = (res: any): any[] => (res?.rows ?? res) as any[];

export function isEntity(value: unknown): value is CustomFieldEntity {
  return typeof value === "string" && (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(value);
}

// ─── pure validation (unit-tested) ──────────────────────────────────────────

export type FieldCheck = { ok: true; value: string } | { ok: false; message: string };

/** Validate and canonicalise one value against its definition. An empty value means "clear". */
export function validateFieldValue(
  def: { fieldType: string; options?: unknown },
  raw: unknown
): FieldCheck | { ok: true; value: "" } {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return { ok: true, value: "" };
  const text = String(raw).trim();
  switch (def.fieldType) {
    case "text":
      return text.length > MAX_TEXT_LENGTH ? { ok: false, message: `At most ${MAX_TEXT_LENGTH} characters.` } : { ok: true, value: text };
    case "number": {
      if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(Number(text)) || Math.abs(Number(text)) > 1e15) {
        return { ok: false, message: "Must be a number." };
      }
      return { ok: true, value: String(Number(text)) };
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, message: "Must be a date as YYYY-MM-DD." };
      const d = new Date(`${text}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) return { ok: false, message: "Must be a real date." };
      return { ok: true, value: text };
    }
    case "select": {
      const options = Array.isArray(def.options) ? (def.options as unknown[]).map(String) : [];
      return options.includes(text) ? { ok: true, value: text } : { ok: false, message: "Must be one of the listed options." };
    }
    default:
      return { ok: false, message: "Unknown field type." };
  }
}

export interface DefinitionInput {
  entity: CustomFieldEntity;
  key: string;
  labelEn: string;
  labelAr: string;
  fieldType: (typeof CUSTOM_FIELD_TYPES)[number];
  options?: string[];
  showOnPdf?: boolean;
  sortOrder?: number;
}

export function validateOptions(fieldType: string, options: unknown): string[] {
  if (fieldType !== "select") return [];
  if (!Array.isArray(options) || options.length === 0) {
    throw refuse(422, "CUSTOM_FIELD_INVALID", "A select field needs at least one option.");
  }
  const cleaned = options.map((o) => String(o).trim()).filter(Boolean);
  if (cleaned.length === 0 || cleaned.length > MAX_SELECT_OPTIONS || new Set(cleaned).size !== cleaned.length) {
    throw refuse(422, "CUSTOM_FIELD_INVALID", `A select field needs 1 to ${MAX_SELECT_OPTIONS} different options.`);
  }
  if (cleaned.some((o) => o.length > 100)) throw refuse(422, "CUSTOM_FIELD_INVALID", "An option is at most 100 characters.");
  return cleaned;
}

// ─── definitions ────────────────────────────────────────────────────────────

export async function listDefinitions(companyId: string, entity?: CustomFieldEntity, includeArchived = false) {
  const conds = [eq(customFieldDefinitions.companyId, companyId)];
  if (entity) conds.push(eq(customFieldDefinitions.entity, entity));
  if (!includeArchived) conds.push(eq(customFieldDefinitions.isArchived, false));
  return await db
    .select()
    .from(customFieldDefinitions)
    .where(and(...conds))
    .orderBy(asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.labelEn));
}

export async function createDefinition(companyId: string, input: DefinitionInput) {
  const options = validateOptions(input.fieldType, input.options);
  const active = await listDefinitions(companyId, input.entity);
  if (active.length >= MAX_ACTIVE_FIELDS_PER_ENTITY) {
    throw refuse(422, "CUSTOM_FIELD_LIMIT", `At most ${MAX_ACTIVE_FIELDS_PER_ENTITY} active custom fields per record type.`);
  }
  try {
    const [row] = await db
      .insert(customFieldDefinitions)
      .values({
        companyId,
        entity: input.entity,
        key: input.key,
        labelEn: input.labelEn.trim(),
        labelAr: input.labelAr.trim(),
        fieldType: input.fieldType,
        options,
        showOnPdf: input.showOnPdf ?? false,
        sortOrder: input.sortOrder ?? active.length,
      } as any)
      .returning();
    return row;
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      throw refuse(409, "CUSTOM_FIELD_EXISTS", "A custom field with this key already exists for this record type.");
    }
    throw err;
  }
}

export async function updateDefinition(
  companyId: string,
  id: string,
  patch: Partial<Pick<DefinitionInput, "labelEn" | "labelAr" | "options" | "showOnPdf" | "sortOrder">> & { isArchived?: boolean }
) {
  const [def] = await db
    .select()
    .from(customFieldDefinitions)
    .where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.companyId, companyId)));
  if (!def) return null;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.labelEn !== undefined) set.labelEn = patch.labelEn.trim();
  if (patch.labelAr !== undefined) set.labelAr = patch.labelAr.trim();
  if (patch.showOnPdf !== undefined) set.showOnPdf = patch.showOnPdf;
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
  if (patch.options !== undefined) set.options = validateOptions(def.fieldType, patch.options);
  if (patch.isArchived !== undefined) {
    if (!patch.isArchived && def.isArchived) {
      const active = await listDefinitions(companyId, def.entity as CustomFieldEntity);
      if (active.length >= MAX_ACTIVE_FIELDS_PER_ENTITY) {
        throw refuse(422, "CUSTOM_FIELD_LIMIT", `At most ${MAX_ACTIVE_FIELDS_PER_ENTITY} active custom fields per record type.`);
      }
    }
    set.isArchived = patch.isArchived;
  }
  const [row] = await db
    .update(customFieldDefinitions)
    .set(set as any)
    .where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.companyId, companyId)))
    .returning();
  return row;
}

/** Archive when values exist (they stay on the documents), delete otherwise. */
export async function deleteDefinition(companyId: string, id: string): Promise<"archived" | "deleted" | null> {
  const [def] = await db
    .select()
    .from(customFieldDefinitions)
    .where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.companyId, companyId)));
  if (!def) return null;
  const used = await db
    .select({ id: customFieldValues.id })
    .from(customFieldValues)
    .where(and(eq(customFieldValues.definitionId, id), eq(customFieldValues.companyId, companyId)))
    .limit(1);
  if (used.length > 0) {
    await db
      .update(customFieldDefinitions)
      .set({ isArchived: true, updatedAt: new Date() } as any)
      .where(eq(customFieldDefinitions.id, id));
    return "archived";
  }
  await db.delete(customFieldDefinitions).where(eq(customFieldDefinitions.id, id));
  return "deleted";
}

// ─── values ─────────────────────────────────────────────────────────────────

/** The record's status when it exists in this company (null = not found). */
async function recordStatus(companyId: string, entity: CustomFieldEntity, recordId: string): Promise<{ status: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(recordId)) return null;
  const table = sql.raw(TABLE_OF[entity]);
  const hasStatus = entity !== "contact";
  const res = hasStatus
    ? await db.execute(sql`SELECT status FROM ${table} WHERE id = ${recordId}::uuid AND company_id = ${companyId}::uuid`)
    : await db.execute(sql`SELECT NULL::text AS status FROM ${table} WHERE id = ${recordId}::uuid AND company_id = ${companyId}::uuid`);
  const row = rowsOf(res)[0];
  return row ? { status: row.status ?? null } : null;
}

export async function getValues(companyId: string, entity: CustomFieldEntity, recordId: string) {
  const record = await recordStatus(companyId, entity, recordId);
  if (!record) throw refuse(404, "RECORD_NOT_FOUND", "Record not found");
  const defs = await listDefinitions(companyId, entity, true);
  const values = await db
    .select()
    .from(customFieldValues)
    .where(and(eq(customFieldValues.companyId, companyId), eq(customFieldValues.entity, entity), eq(customFieldValues.recordId, recordId)));
  const byDef = new Map(values.map((v: any) => [v.definitionId, v.value as string]));
  return defs
    .filter((d: CustomFieldDefinition) => !d.isArchived || byDef.has(d.id))
    .map((d: CustomFieldDefinition) => ({
      definitionId: d.id,
      key: d.key,
      labelEn: d.labelEn,
      labelAr: d.labelAr,
      fieldType: d.fieldType,
      options: d.options,
      showOnPdf: d.showOnPdf,
      isArchived: d.isArchived,
      value: byDef.get(d.id) ?? null,
    }));
}

/** Set values by field key ({key: value}); an empty value clears the field. 422 lists every invalid field. */
export async function setValues(companyId: string, entity: CustomFieldEntity, recordId: string, input: Record<string, unknown>) {
  const record = await recordStatus(companyId, entity, recordId);
  if (!record) throw refuse(404, "RECORD_NOT_FOUND", "Record not found");
  // A tax invoice is a fixed document once it is issued: its fields freeze with it.
  if (entity === "invoice" && record.status !== "draft") {
    throw refuse(409, "DOCUMENT_LOCKED", "This invoice has been issued, so its custom fields can no longer change.");
  }
  const defs = await listDefinitions(companyId, entity);
  const byKey = new Map<string, CustomFieldDefinition>(defs.map((d: CustomFieldDefinition) => [d.key, d]));
  const errors: Record<string, string> = {};
  const writes: Array<{ def: CustomFieldDefinition; value: string }> = [];
  for (const [key, raw] of Object.entries(input ?? {})) {
    const def = byKey.get(key);
    if (!def) {
      errors[key] = "Unknown custom field.";
      continue;
    }
    const check = validateFieldValue(def, raw);
    if (!check.ok) errors[key] = check.message;
    else writes.push({ def, value: check.value });
  }
  if (Object.keys(errors).length > 0) {
    throw refuse(422, "CUSTOM_FIELD_INVALID", "Some custom field values are not valid.", { fields: errors });
  }
  await db.transaction(async (tx: typeof db) => {
    for (const w of writes) {
      if (w.value === "") {
        await tx
          .delete(customFieldValues)
          .where(and(eq(customFieldValues.definitionId, w.def.id), eq(customFieldValues.recordId, recordId), eq(customFieldValues.companyId, companyId)));
      } else {
        await tx
          .insert(customFieldValues)
          .values({ companyId, entity, recordId, definitionId: w.def.id, value: w.value } as any)
          .onConflictDoUpdate({ target: [customFieldValues.definitionId, customFieldValues.recordId], set: { value: w.value, updatedAt: new Date() } });
      }
    }
  });
  return getValues(companyId, entity, recordId);
}

/** Fields flagged for PDFs and public pages, with both labels, for one record. */
export async function pdfFieldsFor(companyId: string, entity: CustomFieldEntity, recordId: string) {
  const res = await db.execute(sql`
    SELECT d.key, d.label_en AS "labelEn", d.label_ar AS "labelAr", d.field_type AS "fieldType", v.value
      FROM custom_field_definitions d
      JOIN custom_field_values v ON v.definition_id = d.id AND v.record_id = ${recordId}::uuid AND v.company_id = ${companyId}::uuid
     WHERE d.company_id = ${companyId}::uuid AND d.entity = ${entity} AND d.show_on_pdf = true
     ORDER BY d.sort_order, d.label_en`);
  return rowsOf(res) as Array<{ key: string; labelEn: string; labelAr: string; fieldType: string; value: string }>;
}

/** Copy values when a document is derived from another (quote -> sales order -> invoice). */
export async function copyValues(
  companyId: string,
  from: { entity: CustomFieldEntity; recordId: string },
  to: { entity: CustomFieldEntity; recordId: string },
  tx: typeof db = db
) {
  await tx.execute(sql`
    INSERT INTO custom_field_values (company_id, entity, record_id, definition_id, value)
    SELECT v.company_id, ${to.entity}, ${to.recordId}::uuid, nd.id, v.value
      FROM custom_field_values v
      JOIN custom_field_definitions od ON od.id = v.definition_id
      JOIN custom_field_definitions nd ON nd.company_id = od.company_id AND nd.entity = ${to.entity} AND nd.key = od.key AND nd.is_archived = false
     WHERE v.company_id = ${companyId}::uuid AND v.entity = ${from.entity} AND v.record_id = ${from.recordId}::uuid
       AND nd.field_type = od.field_type
    ON CONFLICT (definition_id, record_id) DO NOTHING`);
}

/** Flagged fields for many records of one entity, keyed by record id (one query). */
export async function pdfFieldsForMany(companyId: string, entity: CustomFieldEntity, recordIds: string[]) {
  const out = new Map<string, Array<{ key: string; labelEn: string; labelAr: string; fieldType: string; value: string }>>();
  if (recordIds.length === 0) return out;
  const res = await db.execute(sql`
    SELECT v.record_id::text AS "recordId", d.key, d.label_en AS "labelEn", d.label_ar AS "labelAr", d.field_type AS "fieldType", v.value
      FROM custom_field_definitions d
      JOIN custom_field_values v ON v.definition_id = d.id AND v.company_id = ${companyId}::uuid
     WHERE d.company_id = ${companyId}::uuid AND d.entity = ${entity} AND d.show_on_pdf = true
       AND v.record_id = ANY(${uuidArray(recordIds)})
     ORDER BY d.sort_order, d.label_en`);
  for (const row of rowsOf(res)) {
    const list = out.get(row.recordId) ?? [];
    list.push({ key: row.key, labelEn: row.labelEn, labelAr: row.labelAr, fieldType: row.fieldType, value: row.value });
    out.set(row.recordId, list);
  }
  return out;
}
