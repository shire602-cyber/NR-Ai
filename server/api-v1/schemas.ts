/**
 * Strict zod (v4) bodies for the v1 API. Every object is a whitelist: an unknown
 * key is a 400, so a client can never reach columns the internal routes keep
 * for the system (isOpeningBalance, companyId, status, number, source, ...).
 * The same schemas feed the OpenAPI document.
 */
import { z } from "zod/v4";

export const MONEY_MAX = 9_000_000_000_000;

/** Money with at most two decimals, as "123.45" or a number; normalised to a number. */
export const money = z
  .union([
    z.string().regex(/^\d{1,13}(\.\d{1,2})?$/, "Amount must be a non-negative decimal with at most 2 decimal places"),
    z
      .number()
      .min(0)
      .max(MONEY_MAX)
      .refine((v) => Math.abs(Math.round(v * 100) / 100 - v) < 1e-9, "Amount can have at most 2 decimal places"),
  ])
  .transform((v) => Number(v))
  .meta({ description: "Decimal amount, at most 2 decimal places", example: "1250.00" });

export const positiveMoney = money.refine((v) => v > 0, "Amount must be greater than zero");

const quantity = z
  .union([z.string().regex(/^\d{1,9}(\.\d{1,4})?$/), z.number().max(1_000_000_000)])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v) && v > 0, "Quantity must be greater than zero")
  .meta({ description: "Quantity, up to 4 decimal places", example: "2" });

/** UAE VAT: exactly 0% or 5% (decimal 0.05 or percent 5). */
const vatRate = z
  .union([z.literal(0), z.literal(0.05), z.literal(5), z.literal("0"), z.literal("0.05"), z.literal("5")])
  .transform((v) => (Number(v) === 5 ? 0.05 : Number(v)))
  .meta({ description: "0 or 0.05 (5 is accepted as 5%)", example: 0.05 });

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Not a real calendar date")
  .meta({ example: "2026-10-02" });

const uuid = z.string().uuid();
const currency = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. AED").meta({ example: "AED" });
const rate = z
  .union([z.number(), z.string().regex(/^\d{1,6}(\.\d{1,8})?$/)])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v) && v > 0 && v < 1_000_000, "Rate must be positive");
const text = (max: number) => z.string().trim().max(max);

