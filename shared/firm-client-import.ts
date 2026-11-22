export const CLIENT_IMPORT_FILE_TYPES = [".csv", ".xlsx"] as const;

export function isClientImportFileName(name: string): boolean {
  return CLIENT_IMPORT_FILE_TYPES.some((extension) => name.toLowerCase().endsWith(extension));
}

export type ClientImportRowErrorCode =
  | "NAME_REQUIRED"
  | "INVALID_ROW"
  | "DUPLICATE_ROW"
  | "DUPLICATE_CLIENT"
  | "ROW_FAILED";

export interface ClientImportRowError {
  row: number;
  name: string;
  code: ClientImportRowErrorCode;
  error: string;
  field?: string;
}

export interface ClientImportResult {
  message: string;
  created: { id: string; name: string }[];
  errors: ClientImportRowError[];
}
