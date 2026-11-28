/**
 * Practice workflow (W5-D, R15-15): recurring task templates that generate
 * per-client tasks with due dates.
 *
 * Templates (one set per firm, seeded on first use):
 *   monthly_bookkeeping  monthly     due 15 days after month end
 *   vat_return           vat_period  by the client's VAT stagger / frequency,
 *                                    due 28 days after period end
 *   ct_return            annual      due 9 months after the financial year end
 *   payroll              monthly     due 15 days after month end (WPS)
 *
 * VAT / CT / payroll dates come from the compliance module's obligations when
 * the `compliance.listUpcoming` service is registered and has rows for the
 * client; otherwise they are computed here with the same rules. Generation is
 * idempotent (unique firm_id + source_key) and runs daily as the job
 * `firm.generateRecurringTasks`.
 */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../../db";
import { createLogger } from "../../config/logger";
import { has, resolve } from "../../platform/service-registry";
import { listJobs, registerJob } from "../../platform/job-registry";
import {
  companies,
  firmTaskTemplates,
  firmTasks,
  firms,
  type FirmTask,
  type FirmTaskTemplate,
} from "../../../shared/schema";
import { firmClientCondition, type FirmContext } from "./scope";

const log = createLogger("firm-workflow");

export const DEFAULT_TASK_TEMPLATES = [
  {
    code: "monthly_bookkeeping",
    title: "Monthly bookkeeping close",
    titleAr: "إقفال الدفاتر الشهري",
    cadence: "monthly",
    dueDaysAfterPeriod: 15,
    appliesTo: "all",
  },
  {
    code: "vat_return",
    title: "VAT return",
    titleAr: "إقرار ضريبة القيمة المضافة",
    cadence: "vat_period",
    dueDaysAfterPeriod: 28,
    appliesTo: "vat_registered",
  },
  {
    code: "ct_return",
    title: "Corporate tax return",
    titleAr: "إقرار ضريبة الشركات",
    cadence: "annual",
    dueDaysAfterPeriod: 273,
    appliesTo: "ct_registered",
  },
  {
    code: "payroll",
    title: "Payroll and WPS run",
    titleAr: "تشغيل الرواتب ونظام حماية الأجور",
    cadence: "monthly",
    dueDaysAfterPeriod: 15,
    appliesTo: "payroll",
  },
] as const;

const COMPLIANCE_TYPE_FOR_TEMPLATE: Record<string, string> = {
  vat_return: "vat_return",
  ct_return: "corporate_tax_return",
  payroll: "wps_payroll",
};

type IsoDate = string;

function iso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}
function utc(y: number, m0: number, day: number): Date {
  return new Date(Date.UTC(y, m0, day));
}
function addDays(dateIso: IsoDate, days: number): IsoDate {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}
function monthEnd(y: number, m0: number): IsoDate {
  return iso(utc(y, m0 + 1, 0));
}

export interface Period {
  start: IsoDate;
  end: IsoDate;
  key: string;
}