// ───────────────────────── Contacts ─────────────────────────
const contactFields = {
  name: text(255).min(1),
  type: z.enum(["customer", "vendor", "both"]),
  nameAr: text(255).nullable(),
  email: z.email().max(255).nullable(),
  phone: text(40).nullable(),
  trn: z.string().regex(/^\d{15}$/, "A UAE TRN is exactly 15 digits").nullable(),
  address: text(500).nullable(),
  city: text(100).nullable(),
  country: text(100).nullable(),
  contactPerson: text(255).nullable(),
  paymentTermsDays: z.number().int().min(0).max(365),
  notes: text(2000).nullable(),
  isActive: z.boolean(),
};
export const contactCreate = z.strictObject({
  name: contactFields.name,
  type: contactFields.type.optional(),
  nameAr: contactFields.nameAr.optional(),
  email: contactFields.email.optional(),
  phone: contactFields.phone.optional(),
  trn: contactFields.trn.optional(),
  address: contactFields.address.optional(),
  city: contactFields.city.optional(),
  country: contactFields.country.optional(),
  contactPerson: contactFields.contactPerson.optional(),
  paymentTermsDays: contactFields.paymentTermsDays.optional(),
  notes: contactFields.notes.optional(),
});
export const contactUpdate = z
  .strictObject({
    name: contactFields.name.optional(),
    type: contactFields.type.optional(),
    nameAr: contactFields.nameAr.optional(),
    email: contactFields.email.optional(),
    phone: contactFields.phone.optional(),
    trn: contactFields.trn.optional(),
    address: contactFields.address.optional(),
    city: contactFields.city.optional(),
    country: contactFields.country.optional(),
    contactPerson: contactFields.contactPerson.optional(),
    paymentTermsDays: contactFields.paymentTermsDays.optional(),
    notes: contactFields.notes.optional(),
    isActive: contactFields.isActive.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "Send at least one field to change");

// ───────────────────────── Items ─────────────────────────
const itemBase = {
  name: text(255).min(1),
  nameAr: text(255).nullable().optional(),
  sku: text(64).nullable().optional(),
  description: text(2000).nullable().optional(),
  unitPrice: money,
  costPrice: money.nullable().optional(),
  vatRate: vatRate.optional(),
  unit: text(32).min(1).optional(),
  trackInventory: z.boolean().optional(),
  lowStockThreshold: z.number().int().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
};
export const itemCreate = z.strictObject(itemBase);
export const itemUpdate = z
  .strictObject({ ...itemBase, name: itemBase.name.optional(), unitPrice: itemBase.unitPrice.optional() })
  .refine((o) => Object.keys(o).length > 0, "Send at least one field to change");

// ───────────────────────── Invoices ─────────────────────────
const invoiceLine = z.strictObject({
  description: text(1000).min(1),
  quantity,
  unitPrice: money,
  vatRate: vatRate.optional(),
  vatSupplyType: z.enum(["standard_rated", "zero_rated", "exempt", "out_of_scope"]).nullable().optional(),
  productId: uuid.nullable().optional(),
  revenueAccountId: uuid.nullable().optional(),
});
export const invoiceCreate = z.strictObject({
  contactId: uuid.nullable().optional(),
  customerName: text(255).min(1).optional(),
  customerTrn: z.string().regex(/^\d{15}$/, "A UAE TRN is exactly 15 digits").nullable().optional(),
  customerAddress: text(500).nullable().optional(),
  date: isoDate,
  dueDate: isoDate.nullable().optional(),
  paymentTerms: z.enum(["due_on_receipt", "net7", "net15", "net30", "net45", "net60", "net90"]).optional(),
  currency: currency.optional(),
  exchangeRate: rate.optional(),
  reverseCharge: z.boolean().optional(),
  lines: z.array(invoiceLine).min(1).max(500),
});

export const invoicePaymentCreate = z.strictObject({
  amount: positiveMoney,
  date: isoDate.optional(),
  method: z.enum(["cash", "bank", "cheque", "online"]).optional(),
  reference: text(255).nullable().optional(),
  notes: text(2000).nullable().optional(),
  paymentAccountId: uuid.meta({ description: "Cash or bank account (asset) the money went into; see GET /accounts" }),
  exchangeRate: rate.optional(),
  allowCredit: z.boolean().optional().meta({ description: "Record any amount above the invoice balance as a customer advance instead of refusing it" }),
});

// ───────────────────────── Bills ─────────────────────────
const billLine = z.strictObject({
  description: text(500).min(1),
  quantity: quantity.optional(),
  unitPrice: money,
  vatRate: vatRate.optional(),
  accountId: uuid.nullable().optional(),
});
export const billCreate = z
  .strictObject({
    vendorId: uuid.nullable().optional(),
    vendorName: text(255).min(1).optional(),
    vendorTrn: text(20).nullable().optional(),
    number: text(64).nullable().optional(),
    date: isoDate,
    dueDate: isoDate.nullable().optional(),
    currency: currency.optional(),
    exchangeRate: rate.optional(),
    category: text(64).nullable().optional(),
    notes: text(2000).nullable().optional(),
    reverseCharge: z.boolean().optional(),
    lines: z.array(billLine).min(1).max(500),
  })
  .refine((b) => !!b.vendorId || !!b.vendorName, { message: "Send vendorId or vendorName", path: ["vendorName"] });

export const billPaymentCreate = z.strictObject({
  amount: positiveMoney,
  date: isoDate.optional(),
  method: z.enum(["bank_transfer", "cash", "cheque", "credit_card", "other"]).optional(),
  reference: text(255).nullable().optional(),
  notes: text(2000).nullable().optional(),
  paymentAccountId: uuid.meta({ description: "The bank or cash account (asset) the payment leaves; see GET /accounts" }),
});

// ───────────────────────── Journals ─────────────────────────
const journalLine = z
  .strictObject({
    accountId: uuid,
    debit: money.optional(),
    credit: money.optional(),
    description: text(500).nullable().optional(),
    costCenterId: uuid.nullable().optional(),
  })
  .refine((l) => (l.debit ?? 0) > 0 !== (l.credit ?? 0) > 0, "A line carries a debit or a credit, not both and not neither");
export const journalCreate = z
  .strictObject({
    date: isoDate,
    memo: text(1000).nullable().optional(),
    confirmBackdated: z.boolean().optional(),
    lines: z.array(journalLine).min(2).max(200),
  })
  .refine(
    (j) => Math.abs(j.lines.reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0)) < 0.005,
    { message: "Debits must equal credits", path: ["lines"] }
  );

