// Validation of the body of POST /api/companies/:companyId/bank-transactions.
//
// The route used to hand the raw JSON to Drizzle, where a date string reached
// the timestamp column mapper and crashed with "value.toISOString is not a
// function" (always a 500). The body is now parsed with zod, the date is read
// with the same calendar-date convention as the other bank paths (a bare
// YYYY-MM-DD, or an instant read as its UAE calendar day, stored at UTC
// midnight) and a future-dated transaction is refused like every other bank
// settlement path. Pure: no database imports.

import { z } from "zod";
import { resolvePaymentDate } from "./payment-date.service";
import { toCalendarYmd } from "../utils/date";

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

const bodySchema = z.object({
  transactionDate: z.string({ required_error: "transactionDate is required", invalid_type_error: "transactionDate must be a date string (YYYY-MM-DD)" }).trim().min(1, "transactionDate is required"),
  description: z.string({ required_error: "description is required" }).trim().min(1, "description is required").max(500),
  amount: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z.number({ required_error: "amount is required", invalid_type_error: "amount must be a number" }).finite("amount must be a finite number")
  ),
  balance: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
      z.number().finite().optional().nullable()
    ),
  reference: optionalText(200),
  category: optionalText(100),
  bankAccountId: z.string().uuid("bankAccountId must be a valid id").optional().nullable(),
});

export interface BankTransactionInput {
  transactionDate: Date;
  description: string;
  amount: number;
  balance?: number | null;
  reference?: string | null;
  category?: string | null;
  bankAccountId?: string | null;
  importSource: "manual";
}

export type BankTransactionParse =
  | { ok: true; value: BankTransactionInput }
  | { ok: false; status: number; code: string; message: string; issues?: Array<{ path: Array<string | number>; message: string }> };

export function parseBankTransactionInput(body: unknown, now: Date = new Date()): BankTransactionParse {
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: first?.message ?? "Invalid bank transaction",
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    };
  }
  const { transactionDate, ...rest } = parsed.data;

  const date = resolvePaymentDate({ requested: transactionDate, now });
  if (!date.ok) {
    if (date.status === 422) {
      return {
        ok: false,
        status: 422,
        code: "BANK_TRANSACTION_DATE_IN_FUTURE",
        message: `Bank transaction date ${transactionDate.slice(0, 10)} is in the future. Transactions must be dated on or before today.`,
      };
    }
    return {
      ok: false,
      status: 400,
      code: "BANK_TRANSACTION_DATE_INVALID",
      message: "transactionDate must be a valid date (YYYY-MM-DD).",
    };
  }

  const value: BankTransactionInput = {
    ...rest,
    transactionDate: new Date(`${toCalendarYmd(transactionDate)}T00:00:00.000Z`),
    importSource: "manual",
  };
  return { ok: true, value };
}
