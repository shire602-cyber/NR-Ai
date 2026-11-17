/**
 * Generated compliance obligations (W4-A: R08-03, R08-21, R13-34).
 *
 * For each company this generates the UAE filing calendar for a year and
 * stores it in compliance_calendar (source = 'generated', unique
 * obligation_key per company):
 *
 *   - VAT returns by stagger and frequency, due 28 days after period end
 *   - corporate tax returns, due 9 months after fiscal year end (month-end clamp)
 *   - corporate tax registration (one-off, FTA Decision 3/2024)
 *   - UBO register confirmation (annual, at licence renewal)
 *   - trade-licence renewal (date from the CT / compliance profile)
 *   - excise returns (monthly, 15 days) when excise-registered
 *   - e-invoicing milestones (MD 243/2025, MD 244/2025)
 *   - payroll / WPS salary transfer (monthly) when the company has employees
 *
 * ESR obligations are NOT generated: Cabinet Decision 98/2024 removed ESR
 * for financial years starting after 31 Dec 2022 (docs/corporate-tax-rules.md).
 *
 * Status of VAT and CT rows derives from the actual return state and rolls
 * forward to the next period; other rows can be completed manually.
 * The daily job `compliance.deadlineScan` regenerates the current and next
 * year and emits `compliance.deadline_due` at 30/14/7/1 days before the due
 * date. Service `compliance.listUpcoming` exposes upcoming rows to other
 * modules (dashboard, notifications).
 */
import { pool } from "../db";
import { describeLegalSource, type CopyDescriptor } from "@shared/server-copy";
import { createLogger } from "../config/logger";
import { emitDomainEvent } from "../platform/domain-events";
import { has, provide } from "../platform/service-registry";
import { listJobs, registerJob } from "../platform/job-registry";
import {
  addMonthsClamped,
  ctPeriodsDueInYear,
  daysBetween,
  exciseFilingDeadline,
  lastDayOfMonth,
  monthlyPeriodsDueInYear,
  normalizeVatFrequency,
  uaeToday,
  vatPeriodsDueInYear,
  addDays,
  type IsoDate,
} from "./corporate-tax/deadlines";
import { getCtProfile } from "./corporate-tax/repository";

const log = createLogger("compliance-obligations");

export const OBLIGATION_TYPES = [
  "vat_return",
  "corporate_tax_return",
  "ct_registration",
  "ubo_confirmation",
  "trade_licence_renewal",
  "excise_return",
  "einvoicing_milestone",
  "wps_payroll",
] as const;
export type ObligationType = (typeof OBLIGATION_TYPES)[number];

/** Obligation types whose status is derived from return state (not editable). */
export const DERIVED_STATUS_TYPES: readonly ObligationType[] = [
  "vat_return",
  "corporate_tax_return",
  "ct_registration",
];

/** Map to the legacy compliance_calendar.event_type vocabulary. */
const EVENT_TYPE: Record<ObligationType, string> = {
  vat_return: "vat_filing",
  corporate_tax_return: "corporate_tax_filing",
  ct_registration: "other",
  ubo_confirmation: "other",
  trade_licence_renewal: "trade_license_renewal",
  excise_return: "other",
  einvoicing_milestone: "other",
  wps_payroll: "other",
};

export const REMINDER_OFFSETS = [30, 14, 7, 1] as const;

export type ObligationStatus = "upcoming" | "completed" | "overdue" | "dismissed";

export interface ObligationSpec {
  key: string;
  type: ObligationType;
  title: string;
  titleAr: string;
  dueDate: IsoDate;
  periodStart?: IsoDate | null;
  periodEnd?: IsoDate | null;
  legalSource: string;
  /** Derived completion (VAT/CT returns, registration); null = not derivable. */
  completed?: boolean | null;
  relatedEntityId?: string | null;
  detail?: string;
}

interface CompanyFacts {
  id: string;
  name: string;
  trnVatNumber: string | null;
  vatFilingFrequency: string | null;
  vatPeriodStartMonth: number;
  fiscalYearStartMonth: number;
  corporateTaxId: string | null;
  createdAt: IsoDate;
  /** VAT registration effective date (companies.tax_registration_date), when recorded. */
  taxRegistrationDate: IsoDate | null;
  /**
   * X5 (J1 D4): first day the books cover — the earliest of the company's creation and its
   * first posted journal / invoice. Returns for periods that ended before it were never this
   * company's to file here, so they are not shown as due or overdue.
   */
  booksStart: IsoDate;
}