// ───────────────────────── Responses (OpenAPI) ─────────────────────────
const moneyStr = z.string().meta({ example: "1050.00", description: "Decimal string, 2 dp" });
const isoTs = z.string().meta({ example: "2026-10-02T09:30:00.000Z" });
const nullableStr = z.string().nullable();

export const contactResponse = z.object({
  id: uuid,
  type: z.enum(["customer", "vendor", "both"]),
  name: z.string(),
  nameAr: nullableStr,
  email: nullableStr,
  phone: nullableStr,
  trn: nullableStr,
  address: nullableStr,
  city: nullableStr,
  country: nullableStr,
  contactPerson: nullableStr,
  paymentTermsDays: z.number().nullable(),
  notes: nullableStr,
  isActive: z.boolean(),
  createdAt: isoTs,
});

export const accountResponse = z.object({
  id: uuid.meta({ description: "Use as paymentAccountId (cash or bank, type asset) and as accountId on journal and bill lines" }),
  code: z.string().meta({ example: "1010" }),
  name: z.string(),
  nameAr: nullableStr,
  type: z.enum(["asset", "liability", "equity", "income", "expense"]),
  subType: nullableStr,
  isSystem: z.boolean().meta({ description: "System accounts are created by the product and cannot be archived" }),
  isActive: z.boolean(),
  createdAt: isoTs,
});

export const itemResponse = z.object({
  id: uuid,
  name: z.string(),
  nameAr: nullableStr,
  sku: nullableStr,
  description: nullableStr,
  unitPrice: moneyStr,
  costPrice: moneyStr.nullable(),
  vatRate: z.string(),
  unit: z.string(),
  trackInventory: z.boolean(),
  currentStock: z.number(),
  lowStockThreshold: z.number().nullable(),
  isActive: z.boolean(),
  createdAt: isoTs,
});

export const invoiceLineResponse = z.object({
  id: uuid,
  description: z.string(),
  quantity: z.string(),
  unitPrice: moneyStr,
  vatRate: z.string(),
  vatSupplyType: nullableStr,
  productId: uuid.nullable(),
  revenueAccountId: uuid.nullable(),
});
export const invoiceResponse = z.object({
  id: uuid,
  number: z.string(),
  status: z.string(),
  type: z.string(),
  contactId: uuid.nullable(),
  customerName: z.string(),
  customerTrn: nullableStr,
  date: isoDate,
  dueDate: isoDate.nullable(),
  currency: currency,
  exchangeRate: z.string(),
  subtotal: moneyStr,
  vatAmount: moneyStr,
  total: moneyStr,
  amountPaid: moneyStr.optional(),
  outstanding: moneyStr.optional(),
  lines: z.array(invoiceLineResponse).optional(),
  createdAt: isoTs,
});

export const billResponse = z.object({
  id: uuid,
  number: nullableStr,
  vendorId: uuid.nullable(),
  vendorName: z.string(),
  vendorTrn: nullableStr,
  date: isoDate,
  dueDate: isoDate.nullable(),
  currency: z.string(),
  subtotal: moneyStr,
  vatAmount: moneyStr,
  total: moneyStr,
  amountPaid: moneyStr,
  status: z.string(),
  category: nullableStr,
  notes: nullableStr,
  lines: z
    .array(z.object({ id: uuid, description: z.string(), quantity: z.string(), unitPrice: moneyStr, vatRate: z.string(), amount: moneyStr, accountId: uuid.nullable() }))
    .optional(),
  createdAt: isoTs,
});

export const paymentResponse = z.object({
  id: uuid,
  direction: z.enum(["received", "made"]),
  documentId: uuid.meta({ description: "Invoice id (received) or bill id (made)" }),
  amount: moneyStr,
  date: isoDate,
  method: nullableStr,
  reference: nullableStr,
  createdAt: isoTs,
});

export const journalResponse = z.object({
  id: uuid,
  entryNumber: z.string(),
  date: isoDate,
  memo: nullableStr,
  status: z.enum(["draft", "posted", "void"]),
  source: z.string(),
  lines: z
    .array(z.object({ id: uuid, accountId: uuid, accountCode: nullableStr, accountName: nullableStr, debit: moneyStr, credit: moneyStr, description: nullableStr }))
    .optional(),
  createdAt: isoTs,
});
