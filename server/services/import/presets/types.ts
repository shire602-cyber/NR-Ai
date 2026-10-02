import type { DateFormat, NumberFormat } from "../parse";

export const IMPORT_SOURCES = ["zoho", "quickbooks", "xero", "generic"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_ENTITIES = ["contacts", "items", "accounts", "opening_tb", "open_invoices", "open_bills"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

/** canonical field -> header names the source uses for it (matched without case, spaces or punctuation). */
export type AliasMap = Record<string, string[]>;

export interface SourcePreset {
  source: ImportSource;
  label: string;
  defaults: { dateFormat: DateFormat; numberFormat: NumberFormat };
  aliases: Partial<Record<ImportEntity, AliasMap>>;
}
