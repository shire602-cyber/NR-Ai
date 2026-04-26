import { z } from 'zod';

/**
 * Common request-shape validators shared between client and server.
 * Drizzle table schemas live in schema.ts; this file is the home for
 * cross-cutting query/param/body shapes that aren't tied to a single table.
 */

// ── Primitives ────────────────────────────────────────────────────
export const uuidSchema = z.string().uuid('Must be a valid UUID');

export const idParamSchema = z.object({
  id: uuidSchema,
});

export const companyIdParamSchema = z.object({
  companyId: uuidSchema,
});

// ── Pagination / list filters ────────────────────────────────────
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// Date range — strings for query strings; ISO 8601 is enforced.
export const dateRangeSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

// ── Money / currency ─────────────────────────────────────────────
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO 4217 code');

export const moneySchema = z
  .number()
  .finite()
  .refine((n) => Math.round(n * 100) === n * 100, {
    message: 'Money values must have at most 2 decimal places',
  });

// ── Auth payloads ────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});

export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
  name: z.string().trim().min(1).max(120),
  companyName: z.string().trim().min(1).max(200).optional(),
});

// ── Common request body for creating a contact / customer ────────
export const contactInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().email().max(254).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  trn: z
    .string()
    .trim()
    .regex(/^[0-9]{15}$/, 'UAE TRN must be 15 digits')
    .optional()
    .nullable(),
  address: z.string().trim().max(500).optional().nullable(),
});

// ── Generic structured 400 response shape ────────────────────────
export const validationErrorResponseSchema = z.object({
  message: z.literal('Validation error'),
  errors: z.record(z.array(z.string()).optional()),
  formErrors: z.array(z.string()).optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ContactInput = z.infer<typeof contactInputSchema>;
