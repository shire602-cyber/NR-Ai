/**
 * Invoice payment and customer-credit write contracts (W3-A: R03-05, R03-08, R03-13, R03-21).
 *
 * Amounts are integer fils (zPositiveFils). `status`, journal ids and the receivable account are
 * server-owned; the payment account must be a cash/bank account (checked by the service, 422).
 */
import { z } from "zod";
import { zNonNegativeFils, zPositiveFils } from "./invoices";
import { zDate, zText, zUuid } from "./primitives";

const zPaymentRate = z.coerce.number().finite().positive().max(1_000_000).optional().nullable();

/** POST /api/companies/:companyId/invoices/:invoiceId/payments */
export const invoicePaymentSchema = z
  .object({
    amount: zPositiveFils,
    /** Journal date of the payment (defaults to today). */
    date: zDate.optional(),
    method: zText(40).optional(),
    reference: zText(200).optional().nullable(),
    notes: zText(1000).optional().nullable(),
    paymentAccountId: zUuid,
    /** AED per unit of the invoice currency on the payment date (realised FX). */
    exchangeRate: zPaymentRate,
    /** Book an amount above the open balance as a customer credit. */
    allowCredit: z.boolean().optional(),
  })
  .strict();
export type InvoicePaymentInput = z.output<typeof invoicePaymentSchema>;

/** POST /api/companies/:companyId/customer-credits/:creditId/apply */
export const applyCustomerCreditSchema = z
  .object({ invoiceId: zUuid, amount: zPositiveFils, date: zDate.optional() })
  .strict();
export type ApplyCustomerCreditInput = z.output<typeof applyCustomerCreditSchema>;

/** POST /api/companies/:companyId/customer-credits/:creditId/refund */
export const refundCustomerCreditSchema = z
  .object({
    amount: zPositiveFils,
    date: zDate.optional(),
    paymentAccountId: zUuid,
    exchangeRate: zPaymentRate,
    reference: zText(200).optional().nullable(),
  })
  .strict();
export type RefundCustomerCreditInput = z.output<typeof refundCustomerCreditSchema>;

/**
 * A3 (H1): POST /api/companies/:companyId/invoices/:invoiceId/write-off. Writes off an
 * uncollectible receivable (IFRS 9.5.4.4): Dr bad-debt expense (or the allowance for doubtful
 * debts, `against: "allowance"`) / Cr A/R, settling the invoice. `amount` (fils, document
 * currency) defaults to the whole open balance.
 */
export const invoiceWriteOffSchema = z
  .object({
    date: zDate,
    amount: zPositiveFils.optional(),
    against: z.enum(["expense", "allowance"]).optional(),
    reason: zText(1000, { min: 3 }),
  })
  .strict();
export type InvoiceWriteOffInput = z.output<typeof invoiceWriteOffSchema>;

/** A3 (H1): POST /api/companies/:companyId/invoices/:invoiceId/write-off/reinstate */
export const invoiceWriteOffReinstateSchema = z
  .object({ date: zDate, reason: zText(1000, { min: 3 }) })
  .strict();
export type InvoiceWriteOffReinstateInput = z.output<typeof invoiceWriteOffReinstateSchema>;

/**
 * A3 (M5): POST /api/companies/:companyId/receivables/allowance. Sets the allowance for doubtful
 * debts (IFRS 9 simplified approach, a manual lifetime-ECL estimate) to `targetBalance` (fils)
 * at `date`; the difference posts Dr impairment loss on receivables / Cr allowance (or back).
 */
export const doubtfulDebtAllowanceSchema = z
  .object({
    date: zDate,
    targetBalance: zNonNegativeFils,
    memo: zText(500).optional().nullable(),
  })
  .strict();
export type DoubtfulDebtAllowanceInput = z.output<typeof doubtfulDebtAllowanceSchema>;

/**
 * A4 (M1): a customer deposit / advance received before the invoice. `amount` is what the customer
 * paid (VAT-inclusive for a standard-rated supply: VAT = amount x 5/105 is due on receipt).
 */
export const createCustomerDepositSchema = z
  .object({
    contactId: zUuid.optional().nullable(),
    customerName: zText(255).optional().nullable(),
    customerTrn: zText(32).optional().nullable(),
    date: zDate,
    amount: zPositiveFils,
    vatTreatment: z.enum(["standard", "zero_rated", "exempt", "out_of_scope"]).default("standard"),
    paymentAccountId: zUuid,
    reference: zText(200).optional().nullable(),
    description: zText(500).optional().nullable(),
  })
  .strict()
  .refine((v) => !!v.contactId || !!(v.customerName ?? "").trim(), {
    message: "Choose or name the customer",
    path: ["customerName"],
  });
export type CreateCustomerDepositInput = z.output<typeof createCustomerDepositSchema>;