/**
 * X5 (J1 D4): the first date from which a periodic return applies: the later of the books
 * start and any registration / incorporation date. A period applies when it ends on or after it
 * (the period that contains the start date is the first one).
 */
export function obligationsApplyFrom(
  booksStart: IsoDate,
  ...dates: Array<IsoDate | null | undefined>
): IsoDate {
  return dates.reduce<IsoDate>((m, d) => (d && d > m ? d : m), booksStart);
}

async function loadCompanyFacts(companyId: string): Promise<CompanyFacts | null> {
  const r = await pool.query(
    `SELECT c.id, c.name, c.trn_vat_number, c.vat_filing_frequency, c.vat_period_start_month,
            c.fiscal_year_start_month, c.corporate_tax_id, c.created_at,
            ((c.tax_registration_date + interval '4 hours')::date)::text AS tax_registration_date,
            LEAST(
              ((c.created_at + interval '4 hours')::date),
              (SELECT MIN((je.date + interval '4 hours')::date) FROM journal_entries je
                WHERE je.company_id = c.id AND je.status = 'posted'),
              (SELECT MIN((i.date + interval '4 hours')::date) FROM invoices i
                WHERE i.company_id = c.id)
            )::text AS books_start
       FROM companies c WHERE c.id = $1`,
    [companyId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    trnVatNumber: row.trn_vat_number ?? null,
    vatFilingFrequency: row.vat_filing_frequency ?? null,
    vatPeriodStartMonth: Number(row.vat_period_start_month) || 1,
    fiscalYearStartMonth: Number(row.fiscal_year_start_month) || 1,
    corporateTaxId: row.corporate_tax_id ?? null,
    createdAt: uaeToday(new Date(row.created_at)),
    taxRegistrationDate: row.tax_registration_date ?? null,
    booksStart: row.books_start ?? uaeToday(new Date(row.created_at)),
  };
}

function isVatRegistered(c: CompanyFacts): boolean {
  return Boolean((c.trnVatNumber ?? "").trim() || (c.vatFilingFrequency ?? "").trim());
}

/** FTA Decision 3/2024 registration deadline for a juridical person. */
export function ctRegistrationDeadline(incorporationDate: IsoDate): IsoDate {
  if (incorporationDate >= "2024-03-01") return addMonthsClamped(incorporationDate, 3);
  const month = Number(incorporationDate.slice(5, 7));
  const table: Record<number, IsoDate> = {
    1: "2024-05-31",
    2: "2024-05-31",
    3: "2024-06-30",
    4: "2024-06-30",
    5: "2024-07-31",
    6: "2024-08-31",
    7: "2024-09-30",
    8: "2024-10-31",
    9: "2024-10-31",
    10: "2024-11-30",
    11: "2024-11-30",
    12: "2024-12-31",
  };
  return table[month] ?? "2024-12-31";
}

interface ReturnStateRow {
  id: string;
  period_end: string;
  status: string;
}

async function vatReturnStates(companyId: string): Promise<Map<string, ReturnStateRow>> {
  const r = await pool.query(
    `SELECT id, ((period_end + interval '4 hours')::date)::text AS period_end, status
       FROM vat_returns WHERE company_id = $1 ORDER BY created_at`,
    [companyId]
  );
  const out = new Map<string, ReturnStateRow>();
  for (const row of r.rows as ReturnStateRow[]) {
    const prev = out.get(row.period_end);
    // Prefer a filed row over a draft for the same period.
    if (!prev || isFiledVat(row.status)) out.set(row.period_end, row);
  }
  return out;
}

function isFiledVat(status: string): boolean {
  return ["submitted", "filed", "amended", "paid", "accepted"].includes(status);
}

async function ctReturnStates(companyId: string): Promise<Map<string, ReturnStateRow>> {
  const r = await pool.query(
    `SELECT id, ((tax_period_end + interval '4 hours')::date)::text AS period_end, status
       FROM corporate_tax_returns WHERE company_id = $1 AND status <> 'void'
      ORDER BY amendment_number, created_at`,
    [companyId]
  );
  const out = new Map<string, ReturnStateRow>();
  for (const row of r.rows as ReturnStateRow[]) out.set(row.period_end, row);
  return out;
}

function isFiledCt(status: string): boolean {
  return ["filed", "paid", "amended"].includes(status);
}

async function hasActiveEmployees(companyId: string): Promise<boolean> {
  try {
    const r = await pool.query(
      `SELECT 1 FROM employees WHERE company_id = $1 AND status = 'active' LIMIT 1`,
      [companyId]
    );
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

async function paidPayrollPeriods(companyId: string): Promise<Set<string>> {
  try {
    const r = await pool.query(
      `SELECT period_year, period_month FROM payroll_runs
        WHERE company_id = $1 AND status IN ('paid', 'completed')`,
      [companyId]
    );
    return new Set(
      (r.rows as Array<{ period_year: number; period_month: number }>).map(
        (row) => `${row.period_year}-${String(row.period_month).padStart(2, "0")}`
      )
    );
  } catch {
    return new Set();
  }
}

async function latestCtRevenue(companyId: string): Promise<number | null> {
  const r = await pool.query(
    `SELECT total_revenue FROM corporate_tax_returns
      WHERE company_id = $1 AND status <> 'void' ORDER BY tax_period_end DESC LIMIT 1`,
    [companyId]
  );
  return r.rows[0] ? Number(r.rows[0].total_revenue) || 0 : null;
}

/** Pure-ish: build the obligation specs for one company and year. */
export async function buildObligationSpecs(
  companyId: string,
  year: number
): Promise<ObligationSpec[]> {
  const company = await loadCompanyFacts(companyId);
  if (!company) return [];
  const profile = await getCtProfile(companyId);
  const specs: ObligationSpec[] = [];

  // VAT returns by stagger (FDL 8/2017 Art. 64; Exec. Reg. Art. 59).
  if (isVatRegistered(company)) {
    const frequency = normalizeVatFrequency(company.vatFilingFrequency);
    const vat = await vatReturnStates(companyId);
    const vatFrom = obligationsApplyFrom(company.booksStart, company.taxRegistrationDate);
    for (const p of vatPeriodsDueInYear(frequency, company.vatPeriodStartMonth, year)) {
      const state = vat.get(p.periodEnd);
      // X5 (J1 D4): no return for a period before registration / the books (unless one exists).
      if (p.periodEnd < vatFrom && !state) continue;
      specs.push({
        key: `vat:${p.periodEnd}`,
        type: "vat_return",
        title: `VAT return ${p.periodStart} to ${p.periodEnd}`,
        titleAr: `إقرار ضريبة القيمة المضافة ${p.periodStart} إلى ${p.periodEnd}`,
        dueDate: p.dueDate,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        legalSource: "FDL 8/2017 Art. 64; Executive Regulation Art. 59 (28 days)",
        completed: state ? isFiledVat(state.status) : false,
        relatedEntityId: state?.id ?? null,
        detail: state ? `Return status: ${state.status}` : "No VAT return prepared yet",
      });
    }
  }

  // Corporate tax returns (FDL 47/2022 Art. 53): 9 months after FY end.
  const ct = await ctReturnStates(companyId);
  const ctFrom = obligationsApplyFrom(company.booksStart, profile.incorporationDate);
  for (const p of ctPeriodsDueInYear(year, company.fiscalYearStartMonth)) {
    // CT applies to financial years starting on or after 1 June 2023.
    if (p.periodEnd < "2024-05-31") continue;
    const state = ct.get(p.periodEnd);
    // X5 (J1 D4): a financial year that ended before the books / incorporation is not due here.
    if (p.periodEnd < ctFrom && !state) continue;
    specs.push({
      key: `ct:${p.periodEnd}`,
      type: "corporate_tax_return",
      title: `Corporate tax return FY ${p.periodStart} to ${p.periodEnd}`,
      titleAr: `إقرار ضريبة الشركات للسنة المالية ${p.periodStart} إلى ${p.periodEnd}`,
      dueDate: p.dueDate,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      legalSource: "FDL 47/2022 Art. 53(1) (9 months after the tax period)",
      completed: state ? isFiledCt(state.status) : false,
      relatedEntityId: state?.id ?? null,
      detail: state ? `Return status: ${state.status}` : "No corporate tax return prepared yet",
    });
  }

  // CT registration (one-off; FTA Decision 3/2024).
  const incorporation = profile.incorporationDate ?? company.createdAt;
  specs.push({
    key: "ct_registration",
    type: "ct_registration",
    title: "Register for corporate tax",
    titleAr: "التسجيل في ضريبة الشركات",
    dueDate: ctRegistrationDeadline(incorporation),
    legalSource: "FDL 47/2022 Art. 51; FTA Decision 3/2024",
    completed: Boolean((company.corporateTaxId ?? "").trim()),
    detail: company.corporateTaxId ? "Corporate tax TRN recorded" : "No corporate tax TRN recorded",
  });

  // Trade licence renewal + UBO confirmation (Cabinet Decision 58/2020).
  if (profile.tradeLicenceExpiry) {
    const expiry = profile.tradeLicenceExpiry;
    if (Number(expiry.slice(0, 4)) <= year) {
      specs.push({
        key: `trade_licence:${expiry}`,
        type: "trade_licence_renewal",
        title: `Renew trade licence (expires ${expiry})`,
        titleAr: `تجديد الرخصة التجارية (تنتهي في ${expiry})`,
        dueDate: expiry,
        legalSource: "Licensing authority of the emirate / free zone",
      });
    }
  }
  const uboDue = profile.tradeLicenceExpiry
    ? `${year}${profile.tradeLicenceExpiry.slice(4)}`.replace(/-02-29$/, "-02-28")
    : `${year}-12-31`;
  specs.push({
    key: `ubo:${year}`,
    type: "ubo_confirmation",
    title: `Confirm the UBO register for ${year}`,
    titleAr: `تأكيد سجل المستفيد الحقيقي لعام ${year}`,
    dueDate: uboDue,
    legalSource: "Cabinet Decision 58/2020 (UBO register; update within 15 days of change)",
    completed: profile.uboLastConfirmed
      ? daysBetween(profile.uboLastConfirmed, uboDue) <= 365 && profile.uboLastConfirmed <= uboDue
      : null,
  });

  // Excise returns: monthly, 15 days after period end.
  if (profile.exciseRegistered) {
    for (const p of monthlyPeriodsDueInYear(year, exciseFilingDeadline)) {
      specs.push({
        key: `excise:${p.periodEnd}`,
        type: "excise_return",
        title: `Excise tax return ${p.periodStart} to ${p.periodEnd}`,
        titleAr: `إقرار الضريبة الانتقائية ${p.periodStart} إلى ${p.periodEnd}`,
        dueDate: p.dueDate,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        legalSource: "FDL 7/2017 (Excise Tax); Cabinet Decision 52/2019 as amended (15 days)",
      });
    }
  }

  // E-invoicing milestones (MD 243/2025 and MD 244/2025).
  const revenue = await latestCtRevenue(companyId);
  const band =
    profile.einvoicingRevenueBand ??
    (revenue !== null && revenue >= 50_000_000 ? "ge_50m" : "lt_50m");
  const milestones =
    band === "ge_50m"
      ? [
          [
            "einvoicing:asp",
            "2026-07-31",
            "Appoint an accredited e-invoicing service provider",
            "تعيين مزود خدمة فوترة إلكترونية معتمد",
          ],
          [
            "einvoicing:golive",
            "2027-01-01",
            "E-invoicing mandatory (revenue AED 50M or more)",
            "إلزامية الفوترة الإلكترونية (إيرادات 50 مليون درهم فأكثر)",
          ],
        ]
      : [
          [
            "einvoicing:asp",
            "2027-03-31",
            "Appoint an accredited e-invoicing service provider",
            "تعيين مزود خدمة فوترة إلكترونية معتمد",
          ],
          [
            "einvoicing:golive",
            "2027-07-01",
            "E-invoicing mandatory (revenue below AED 50M)",
            "إلزامية الفوترة الإلكترونية (إيرادات أقل من 50 مليون درهم)",
          ],
        ];
  for (const [key, due, title, titleAr] of milestones) {
    if (!due.startsWith(`${year}-`)) continue;
    specs.push({
      key,
      type: "einvoicing_milestone",
      title,
      titleAr,
      dueDate: due,
      legalSource: "Ministerial Decisions 243/2025 and 244/2025 (confirm with your adviser)",
    });
  }

  // Payroll / WPS: salaries through WPS by the 15th of the following month.
  if (await hasActiveEmployees(companyId)) {
    const paid = await paidPayrollPeriods(companyId);
    for (const p of monthlyPeriodsDueInYear(year, (end) => addDays(end, 15))) {
      specs.push({
        key: `wps:${p.periodEnd.slice(0, 7)}`,
        type: "wps_payroll",
        title: `Pay ${p.periodEnd.slice(0, 7)} salaries through WPS`,
        titleAr: `دفع رواتب ${p.periodEnd.slice(0, 7)} عبر نظام حماية الأجور`,
        dueDate: p.dueDate,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        legalSource: "FDL 33/2021 Art. 22; MoHRE Ministerial Resolution 43/2022 (WPS)",
        completed: paid.has(p.periodEnd.slice(0, 7)) ? true : null,
      });
    }
  }

  return specs;
}

function deriveStatus(
  spec: ObligationSpec,
  current: ObligationStatus | null,
  today: IsoDate
): ObligationStatus {
  const derived = (DERIVED_STATUS_TYPES as readonly string[]).includes(spec.type);
  if (spec.completed === true) return "completed";
  if (!derived && (current === "completed" || current === "dismissed")) return current;
  // X4 (J3): derived rows marked "not applicable" (e.g. before the company used Muhasib) stay so.
  if (derived && current === "dismissed") return current;
  return spec.dueDate < today ? "overdue" : "upcoming";
}

/** Obligation types whose stale generated rows are removed on regeneration. */
const REMOVABLE_TYPES: readonly string[] = [
  "trade_licence_renewal",
  "excise_return",
  "wps_payroll",
  "einvoicing_milestone",
  "vat_return",
  "corporate_tax_return",
];

export interface GenerateResult {
  year: number;
  generated: number;
  removed: number;
}

/** Generate (upsert) the obligations of `year`; idempotent. */
export async function generateObligations(
  companyId: string,
  year: number,
  now: Date = new Date()
): Promise<GenerateResult> {
  const today = uaeToday(now);
  const specs = await buildObligationSpecs(companyId, year);
  const existing = await pool.query(
    `SELECT obligation_key, status FROM compliance_calendar
      WHERE company_id = $1 AND source = 'generated'`,
    [companyId]
  );
  const statusOf = new Map<string, ObligationStatus>(
    (existing.rows as Array<{ obligation_key: string; status: ObligationStatus }>).map((r) => [
      r.obligation_key,
      r.status,
    ])
  );
  for (const spec of specs) {
    const status = deriveStatus(spec, statusOf.get(spec.key) ?? null, today);
    await pool.query(
      `INSERT INTO compliance_calendar
         (company_id, event_type, description, event_date, reminder_days, status, completed_at,
          source, obligation_key, obligation_type, title_ar, period_start, period_end,
          related_entity_id, legal_source)
       VALUES ($1, $2, $3, $4::date, $5, $6, CASE WHEN $6 = 'completed' THEN now() END,
               'generated', $7, $8, $9, $10::date, $11::date, $12, $13)
       ON CONFLICT (company_id, obligation_key) WHERE obligation_key IS NOT NULL
       DO UPDATE SET
         event_type = EXCLUDED.event_type,
         description = EXCLUDED.description,
         event_date = EXCLUDED.event_date,
         status = EXCLUDED.status,
         completed_at = CASE
           WHEN EXCLUDED.status = 'completed'
             THEN COALESCE(compliance_calendar.completed_at, now())
           ELSE NULL END,
         obligation_type = EXCLUDED.obligation_type,
         title_ar = EXCLUDED.title_ar,
         period_start = EXCLUDED.period_start,
         period_end = EXCLUDED.period_end,
         related_entity_id = EXCLUDED.related_entity_id,
         legal_source = EXCLUDED.legal_source,
         updated_at = now()`,
      [
        companyId,
        EVENT_TYPE[spec.type],
        spec.detail ? `${spec.title} — ${spec.detail}` : spec.title,
        spec.dueDate,
        REMINDER_OFFSETS.join(","),
        status,
        spec.key,
        spec.type,
        spec.titleAr,
        spec.periodStart ?? null,
        spec.periodEnd ?? null,
        spec.relatedEntityId ?? null,
        spec.legalSource,
      ]
    );
  }
  // Rows generated earlier for this year from settings that changed (e.g. a
  // new licence expiry) no longer apply.
  const keys = specs.map((s) => s.key);
  const removed = await pool.query(
    `DELETE FROM compliance_calendar
      WHERE company_id = $1 AND source = 'generated'
        AND EXTRACT(YEAR FROM event_date) = $2
        AND NOT (obligation_key = ANY($3::text[]))
        AND obligation_type = ANY($4::text[])`,
    [companyId, year, keys, REMOVABLE_TYPES]
  );
  return { year, generated: specs.length, removed: removed.rowCount ?? 0 };
}

export interface CalendarRow {
  id: string;
  companyId: string;
  source: "manual" | "generated";
  obligationKey: string | null;
  obligationType: string | null;
  eventType: string;
  title: string;
  titleAr: string | null;
  description: string;
  dueDate: IsoDate;
  eventDate: string;
  periodStart: IsoDate | null;
  periodEnd: IsoDate | null;
  status: ObligationStatus;
  statusDerived: boolean;
  daysUntilDue: number;
  relatedEntityId: string | null;
  legalSource: string | null;
  /** Key + params for a known citation (`shared/server-copy.ts`); null for free text. */
  legalSourceCopy: CopyDescriptor | null;
  reminderDays: string;
  remindersSent: string;
  completedAt: string | null;
  /** False for an obligation computed on read but not stored yet (id `preview:<key>`). */
  persisted: boolean;
  linkedRequirementId?: string | null;
}

interface CalendarDbRow {
  id: string;
  company_id: string;
  source: "manual" | "generated";
  obligation_key: string | null;
  obligation_type: string | null;
  event_type: string;
  description: string;
  title_ar: string | null;
  due: string;
  event_date: string;
  period_start: string | null;
  period_end: string | null;
  status: ObligationStatus;
  related_entity_id: string | null;
  legal_source: string | null;
  reminder_days: string;
  reminders_sent: string;
  completed_at: string | null;
  linked_requirement_id: string | null;
  persisted?: boolean;
}

function toRow(r: CalendarDbRow, today: IsoDate, includeFirmLinks: boolean): CalendarRow {
  const status =
    r.status === "upcoming" && r.due < today
      ? "overdue"
      : r.status === "overdue" && r.due >= today
        ? "upcoming"
        : r.status;
  const row: CalendarRow = {
    id: r.id,
    companyId: r.company_id,
    source: r.source,
    obligationKey: r.obligation_key,
    obligationType: r.obligation_type,
    eventType: r.event_type,
    title: r.description.split(" — ")[0],
    titleAr: r.title_ar,
    description: r.description,
    dueDate: r.due,
    eventDate: new Date(r.event_date).toISOString(),
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status,
    statusDerived:
      r.source === "generated" &&
      (DERIVED_STATUS_TYPES as readonly string[]).includes(r.obligation_type ?? ""),
    daysUntilDue: daysBetween(today, r.due),
    relatedEntityId: r.related_entity_id,
    legalSource: r.legal_source,
    legalSourceCopy: describeLegalSource(r.legal_source),
    reminderDays: r.reminder_days,
    remindersSent: r.reminders_sent,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    persisted: r.persisted !== false,
  };
  // Document requirements are an NR-firm-only feature: hide the link from customers.
  if (includeFirmLinks) row.linkedRequirementId = r.linked_requirement_id;
  return row;
}

const SELECT_ROWS = `SELECT id, company_id, source, obligation_key, obligation_type, event_type,
         description, title_ar, ((event_date)::date)::text AS due, event_date,
         period_start::text AS period_start, period_end::text AS period_end, status,
         related_entity_id, legal_source, reminder_days, reminders_sent, completed_at,
         linked_requirement_id
    FROM compliance_calendar`;

/** The id given to an obligation that is computed but not stored yet. */
export const PREVIEW_ID_PREFIX = "preview:";

function specDescription(spec: ObligationSpec): string {
  return spec.detail ? `${spec.title} — ${spec.detail}` : spec.title;
}

/**
 * Overlay the live obligation specs on the stored rows (read-only, S4).
 *
 * GET never writes: the stored calendar is refreshed by the daily job and when
 * the inputs change (compliance-obligation-refresh observer). Reads merge the
 * freshly computed specs of the current and next year so statuses that follow
 * a return, new periods after a stagger change and companies whose calendar
 * was never stored are still shown correctly. Computed-but-unstored rows carry
 * `persisted: false` and an id of `preview:<obligation key>`.
 */
async function mergeLiveSpecs(
  companyId: string,
  stored: CalendarDbRow[],
  today: IsoDate
): Promise<CalendarDbRow[]> {
  const year = Number(today.slice(0, 4));
  const specsByYear = new Map<number, ObligationSpec[]>();
  const specByKey = new Map<string, ObligationSpec>();
  for (const y of [year, year + 1]) {
    const specs = await buildObligationSpecs(companyId, y);
    specsByYear.set(y, specs);
    for (const spec of specs) specByKey.set(spec.key, spec);
  }
  const out: CalendarDbRow[] = [];
  const storedKeys = new Set<string>();
  for (const row of stored) {
    if (row.obligation_key) storedKeys.add(row.obligation_key);
    if (row.source !== "generated" || !row.obligation_key) {
      out.push(row);
      continue;
    }
    const spec = specByKey.get(row.obligation_key);
    if (!spec) {
      // Regeneration would delete this row (settings changed); hide it now.
      const rowYear = Number(row.due.slice(0, 4));
      const regenerated = specsByYear.get(rowYear);
      if (regenerated && REMOVABLE_TYPES.includes(row.obligation_type ?? "")) continue;
      out.push(row);
      continue;
    }
    out.push({
      ...row,
      event_type: EVENT_TYPE[spec.type],
      description: specDescription(spec),
      due: spec.dueDate,
      event_date: spec.dueDate,
      status: deriveStatus(spec, row.status, today),
      obligation_type: spec.type,
      title_ar: spec.titleAr,
      period_start: spec.periodStart ?? null,
      period_end: spec.periodEnd ?? null,
      related_entity_id: spec.relatedEntityId ?? null,
      legal_source: spec.legalSource,
    });
  }
  for (const spec of specByKey.values()) {
    if (storedKeys.has(spec.key)) continue;
    out.push({
      id: `${PREVIEW_ID_PREFIX}${spec.key}`,
      company_id: companyId,
      source: "generated",
      obligation_key: spec.key,
      obligation_type: spec.type,
      event_type: EVENT_TYPE[spec.type],
      description: specDescription(spec),
      title_ar: spec.titleAr,
      due: spec.dueDate,
      event_date: spec.dueDate,
      period_start: spec.periodStart ?? null,
      period_end: spec.periodEnd ?? null,
      status: deriveStatus(spec, null, today),
      related_entity_id: spec.relatedEntityId ?? null,
      legal_source: spec.legalSource,
      reminder_days: REMINDER_OFFSETS.join(","),
      reminders_sent: "",
      completed_at: null,
      linked_requirement_id: null,
      persisted: false,
    });
  }
  return out;
}

function compareRows(a: CalendarDbRow, b: CalendarDbRow): number {
  if (a.due !== b.due) return a.due < b.due ? -1 : 1;
  const ak = a.obligation_key;
  const bk = b.obligation_key;
  if (ak !== bk) {
    if (ak === null) return 1;
    if (bk === null) return -1;
    return ak < bk ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The company's calendar. Read-only: stored rows merged with the live specs
 * (pass `live: false` for the stored rows only).
 */
export async function listCalendar(
  companyId: string,
  opts: {
    from?: IsoDate;
    to?: IsoDate;
    includeFirmLinks?: boolean;
    now?: Date;
    live?: boolean;
  } = {}
): Promise<CalendarRow[]> {
  const today = uaeToday(opts.now);
  const r = await pool.query(`${SELECT_ROWS} WHERE company_id = $1`, [companyId]);
  let rows = r.rows as CalendarDbRow[];
  if (opts.live !== false) rows = await mergeLiveSpecs(companyId, rows, today);
  return rows
    .filter((row) => (!opts.from || row.due >= opts.from) && (!opts.to || row.due <= opts.to))
    .sort(compareRows)
    .map((row) => toRow(row, today, opts.includeFirmLinks === true));
}

/** A stored generated row by obligation key (used to persist a preview row on write). */
export async function getCalendarRowByKey(
  companyId: string,
  obligationKey: string
): Promise<CalendarRow | null> {
  const r = await pool.query(`${SELECT_ROWS} WHERE company_id = $1 AND obligation_key = $2`, [
    companyId,
    obligationKey,
  ]);
  const row = r.rows[0] as CalendarDbRow | undefined;
  return row ? toRow(row, uaeToday(), false) : null;
}

export async function getCalendarRow(
  companyId: string,
  id: string,
  includeFirmLinks = false
): Promise<CalendarRow | null> {
  const r = await pool.query(`${SELECT_ROWS} WHERE company_id = $1 AND id = $2`, [companyId, id]);
  const row = r.rows[0] as CalendarDbRow | undefined;
  return row ? toRow(row, uaeToday(), includeFirmLinks) : null;
}

/** Upcoming (not completed/dismissed) obligations due within `days` (default 30). */
export async function listUpcoming(
  companyId: string,
  opts: { days?: number; now?: Date } = {}
): Promise<CalendarRow[]> {
  const today = uaeToday(opts.now);
  const to = addDays(today, opts.days ?? 30);
  const rows = await listCalendar(companyId, { to, now: opts.now });
  return rows.filter((r) => r.status === "upcoming" || r.status === "overdue");
}

/** Next open obligation of a type (overview roll-forward). */
export async function nextOpenObligation(
  companyId: string,
  type: ObligationType,
  now: Date = new Date()
): Promise<CalendarRow | null> {
  const rows = await listCalendar(companyId, { now });
  return (
    rows.find(
      (r) => r.obligationType === type && (r.status === "upcoming" || r.status === "overdue")
    ) ?? null
  );
}

/** Store the current and next year (daily job, change observer and explicit generate). */
export async function ensureGenerated(companyId: string, now: Date = new Date()): Promise<void> {
  const year = Number(uaeToday(now).slice(0, 4));
  await generateObligations(companyId, year, now);
  await generateObligations(companyId, year + 1, now);
}

/**
 * Daily scan: regenerate and emit compliance.deadline_due once per reminder
 * offset (30/14/7/1 days) for every open obligation.
 */
export async function runDeadlineScan(now: Date = new Date()): Promise<{ emitted: number }> {
  const today = uaeToday(now);
  const companies = await pool.query(
    `SELECT id FROM companies WHERE COALESCE(deleted_at IS NULL, true)`
  );
  let emitted = 0;
  for (const { id } of companies.rows as Array<{ id: string }>) {
    try {
      await ensureGenerated(id, now);
      const rows = await listCalendar(id, {
        from: today,
        to: addDays(today, 31),
        now,
        live: false,
      });
      for (const row of rows) {
        if (row.status !== "upcoming") continue;
        const offset = REMINDER_OFFSETS.find((d) => d === row.daysUntilDue);
        if (!offset) continue;
        const sent = new Set(row.remindersSent.split(",").filter(Boolean));
        if (sent.has(String(offset))) continue;
        sent.add(String(offset));
        await pool.query(
          `UPDATE compliance_calendar SET reminders_sent = $3, updated_at = now()
            WHERE company_id = $1 AND id = $2`,
          [id, row.id, [...sent].join(",")]
        );
        emitDomainEvent("compliance.deadline_due", {
          companyId: id,
          entityId: row.id,
          obligation: row.obligationType ?? row.eventType,
          dueDate: row.dueDate,
        });
        emitted += 1;
      }
    } catch (err) {
      log.error({ companyId: id, err: (err as Error).message }, "deadline scan failed");
    }
  }
  return { emitted };
}

/** Register the service and the daily job (idempotent). */
export function registerComplianceObligations(): void {
  if (!has("compliance.listUpcoming")) provide("compliance.listUpcoming", listUpcoming);
  if (!listJobs().some((j) => j.name === "compliance.deadlineScan")) {
    registerJob({
      name: "compliance.deadlineScan",
      cron: "10 1 * * *",
      description: "Generate compliance obligations and emit 30/14/7/1-day deadline reminders",
      run: async () => {
        await runDeadlineScan();
      },
    });
  }
}

export { lastDayOfMonth };
