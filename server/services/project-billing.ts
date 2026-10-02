// Pure project billing and profitability maths (no database).
//
// Time is billed at the entry rate, else the task rate, else the project rate. An entry is billable only
// on an hourly project, when the entry itself and its task are billable, and once its timer has stopped.
// An entry or cost is UNBILLED while it has no invoice or the invoice it was billed on is void or cancelled
// (the link is to the invoice, not the line: invoice edits re-insert lines).

import Decimal from "decimal.js";

type Num = number | string | null | undefined;
const num = (v: Num): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: Decimal.Value): number => new Decimal(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

export interface BillingProject {
  id: string;
  billingMethod: "hourly" | "non_billable";
  hourlyRate: Num;
  currency: string;
}

export interface BillingTask {
  hourlyRate: Num;
  isBillable: boolean;
}

export interface BillingTimeEntry {
  id: string;
  entryDate: string;
  minutes: number;
  isBillable: boolean;
  rate: Num;
  notes?: string | null;
  taskId?: string | null;
  billedInvoiceId?: string | null;
  billedInvoiceStatus?: string | null;
  /** A timer that has started and not stopped. */
  running?: boolean;
}

export function effectiveRate(entry: Pick<BillingTimeEntry, "rate">, task: BillingTask | null, project: Pick<BillingProject, "hourlyRate">): number {
  if (entry.rate !== null && entry.rate !== undefined && entry.rate !== "") return num(entry.rate);
  if (task && task.hourlyRate !== null && task.hourlyRate !== undefined) return num(task.hourlyRate);
  return num(project.hourlyRate);
}

export function isEntryBillable(entry: Pick<BillingTimeEntry, "isBillable" | "running">, task: BillingTask | null, project: Pick<BillingProject, "billingMethod">): boolean {
  if (entry.running) return false;
  if (project.billingMethod !== "hourly") return false;
  if (!entry.isBillable) return false;
  if (task && !task.isBillable) return false;
  return true;
}

export function isUnbilled(billedInvoiceId: string | null | undefined, invoiceStatus: string | null | undefined): boolean {
  if (!billedInvoiceId) return true;
  return invoiceStatus === "void" || invoiceStatus === "cancelled";
}

export function hoursOf(minutes: number): number {
  return new Decimal(minutes).div(60).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
}

/** Hours and amount of the billable, unbilled, stopped entries. */
export function summarizeUnbilled(
  entries: BillingTimeEntry[],
  taskOf: (entry: BillingTimeEntry) => BillingTask | null,
  project: BillingProject
): { unbilledHours: number; unbilledAmount: number } {
  let hours = new Decimal(0);
  let amount = new Decimal(0);
  for (const e of entries) {
    const task = taskOf(e);
    if (!isUnbilled(e.billedInvoiceId, e.billedInvoiceStatus) || !isEntryBillable(e, task, project)) continue;
    const h = hoursOf(e.minutes);
    hours = hours.plus(h);
    amount = amount.plus(new Decimal(h).times(effectiveRate(e, task, project)));
  }
  return { unbilledHours: hours.toDecimalPlaces(2).toNumber(), unbilledAmount: r2(amount) };
}

/** Whole minutes from start to end, rounded to the nearest, never negative and never above a day. */
export function minutesBetween(start: Date, end: Date): number {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  return Math.min(1440, Math.max(0, minutes));
}

export interface InvoiceLineDraft {
  kind: "item";
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatSupplyType: string;
  projectId: string;
  /** What the line bills: used to link the entries to the invoice. */
  source: { type: "time" | "expense"; id: string };
}

export function buildProjectInvoiceLines(args: {
  project: Pick<BillingProject, "id">;
  vatRate: 0 | 0.05;
  time: Array<BillingTimeEntry & { rate: Num; taskName?: string | null }>;
  expenses: Array<{ id: string; description: string; amountAed: Num; expenseDate: string }>;
}): InvoiceLineDraft[] {
  const supply = args.vatRate > 0 ? "standard_rated" : "zero_rated";
  const lines: InvoiceLineDraft[] = [];
  for (const t of args.time) {
    const label = [t.taskName, t.notes].filter((x) => x && String(x).trim()).join(" - ");
    lines.push({
      kind: "item",
      description: `${t.entryDate} ${label || "Time"}`.slice(0, 240),
      quantity: hoursOf(t.minutes),
      unitPrice: num(t.rate),
      vatRate: args.vatRate,
      vatSupplyType: supply,
      projectId: args.project.id,
      source: { type: "time", id: t.id },
    });
  }
  for (const x of args.expenses) {
    lines.push({
      kind: "item",
      description: `${x.expenseDate} ${x.description}`.slice(0, 240),
      quantity: 1,
      unitPrice: r2(num(x.amountAed)),
      vatRate: args.vatRate,
      vatSupplyType: supply,
      projectId: args.project.id,
      source: { type: "expense", id: x.id },
    });
  }
  return lines;
}

export function profitability(args: {
  revenue: number;
  costs: number;
  hours: { total: number; billable: number; billed: number; unbilled: number };
  budgetAmount: Num;
  budgetHours: Num;
}) {
  const margin = r2(new Decimal(args.revenue).minus(args.costs));
  const marginPct = args.revenue > 0 ? r2(new Decimal(margin).div(args.revenue).times(100)) : null;
  const budgetAmount = args.budgetAmount === null || args.budgetAmount === undefined ? null : num(args.budgetAmount);
  const budgetHours = args.budgetHours === null || args.budgetHours === undefined ? null : num(args.budgetHours);
  return {
    revenue: r2(args.revenue),
    costs: r2(args.costs),
    margin,
    marginPct,
    hours: args.hours,
    budget: {
      amount: budgetAmount,
      hours: budgetHours,
      usedPct: budgetAmount && budgetAmount > 0 ? r2(new Decimal(args.costs).div(budgetAmount).times(100)) : null,
      hoursUsedPct: budgetHours && budgetHours > 0 ? r2(new Decimal(args.hours.total).div(budgetHours).times(100)) : null,
    },
  };
}