/** Monthly periods ending from `from` to `to` (inclusive). */
export function monthlyPeriods(from: IsoDate, to: IsoDate): Period[] {
  const out: Period[] = [];
  const f = new Date(`${from}T00:00:00Z`);
  let y = f.getUTCFullYear();
  let m = f.getUTCMonth() - 1;
  for (let i = 0; i < 40; i++) {
    const start = iso(utc(y, m, 1));
    const end = monthEnd(y, m);
    if (end > to) break;
    if (end >= from) out.push({ start, end, key: start.slice(0, 7) });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/**
 * VAT periods by stagger: quarterly periods start in vatPeriodStartMonth (1-12)
 * and every third month after it; monthly filers file every month.
 */
export function vatPeriods(
  frequency: string | null | undefined,
  startMonth: number | null | undefined,
  from: IsoDate,
  to: IsoDate
): Period[] {
  const freq = (frequency ?? "quarterly").toLowerCase();
  if (freq === "monthly") return monthlyPeriods(from, to);
  const anchor = Math.min(Math.max(Number(startMonth) || 1, 1), 12) - 1;
  const out: Period[] = [];
  const f = new Date(`${from}T00:00:00Z`);
  for (let y = f.getUTCFullYear() - 1; y <= f.getUTCFullYear() + 2; y++) {
    for (let q = 0; q < 4; q++) {
      const m0 = anchor + q * 3;
      const start = iso(utc(y, m0, 1));
      const end = iso(utc(y, m0 + 3, 0));
      if (end >= from && end <= to) out.push({ start, end, key: `${start.slice(0, 7)}-Q` });
    }
  }
  return out.sort((a, b) => a.end.localeCompare(b.end));
}

/** Financial years (fiscalYearStartMonth) ending between from and to. */
export function annualPeriods(fyStartMonth: number | null | undefined, from: IsoDate, to: IsoDate) {
  const s = Math.min(Math.max(Number(fyStartMonth) || 1, 1), 12) - 1;
  const out: Period[] = [];
  const f = new Date(`${from}T00:00:00Z`);
  for (let y = f.getUTCFullYear() - 2; y <= f.getUTCFullYear() + 1; y++) {
    const start = iso(utc(y, s, 1));
    const end = iso(utc(y + 1, s, 0));
    if (end >= from && end <= to) out.push({ start, end, key: `FY${start.slice(0, 7)}` });
  }
  return out;
}

export async function ensureDefaultTemplates(firmId: string, actorId?: string | null) {
  for (const t of DEFAULT_TASK_TEMPLATES) {
    await db
      .insert(firmTaskTemplates)
      .values({ ...t, firmId, createdBy: actorId ?? null })
      .onConflictDoNothing();
  }
  return db
    .select()
    .from(firmTaskTemplates)
    .where(eq(firmTaskTemplates.firmId, firmId))
    .orderBy(asc(firmTaskTemplates.code));
}

type ClientRow = {
  id: string;
  name: string;
  trnVatNumber: string | null;
  corporateTaxId: string | null;
  vatFilingFrequency: string | null;
  vatPeriodStartMonth: number | null;
  fiscalYearStartMonth: number | null;
};

interface ComplianceRow {
  obligationType: string | null;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
}

async function complianceRows(companyId: string, days: number, now: Date) {
  if (!has("compliance.listUpcoming")) return [] as ComplianceRow[];
  try {
    const fn =
      resolve<(c: string, o: { days?: number; now?: Date }) => Promise<ComplianceRow[]>>(
        "compliance.listUpcoming"
      );
    return await fn(companyId, { days, now });
  } catch (err) {
    log.warn({ companyId, err: (err as Error).message }, "compliance.listUpcoming failed");
    return [];
  }
}

function applies(t: FirmTaskTemplate, c: ClientRow, hasPayroll: boolean): boolean {
  if (t.appliesTo === "vat_registered") return !!c.trnVatNumber;
  if (t.appliesTo === "ct_registered") return !!c.corporateTaxId || !!c.trnVatNumber;
  if (t.appliesTo === "payroll") return hasPayroll;
  return true;
}

export interface GenerateOptions {
  asOf?: Date;
  horizonDays?: number;
  companyIds?: string[];
  actorId?: string | null;
}

/**
 * Generate tasks for every active template × client of the firm whose due
 * date falls in [asOf - 31 days, asOf + horizonDays]. Idempotent.
 */
export async function generateRecurringTasks(
  ctx: Pick<FirmContext, "firmId" | "isNr">,
  opts: GenerateOptions = {}
): Promise<{ created: number; tasks: FirmTask[] }> {
  const now = opts.asOf ?? new Date();
  const today = iso(now);
  const horizon = opts.horizonDays ?? 60;
  const windowFrom = addDays(today, -31);
  const windowTo = addDays(today, horizon);
  const templates = (await ensureDefaultTemplates(ctx.firmId, opts.actorId)).filter(
    (t: FirmTaskTemplate) => t.isActive
  );
  const clients = (await db
    .select({
      id: companies.id,
      name: companies.name,
      trnVatNumber: companies.trnVatNumber,
      corporateTaxId: companies.corporateTaxId,
      vatFilingFrequency: companies.vatFilingFrequency,
      vatPeriodStartMonth: companies.vatPeriodStartMonth,
      fiscalYearStartMonth: companies.fiscalYearStartMonth,
    })
    .from(companies)
    .where(
      and(
        firmClientCondition(ctx.firmId, ctx.isNr),
        opts.companyIds?.length ? inArray(companies.id, opts.companyIds) : undefined
      )
    )) as ClientRow[];

  const created: FirmTask[] = [];
  for (const client of clients) {
    const obligations = await complianceRows(client.id, horizon, now);
    for (const t of templates) {
      if (!applies(t, client, false)) continue;
      const candidates: Array<{ period: Period; due: IsoDate; source: string }> = [];
      const fromCompliance = obligations.filter(
        (o) => o.obligationType === COMPLIANCE_TYPE_FOR_TEMPLATE[t.code] && o.periodEnd
      );
      if (fromCompliance.length > 0) {
        for (const o of fromCompliance) {
          candidates.push({
            period: {
              start: o.periodStart ?? o.periodEnd!,
              end: o.periodEnd!,
              key: `${o.periodStart ?? o.periodEnd}`,
            },
            due: o.dueDate,
            source: "compliance",
          });
        }
      } else {
        // Periods whose due date can land in the window.
        const periodFrom = addDays(windowFrom, -t.dueDaysAfterPeriod);
        const periodTo = addDays(windowTo, -t.dueDaysAfterPeriod);
        const periods =
          t.cadence === "vat_period"
            ? vatPeriods(
                client.vatFilingFrequency,
                client.vatPeriodStartMonth,
                periodFrom,
                periodTo
              )
            : t.cadence === "annual"
              ? annualPeriods(client.fiscalYearStartMonth, periodFrom, periodTo)
              : monthlyPeriods(periodFrom, periodTo);
        for (const p of periods) {
          candidates.push({
            period: p,
            due: addDays(p.end, t.dueDaysAfterPeriod),
            source: "template",
          });
        }
      }
      for (const c of candidates) {
        if (c.due < windowFrom || c.due > windowTo) continue;
        const sourceKey = `${t.code}:${client.id}:${c.period.start}:${c.period.end}`;
        const [row] = await db
          .insert(firmTasks)
          .values({
            firmId: ctx.firmId,
            companyId: client.id,
            templateId: t.id,
            title: `${t.title} — ${c.period.start} to ${c.period.end}`,
            periodStart: c.period.start,
            periodEnd: c.period.end,
            dueDate: c.due,
            status: "open",
            source: c.source,
            sourceKey,
            createdBy: opts.actorId ?? null,
          })
          .onConflictDoNothing()
          .returning();
        if (row) created.push(row);
      }
    }
  }
  return { created: created.length, tasks: created };
}

export async function listFirmTasks(
  ctx: FirmContext,
  companyIds: string[],
  filters: { from?: string; to?: string; status?: string } = {}
) {
  if (companyIds.length === 0) return [];
  return db
    .select({ task: firmTasks, companyName: companies.name })
    .from(firmTasks)
    .innerJoin(companies, eq(companies.id, firmTasks.companyId))
    .where(
      and(
        eq(firmTasks.firmId, ctx.firmId),
        inArray(firmTasks.companyId, companyIds),
        filters.from ? gte(firmTasks.dueDate, filters.from) : undefined,
        filters.to ? lte(firmTasks.dueDate, filters.to) : undefined,
        filters.status ? eq(firmTasks.status, filters.status) : undefined
      )
    )
    .orderBy(asc(firmTasks.dueDate));
}

/** Daily job across every active firm (idempotent). */
export async function runRecurringTaskJob(now: Date = new Date()) {
  const active = (await db
    .select({ id: firms.id, isNr: firms.isNr })
    .from(firms)
    .where(eq(firms.status, "active"))) as Array<{ id: string; isNr: boolean }>;
  let created = 0;
  for (const f of active) {
    try {
      created += (await generateRecurringTasks({ firmId: f.id, isNr: f.isNr }, { asOf: now }))
        .created;
    } catch (err) {
      log.error({ firmId: f.id, err: (err as Error).message }, "recurring task generation failed");
    }
  }
  return { created };
}

export function registerFirmWorkflowJobs(): void {
  const have = new Set(listJobs().map((j) => j.name));
  if (!have.has("firm.generateRecurringTasks")) {
    registerJob({
      name: "firm.generateRecurringTasks",
      cron: "20 2 * * *",
      description: "Generate per-client practice tasks from firm task templates",
      run: async () => {
        await runRecurringTaskJob();
      },
    });
  }
}
