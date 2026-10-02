import { normalizeHeader } from "../parse";
import { generic } from "./generic";
import { quickbooks } from "./quickbooks";
import type { AliasMap, ImportEntity, ImportSource, SourcePreset } from "./types";
import { xero } from "./xero";
import { zoho } from "./zoho";

export { IMPORT_ENTITIES, IMPORT_SOURCES } from "./types";
export type { ImportEntity, ImportSource } from "./types";

export const PRESETS: Record<ImportSource, SourcePreset> = { zoho, quickbooks, xero, generic };

/** canonical field -> detected column; the source's own aliases first, then the generic ones. */
export function suggestMapping(source: ImportSource, entity: ImportEntity, headers: string[]): Record<string, string> {
  const byNorm = new Map<string, string>();
  for (const h of headers) if (!byNorm.has(normalizeHeader(h))) byNorm.set(normalizeHeader(h), h);
  const merged: AliasMap = {};
  const sources = [PRESETS[source].aliases[entity] ?? {}, generic.aliases[entity] ?? {}];
  for (const aliasMap of sources) {
    for (const [field, aliases] of Object.entries(aliasMap)) merged[field] = [...(merged[field] ?? []), ...aliases];
  }
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(merged)) {
    for (const alias of aliases) {
      const header = byNorm.get(normalizeHeader(alias));
      if (header && !used.has(header)) {
        out[field] = header;
        used.add(header);
        break;
      }
    }
  }
  return out;
}

export const defaultOptionsFor = (source: ImportSource) => ({ ...PRESETS[source].defaults });
