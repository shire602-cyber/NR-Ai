import { z } from 'zod';

/**
 * Firm-managed-client domain helpers.
 *
 * The functions here are pure (no DB access) so they can be unit-tested
 * cheaply. They support the /api/firm/clients/* routes — primarily the bulk
 * CSV/XLSX import path, which has to be forgiving about column-header
 * variations across spreadsheets exported from QuickBooks, Zoho, Excel, etc.
 */

export const importedClientSchema = z.object({
  name: z.string().min(1),
  trnVatNumber: z.string().optional().or(z.literal('')),
  industry: z.string().optional().or(z.literal('')),
  legalStructure: z.string().optional().or(z.literal('')),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().optional().or(z.literal('')),
  businessAddress: z.string().optional().or(z.literal('')),
  emirate: z.string().optional().or(z.literal('')),
  vatFilingFrequency: z.string().optional().or(z.literal('')),
  registrationNumber: z.string().optional().or(z.literal('')),
  websiteUrl: z.string().optional().or(z.literal('')),
});

export type ImportedClient = z.infer<typeof importedClientSchema>;

const VALID_EMIRATES = new Set([
  'abu_dhabi',
  'dubai',
  'sharjah',
  'ajman',
  'umm_al_quwain',
  'ras_al_khaimah',
  'fujairah',
]);

const VALID_VAT_FILING = new Set(['monthly', 'quarterly', 'annually']);

/**
 * Look up the first non-empty value across a list of column-name candidates,
 * trimming whitespace. Returns '' when nothing matches.
 */
function pick(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/**
 * Normalise an emirate value to our canonical `lower_snake_case` form.
 * Unknown values fall back to empty so callers can default to 'dubai'.
 */
export function normaliseEmirate(raw: string): string {
  const slug = raw.toLowerCase().trim().replace(/\s+/g, '_');
  return VALID_EMIRATES.has(slug) ? slug : '';
}

/**
 * Normalise a VAT-filing-frequency value. Anything unrecognised is dropped so
 * the caller can fall back to the default.
 */
export function normaliseVatFiling(raw: string): string {
  const slug = raw.toLowerCase().trim();
  return VALID_VAT_FILING.has(slug) ? slug : '';
}

/**
 * Map a free-form CSV/Excel row into our import shape. Returns an `error`
 * object instead of throwing when essential fields (the company name) are
 * missing — the caller aggregates these into per-row error reports.
 */
export function mapImportRow(
  row: Record<string, unknown>,
): ImportedClient | { error: string } {
  const name = pick(
    row,
    'name', 'Name', 'Company Name', 'company_name', 'Client Name', 'client', 'Business Name',
  );
  if (!name) return { error: 'Company name is required' };

  return {
    name,
    trnVatNumber: pick(row, 'trnVatNumber', 'trn', 'TRN', 'VAT Number', 'Tax Registration Number'),
    industry: pick(row, 'industry', 'Industry', 'Sector', 'Business Type'),
    legalStructure: pick(row, 'legalStructure', 'Legal Structure', 'legal_structure', 'Business Structure'),
    contactEmail: pick(row, 'contactEmail', 'email', 'Email', 'Contact Email', 'contact_email', 'E-mail'),
    contactPhone: pick(row, 'contactPhone', 'phone', 'Phone', 'Contact Phone', 'contact_phone', 'Tel', 'Telephone'),
    businessAddress: pick(row, 'businessAddress', 'address', 'Address', 'Business Address', 'business_address'),
    emirate: normaliseEmirate(pick(row, 'emirate', 'Emirate')),
    vatFilingFrequency: normaliseVatFiling(pick(row, 'vatFilingFrequency', 'VAT Filing', 'VAT Frequency')),
    registrationNumber: pick(row, 'registrationNumber', 'Registration Number', 'registration_number'),
    websiteUrl: pick(row, 'websiteUrl', 'website', 'Website', 'URL', 'Web'),
  };
}

/**
 * Validate a mapped row. Returns the parsed value on success or a string
 * error message on failure (e.g. "invalid email").
 */
export function validateImportedClient(
  mapped: ImportedClient,
): { ok: true; value: ImportedClient } | { ok: false; error: string } {
  const result = importedClientSchema.safeParse(mapped);
  if (!result.success) {
    return { ok: false, error: result.error.errors[0]?.message ?? 'Invalid row' };
  }
  return { ok: true, value: result.data };
}
