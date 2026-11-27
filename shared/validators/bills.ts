/**
 * Vendor bill write contracts (W3-B: R04-01..08, R04-13/14, R04-18, R04-21, R14-05).
 *
 * Server-owned fields (company_id, status, amount_paid, totals, approved_by, created_by,
 * revision, journal links) are never declared here, so `strictBody` rejects them (400).
 * Amounts are integer fils (zMoneyFils) — negative values are rejected everywhere; credits go
 * through debit notes.
 */
import { z } from "zod";
import {
  zCurrency,
  zDate,
  zEmirate,
  zHttpsUrl,
  zMoneyFils,
  zQuantity,
  zSupplyType,
  zText,
  zTrn,
  zUuid,
} from "./primitives";

/** VAT rate on a bill line: 0 or 5 (percent); 0.05 is accepted as 5. Output: 0 | 5. */
export const zBillVatRate = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .refine((n) => n === 0 || n === 5 || n === 0.05, "VAT rate must be 0% or 5% (UAE)")
  .transform((n) => (n === 0 ? 0 : 5));

/** Positive FX rate, at most 6 decimals, returned as a canonical string. */
export const zFxRate = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const s = typeof v === "number" ? v.toString() : v.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(s) || !(Number(s) > 0) || Number(s) >= 1_000_000) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Exchange rate must be a positive number with at most 6 decimals",
    });
    return z.NEVER;
  }
  return s;
});

const zPositiveQuantity = zQuantity.refine((n) => n > 0, "Quantity must be greater than zero");

export const billLineSchema = z
  .object({
    description: zText(500, { min: 1 }),
    quantity: zPositiveQuantity.optional(),
    unit_price: zMoneyFils,
    vat_rate: zBillVatRate.optional().nullable(),
    vat_supply_type: zSupplyType.optional(),
    account_id: zUuid.optional().nullable(),
    product_id: zUuid.optional().nullable(),
    /** R10-11: cost centre of the line (posted on its journal line; must be the company's). */
    cost_center_id: zUuid.optional().nullable(),
    /**
     * A2 (C3): the purchase-order line this bill line invoices. Omitted on an edit, the line keeps
     * the link it had (matched by product, then position); null unlinks it explicitly.
     */
    purchase_order_line_id: zUuid.optional().nullable(),
  })
  .strict();
export type BillLineInput = z.output<typeof billLineSchema>;

const billEditLineSchema = billLineSchema
  .extend({
    /** The existing line whose stored valuation and omitted treatment are carried forward. */
    id: zUuid.optional(),
    quantity: zQuantity.optional(),
  })
  .refine((line) => line.quantity !== 0 || line.id !== undefined, {
    path: ["quantity"],
    message: "Quantity must be greater than zero",
  });
const billEditLines = z
  .array(billEditLineSchema)
  .min(1, "At least one line item is required")
  .max(500);

const billFields = {
  vendor_id: zUuid.optional().nullable(),
  vendor_name: zText(255, { min: 1 }),
  vendor_trn: zTrn
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  bill_number: zText(64).optional().nullable(),
  bill_date: zDate,
  due_date: zDate.optional().nullable(),
  currency: zCurrency.optional(),
  exchange_rate: zFxRate.optional().nullable(),
  category: zText(64).optional().nullable(),
  notes: zText(2000).optional().nullable(),
  attachment_url: zHttpsUrl.optional().nullable(),
  reverse_charge: z.boolean().optional(),
  place_of_supply: zEmirate.optional().nullable(),
  is_import: z.boolean().optional(),
  customs_declaration_no: zText(64).optional().nullable(),
  import_vat_amount: zMoneyFils.optional().nullable(),
  /** A1 (M7): customs value and customs duty on the import declaration (Box 6 amount). */
  customs_value: zMoneyFils.optional().nullable(),
  customs_duty_amount: zMoneyFils.optional().nullable(),
  /**
   * A1 (C6, Exec. Reg. Art. 55): direct attribution of the bill's input VAT. taxable: wholly
   * for taxable supplies (recovered in full); exempt: wholly for exempt supplies (not
   * recovered); residual (default): overheads, apportioned under partial exemption.
   */
  input_vat_attribution: z.enum(["taxable", "exempt", "residual"]).optional().nullable(),
  designated_zone: z.boolean().optional(),
  recoverable_vat_percent: z.coerce
    .number()
    .min(0, "Recoverable VAT % must be between 0 and 100")
    .max(100, "Recoverable VAT % must be between 0 and 100")
    .optional(),
  withholding_amount: zMoneyFils.optional().nullable(),
  line_items: z.array(billLineSchema).min(1, "At least one line item is required").max(500),
};

