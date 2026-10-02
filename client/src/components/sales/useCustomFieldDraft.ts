import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { salesKeys, type CustomFieldDefinition, type CustomFieldEntity, type CustomFieldValueRow } from "@/lib/sales-api";

export interface CustomFieldDraft {
  entity: CustomFieldEntity;
  /** Active definitions to render (archived ones appear only when the record already has a value). */
  fields: Array<Pick<CustomFieldDefinition, "key" | "labelEn" | "labelAr" | "fieldType" | "options"> & { id: string; archived: boolean }>;
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  isLoading: boolean;
  dirty: boolean;
  /** Save the values on a record (call after the document exists). Resolves with the server's rows. */
  save: (recordId: string) => Promise<void>;
  reset: () => void;
}

/**
 * The custom fields of one record being edited: definitions for the entity, the stored values of an existing
 * record, and the person's edits. Values are sent in one PUT after the document is saved (a new document has no id
 * until then).
 */
export function useCustomFieldDraft(companyId: string | undefined | null, entity: CustomFieldEntity, recordId: string | null | undefined): CustomFieldDraft {
  const definitions = useQuery<CustomFieldDefinition[]>({
    queryKey: salesKeys.customFields(companyId, entity),
    enabled: Boolean(companyId),
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/custom-fields?entity=${entity}`),
  });
  const stored = useQuery<CustomFieldValueRow[]>({
    queryKey: salesKeys.customFieldValues(companyId, entity, recordId),
    enabled: Boolean(companyId && recordId),
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/custom-fields/values/${entity}/${recordId}`),
  });

  const [edits, setEdits] = useState<Record<string, string>>({});
  // A different record (or a fresh form) starts from its own stored values.
  useEffect(() => setEdits({}), [recordId, entity]);

  const fields = useMemo(() => {
    const byKey = new Map<string, CustomFieldDraft["fields"][number]>();
    for (const d of definitions.data ?? []) {
      if (!d.isArchived) byKey.set(d.key, { id: d.id, key: d.key, labelEn: d.labelEn, labelAr: d.labelAr, fieldType: d.fieldType, options: d.options, archived: false });
    }
    for (const row of stored.data ?? []) {
      if (row.isArchived && row.value !== null) byKey.set(row.key, { id: row.definitionId, key: row.key, labelEn: row.labelEn, labelAr: row.labelAr, fieldType: row.fieldType, options: row.options, archived: true });
    }
    return [...byKey.values()];
  }, [definitions.data, stored.data]);

  const values = useMemo(() => {
    const base: Record<string, string> = {};
    for (const row of stored.data ?? []) if (row.value !== null) base[row.key] = row.value;
    return { ...base, ...edits };
  }, [stored.data, edits]);

  const setValue = useCallback((key: string, value: string) => setEdits((prev) => ({ ...prev, [key]: value })), []);
  const dirty = Object.keys(edits).length > 0;

  const save = useCallback(
    async (id: string) => {
      const payload: Record<string, string> = {};
      for (const f of fields) {
        const v = values[f.key];
        if (v !== undefined && (v !== "" || stored.data?.some((r) => r.key === f.key && r.value !== null))) payload[f.key] = v;
      }
      if (Object.keys(payload).length === 0) return;
      await apiRequest("PUT", `/api/companies/${companyId}/custom-fields/values/${entity}/${id}`, { values: payload });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "custom-fields", "values", entity] });
    },
    [companyId, entity, fields, values, stored.data]
  );

  const reset = useCallback(() => setEdits({}), []);

  return { entity, fields, values, setValue, isLoading: definitions.isLoading || stored.isLoading, dirty, save, reset };
}
