/**
 * Invoice payment and customer-credit write contracts (W3-A: R03-05, R03-08, R03-13, R03-21).
 *
 * Amounts are integer fils (zPositiveFils). `status`, journal ids and the receivable account are
 * server-owned; the payment account must be a cash/bank account (checked by the service, 422).
 */
import { z } from "zod";
import { zPositiveFils } from "./invoices";
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
