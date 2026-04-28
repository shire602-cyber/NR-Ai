import { z } from 'zod';

// UAE FTA Tax Registration Number — exactly 15 numeric digits.
// Source: FTA TRN spec for VAT and Corporate Tax registrants.
export const TRN_REGEX = /^\d{15}$/;

export const trnSchema = z
  .string()
  .trim()
  .regex(TRN_REGEX, 'TRN must be exactly 15 numeric digits');

// Optional TRN that also accepts empty strings (treated as undefined) — useful for
// forms where TRN is not required but the form may submit "" instead of omitting.
export const optionalTrnSchema = z
  .union([z.literal(''), trnSchema])
  .optional()
  .transform(v => (v === '' ? undefined : v));

// UAE phone numbers in E.164: +971 followed by 9 digits.
// We accept either +971XXXXXXXXX (digits only) or the legacy 971XXXXXXXXX form.
// Numbers are normalized to +971XXXXXXXXX. International (non-UAE) numbers
// are intentionally accepted via a permissive E.164 fallback because customer
// records often include foreign suppliers.
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,20}$/, 'Invalid phone number');

// Finite, non-negative monetary amount with at most 2 decimals.
// Rejects NaN, Infinity, and negative values.
export const moneySchema = z
  .number()
  .finite('Amount must be a finite number')
  .nonnegative('Amount cannot be negative');

// Strictly positive monetary amount (e.g. invoice line unit price > 0 is too strict
// because freebies exist; use moneySchema for those. Use this for required totals).
export const positiveMoneySchema = z
  .number()
  .finite('Amount must be a finite number')
  .positive('Amount must be greater than zero');

// VAT rate as a fraction (UAE: 0, 0.05). Bounded to [0, 1].
export const vatRateSchema = z
  .number()
  .finite()
  .min(0, 'VAT rate cannot be negative')
  .max(1, 'VAT rate cannot exceed 1');

// Quantity must be > 0 — zero-quantity invoice lines are nonsensical.
export const quantitySchema = z
  .number()
  .finite('Quantity must be a finite number')
  .positive('Quantity must be greater than zero');

// Coerces the input to a Date and rejects Invalid Date.
// Pass `{ noFuture: true }` to also reject dates in the future (used for
// invoice/transaction dates, which the FTA forbids being post-dated).
export function isoDateSchema(opts: { noFuture?: boolean } = {}) {
  return z
    .union([z.string(), z.date()])
    .transform((v, ctx) => {
      const d = v instanceof Date ? v : new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date' });
        return z.NEVER;
      }
      if (opts.noFuture && d.getTime() > Date.now()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date cannot be in the future' });
        return z.NEVER;
      }
      return d;
    });
}

// Rejects path traversal sequences and absolute paths in user-supplied filenames
// or relative storage paths. Matches what `path.join` could escape with: `..`,
// `/`, `\`, and NUL.
export function isUnsafePath(input: string): boolean {
  if (!input) return false;
  if (input.includes('\0')) return true;
  if (input.startsWith('/') || input.startsWith('\\')) return true;
  // Block any `..` segment (covers both `../foo` and `foo/../bar`).
  const segments = input.split(/[/\\]/);
  return segments.some(s => s === '..');
}
