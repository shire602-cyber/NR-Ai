// Pure rules of the late-fee setting (Phase 8 D1). A compensatory late-payment fee is outside the scope of VAT by
// default (company override to standard-rated), is OFF by default, and is charged at most once per invoice.

import Decimal from "decimal.js";
import { z } from "zod";

export function computeLateFee(args: { outstanding: number; type: "percent" | "fixed"; value: number }): number {
  if (!(args.outstanding > 0) || !(args.value > 0)) return 0;
  const fee = args.type === "percent" ? new Decimal(args.outstanding).times(args.value).div(100) : new Decimal(args.value);
  return fee.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/** `today` and `dueDate` are calendar days (YYYY-MM-DD); due when dueDate + afterDays < today. */
export function isLateFeeDue(args: { dueDate: string | null | undefined; afterDays: number; today: string }): boolean {
  if (!args.dueDate) return false;
  const due = Date.parse(`${args.dueDate.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${args.today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(today)) return false;
  return due + args.afterDays * 86_400_000 < today;
}

export const lateFeeConfigSchema = z
  .object({
    enabled: z.boolean(),
    type: z.enum(["percent", "fixed"]),
    value: z.coerce.number().finite().min(0).max(1_000_000_000),
    afterDays: z.number().int().min(0).max(365),
    vatTreatment: z.enum(["out_of_scope", "standard_rated"]).default("out_of_scope"),
  })
  .superRefine((v, ctx) => {
    if (v.type === "percent" && v.value > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "A percent fee is at most 100." });
    if (v.enabled && !(v.value > 0)) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter the fee amount or percent." });
  });

export type LateFeeConfigInput = z.infer<typeof lateFeeConfigSchema>;