export const billCreateSchema = z.object({
  ...billFields,
  /** true: save as draft (not yet submitted for approval). Default: pending. */
  save_as_draft: z.boolean().optional(),
});
export type BillCreateInput = z.output<typeof billCreateSchema>;

/** PATCH (draft / pending / rejected only) and POST /revise (approved, unpaid). */
export const billUpdateSchema = z
  .object({
    ...billFields,
    vendor_name: billFields.vendor_name.optional(),
    bill_date: billFields.bill_date.optional(),
    line_items: billEditLines.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update");
export type BillUpdateInput = z.output<typeof billUpdateSchema>;

export const billReviseSchema = z.object({
  ...billFields,
  vendor_name: billFields.vendor_name.optional(),
  bill_date: billFields.bill_date.optional(),
  line_items: billEditLines.optional(),
  reason: zText(500, { min: 1 }),
});
export type BillReviseInput = z.output<typeof billReviseSchema>;

export const billReasonSchema = z.object({ reason: zText(500, { min: 1 }) });
export const billOptionalReasonSchema = z.object({ reason: zText(500).optional().nullable() });

export const BILL_PAYMENT_METHODS = [
  "bank_transfer",
  "cash",
  "cheque",
  "credit_card",
  "other",
] as const;

export const billPaymentSchema = z.object({
  payment_date: zDate,
  /** Amount in the bill currency, integer fils, > 0. */
  amount: zMoneyFils.refine((f) => f > 0, "Payment amount must be greater than zero"),
  payment_method: z.enum(BILL_PAYMENT_METHODS).optional(),
  /** Cash or bank account credited (asset, sub_type cash/bank). Default 1020 / 1010 for cash. */
  payment_account_id: zUuid.optional().nullable(),
  /** Payment-date rate (bill currency → AED); default fx.getRate on payment_date. */
  exchange_rate: zFxRate.optional().nullable(),
  /**
   * A2 (C4): paying from a bank account in a third currency (a EUR bill from a USD account): the
   * amount the bank actually debited, in the bank account's currency (fils), and that
   * currency's rate to AED on the payment date. Both optional; default the payment-date rates.
   */
  bank_amount: zMoneyFils
    .refine((f) => f > 0, "Bank amount must be greater than zero")
    .optional()
    .nullable(),
  bank_exchange_rate: zFxRate.optional().nullable(),
  reference: zText(255).optional().nullable(),
  notes: zText(2000).optional().nullable(),
});
export type BillPaymentInput = z.output<typeof billPaymentSchema>;

export const billAttachmentSchema = z.object({
  /** base64 or data: URL of a JPEG/PNG/WebP/GIF/PDF (sniffed server-side). */
  file: z.string().min(16),
  filename: zText(200).optional().nullable(),
});

/** WQ2 (8.2): read a supplier invoice into a bill draft (nothing is stored or posted). */
export const billCaptureSchema = z
  .object({
    file: z.string().min(16),
    filename: zText(200).optional().nullable(),
  })
  .strict();

export const batchPaymentExportSchema = z.object({
  bill_ids: z.array(zUuid).min(1).max(500),
});

// ─── Debit notes / vendor credits ───────────────────────────────────────────

export const debitNoteLineSchema = z
  .object({
    description: zText(500, { min: 1 }),
    amount: zMoneyFils.refine((f) => f > 0, "Amount must be greater than zero"),
    vat_rate: zBillVatRate.optional().nullable(),
    account_id: zUuid.optional().nullable(),
    /** A2 (M4): a returned stock item leaves inventory at cost (whole units). */
    product_id: zUuid.optional().nullable(),
    quantity: zPositiveQuantity.optional(),
  })
  .strict();

export const debitNoteCreateSchema = z.object({
  vendor_id: zUuid.optional().nullable(),
  vendor_name: zText(255, { min: 1 }).optional(),
  debit_note_number: zText(64).optional().nullable(),
  bill_id: zUuid.optional().nullable(),
  note_date: zDate,
  currency: zCurrency.optional(),
  exchange_rate: zFxRate.optional().nullable(),
  reason: zText(500, { min: 1 }),
  lines: z.array(debitNoteLineSchema).min(1).max(200),
});
export type DebitNoteCreateInput = z.output<typeof debitNoteCreateSchema>;

/** Void a vendor debit note: the reason is mandatory (audit trail). */
export const debitNoteVoidSchema = z.object({ reason: zText(500, { min: 1 }) }).strict();
export type DebitNoteVoidInput = z.output<typeof debitNoteVoidSchema>;

/**
 * Review of an inbound supplier credit note (W4-C residual): the reviewer may link the original
 * bill and choose the expense account(s) credited; amounts come from the archived e-invoice.
 */
export const inboundVendorCreditSchema = z
  .object({
    bill_id: zUuid.optional().nullable(),
    account_id: zUuid.optional().nullable(),
    /** Per credit-note line (same order as the document); overrides account_id. */
    account_ids: z.array(zUuid.nullable()).max(200).optional(),
    reason: zText(500, { min: 1 }).optional(),
  })
  .strict();
export type InboundVendorCreditInput = z.output<typeof inboundVendorCreditSchema>;

export const applyCreditSchema = z.object({
  bill_id: zUuid,
  amount: zMoneyFils.refine((f) => f > 0, "Amount must be greater than zero"),
  date: zDate.optional(),
});
export type ApplyCreditInput = z.output<typeof applyCreditSchema>;

// ─── Vendor prepayments / advances ─────────────────────────────────────────

export const prepaymentCreateSchema = z.object({
  vendor_id: zUuid.optional().nullable(),
  vendor_name: zText(255, { min: 1 }).optional(),
  payment_date: zDate,
  amount: zMoneyFils.refine((f) => f > 0, "Amount must be greater than zero"),
  currency: zCurrency.optional(),
  exchange_rate: zFxRate.optional().nullable(),
  payment_account_id: zUuid.optional().nullable(),
  reference: zText(255).optional().nullable(),
});
export type PrepaymentCreateInput = z.output<typeof prepaymentCreateSchema>;

// ─── Recurring bills ─────────────────────────────────────────────────────────

export const RECURRING_FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"] as const;

export const recurringBillCreateSchema = z.object({
  name: zText(200, { min: 1 }),
  frequency: z.enum(RECURRING_FREQUENCIES),
  next_run_on: zDate,
  end_on: zDate.optional().nullable(),
  /** Bill template: same shape as a bill create (bill_date is set per occurrence). */
  template: z
    .object({
      ...billFields,
      bill_date: billFields.bill_date.optional(),
      due_in_days: z.coerce.number().int().min(0).max(365).optional(),
    })
    .strict(),
});
export type RecurringBillCreateInput = z.output<typeof recurringBillCreateSchema>;

// ─── Inbound structured documents (service bills.createDraftFromInbound) ────

export const inboundBillSchema = z
  .object({
    vendorName: zText(255, { min: 1 }),
    vendorTrn: zTrn.optional().nullable(),
    billNumber: zText(64).optional().nullable(),
    billDate: zDate,
    dueDate: zDate.optional().nullable(),
    currency: zCurrency.optional(),
    exchangeRate: zFxRate.optional().nullable(),
    reverseCharge: z.boolean().optional(),
    category: zText(64).optional().nullable(),
    origin: z.enum(["inbound", "receipt", "ocr", "einvoice", "recurring"]).optional(),
    originRef: zText(255).optional().nullable(),
    lines: z
      .array(
        z
          .object({
            description: zText(500, { min: 1 }),
            quantity: zPositiveQuantity.optional(),
            /** Major units over the wire ("12.50"); parsed to integer fils. */
            unitPrice: zMoneyFils,
            vatRate: zBillVatRate.optional().nullable(),
            supplyType: zSupplyType.optional(),
            accountId: zUuid.optional().nullable(),
          })
          .strict()
      )
      .min(1)
      .max(500),
  })
  .strict();
export type InboundBillInput = z.output<typeof inboundBillSchema>;
