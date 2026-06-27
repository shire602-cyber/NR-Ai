import { z } from "zod";
import { normalizeClientServices, type ClientServiceCode } from "@shared/client-services";

/**
 * Firm-managed-client domain helpers.
 *
 * The functions here are pure (no DB access) so they can be unit-tested
 * cheaply. They support the /api/firm/clients/* routes — primarily the bulk
 * CSV/XLSX import path, which has to be forgiving about column-header
 * variations across spreadsheets exported from QuickBooks, Zoho, Excel, etc.
 */

export const importedClientSchema = z.object({
  name: z.string().min(1),
  trnVatNumber: z.string().optional().or(z.literal("")),
  industry: z.string().optional().or(z.literal("")),
  legalStructure: z.string().optional().or(z.literal("")),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().optional().or(z.literal("")),
  businessAddress: z.string().optional().or(z.literal("")),
  emirate: z.string().optional().or(z.literal("")),
  vatFilingFrequency: z.string().optional().or(z.literal("")),
  vatPeriodStartMonth: z.number().int().min(1).max(12).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  corporateTaxId: z.string().optional().or(z.literal("")),
  serviceScope: z.array(z.enum(["vat", "bookkeeping", "corporate_tax", "accounting"])).optional(),
  registrationNumber: z.string().optional().or(z.literal("")),
  websiteUrl: z.string().optional().or(z.literal("")),
});

export type ImportedClient = z.infer<typeof importedClientSchema>;

const VALID_EMIRATES = new Set([
  "abu_dhabi",
  "dubai",
  "sharjah",
  "ajman",
  "umm_al_quwain",
  "ras_al_khaimah",
  "fujairah",
]);

const VALID_VAT_FILING = new Set(["monthly", "quarterly", "annually"]);

export type VatCohortKey =
  | "jan_apr_jul_oct"
  | "feb_may_aug_nov"
  | "mar_jun_sep_dec"
  | "monthly"
  | "annual";

export type NrClientVatGroupKey = "group_1" | "group_2" | "group_3";

export interface VatCohort {
  key: VatCohortKey;
  label: string;
  closeMonths: number[];
  closeMonthLabels: string[];
}

export interface NrClientVatGroup {
  key: NrClientVatGroupKey;
  label: string;
  vatPeriodStartMonth: number;
  cohortLabel: string;
}

export interface TaxPeriodWindow {
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const VAT_COHORTS: Array<Omit<VatCohort, "closeMonthLabels">> = [
  { key: "jan_apr_jul_oct", label: "Jan / Apr / Jul / Oct", closeMonths: [1, 4, 7, 10] },
  { key: "feb_may_aug_nov", label: "Feb / May / Aug / Nov", closeMonths: [2, 5, 8, 11] },
  { key: "mar_jun_sep_dec", label: "Mar / Jun / Sep / Dec", closeMonths: [3, 6, 9, 12] },
];

export const NR_CLIENT_VAT_GROUPS: Record<NrClientVatGroupKey, NrClientVatGroup> = {
  group_1: {
    key: "group_1",
    label: "Group 1",
    vatPeriodStartMonth: 1,
    cohortLabel: "Jan / Apr / Jul / Oct",
  },
  group_2: {
    key: "group_2",
    label: "Group 2",
    vatPeriodStartMonth: 2,
    cohortLabel: "Feb / May / Aug / Nov",
  },
  group_3: {
    key: "group_3",
    label: "Group 3",
    vatPeriodStartMonth: 3,
    cohortLabel: "Mar / Jun / Sep / Dec",
  },
};

const NR_CLIENT_VAT_GROUP_NAMES: Record<NrClientVatGroupKey, string[]> = {
  group_1: [
    "Al ain business Center",
    "Mokhtar Mohammed",
    "Dar Al mustaqbal",
    "Bandar Qasim",
    "midnimo",
    "High Speed General Trading",
    "Al Intifa Building Materials L.L.C.",
    "Bulsho Building Materials L.L.C.",
    "Hirsi Trading",
    "Eastern Coast General Trading",
    "Al Nezam Al Asasy General Trading",
    "Ebyan lady tailors",
    "Iddle General Trading",
    "Miras fast food",
    "faduma ladies, sufretna, jiba, qasr",
    "faduma ladies",
    "sufretna",
    "jiba",
    "qasr",
    "amal abu dhabi and abraj",
    "amal abu dhabi",
    "abraj",
    "Bab al marouf",
    "OLYMPIC ARAN GENERAL TRADING LLC",
  ],
  group_2: [
    "Noble Gate General Trading",
    "Najmatul Khair General Trading",
    "Anbar General trading LLC",
    "Shabelli",
    "Mohammed Saleh General Trading",
    "Wafaa Jewelary",
    "FATMA RASHED TRADING L.L.C",
    "RAWDHA AL SHARQ TECHNOLOGY L.L.C",
    "TAQWA GENERAL TRADING L.L.C",
    "Bratco Food stuff",
    "AL DARWISH COMMERCIAL BROKER",
    "najma furqan",
    "Najma Al Quds",
    "mashco",
    "bosaso",
    "sifa green",
    "bicco",
    "Al Wein Express",
    "Noujoum al kheir",
    "mowlid cargo",
  ],
  group_3: [
    "AbdulKader Food Stuff L.L.C.",
    "Iftin General Trading",
    "Taran General Trading LLC",
    "Norton General Trading",
    "Hikmah General Trading L.L.C.",
    "Ocean Organic General Trading LLC",
    "Barwaqo General Trading",
    "Ain Al Qamar",
    "Hodan General Trading",
    "Hamar ade General Trading LLC",
    "Moftah Al Nourin General Trading",
    "Abdighani Abdurahman General Trading",
    "JJB Fashion",
    "Najmat Al Iman",
    "Sky Dalma",
    "Digrio",
    "AGDIGA",
    "main souq dahab amal",
    "syrgical",
    "asha gellee",
    "Muradso Computer",
    "next generation",
    "dalsoor",
  ],
};

const MONTH_NAME_ALIASES = new Map<string, number>([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

function toUtcMonth(date: Date): number {
  return date.getUTCMonth() + 1;
}

function toUtcYear(date: Date): number {
  return date.getUTCFullYear();
}

function utcMonthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, normaliseMonth(month) - 1, 1));
}

function addUtcMonths(date: Date, months: number): Date {
  const targetMonthIndex = date.getUTCMonth() + months;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const normalisedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayInTargetMonth = new Date(
    Date.UTC(targetYear, normalisedMonthIndex + 1, 0)
  ).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDayInTargetMonth);
  return new Date(Date.UTC(targetYear, normalisedMonthIndex, day));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function sameMonthSet(a: number[], b: number[]): boolean {
  const left = [...a].sort((x, y) => x - y).join(",");
  const right = [...b].sort((x, y) => x - y).join(",");
  return left === right;
}

export function normaliseNrClientVatGroupName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bnew\s+(?:client|clinet)\b/g, " ")
    .replace(/\bl\s*\.?\s*l\s*\.?\s*c\b/g, " llc ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token && token !== "llc")
    .join(" ")
    .trim();
}

function buildNrClientVatGroupLookup(): Map<string, NrClientVatGroup> {
  const lookup = new Map<string, NrClientVatGroup>();

  for (const [groupKey, names] of Object.entries(NR_CLIENT_VAT_GROUP_NAMES) as Array<
    [NrClientVatGroupKey, string[]]
  >) {
    const group = NR_CLIENT_VAT_GROUPS[groupKey];
    for (const name of names) {
      const normalised = normaliseNrClientVatGroupName(name);
      if (!normalised) continue;
      const existing = lookup.get(normalised);
      if (existing && existing.key !== group.key) {
        throw new Error(
          `Duplicate NR VAT client mapping for "${name}" in ${existing.label} and ${group.label}`
        );
      }
      lookup.set(normalised, group);
    }
  }

  return lookup;
}

const NR_CLIENT_VAT_GROUP_LOOKUP = buildNrClientVatGroupLookup();

export function nrClientVatGroupForName(
  name: string | null | undefined
): NrClientVatGroup | undefined {
  return NR_CLIENT_VAT_GROUP_LOOKUP.get(normaliseNrClientVatGroupName(name));
}

export function vatPeriodStartMonthForNrClientName(
  name: string | null | undefined
): number | undefined {
  return nrClientVatGroupForName(name)?.vatPeriodStartMonth;
}

export function resolveNrClientVatPeriodStartMonth(
  name: string | null | undefined,
  configuredPeriodStartMonth: number | string | null | undefined,
  companyType?: string | null
): number {
  const isFirmClient = companyType == null || companyType === "client";
  return (
    (isFirmClient ? vatPeriodStartMonthForNrClientName(name) : undefined) ??
    normaliseMonth(configuredPeriodStartMonth)
  );
}

export function withNrClientVatGroup<
  T extends { name: string; companyType?: string | null; vatPeriodStartMonth?: number | null },
>(company: T): T & { nrVatGroup?: NrClientVatGroup } {
  if (company.companyType != null && company.companyType !== "client") return company;
  const group = nrClientVatGroupForName(company.name);
  if (!group) return company;
  return {
    ...company,
    vatPeriodStartMonth: group.vatPeriodStartMonth,
    nrVatGroup: group,
  };
}

export function normaliseMonth(month: number | string | null | undefined): number {
  const parsed = Number(month);
  if (!Number.isFinite(parsed)) return 1;
  const whole = Math.trunc(parsed);
  return ((((whole - 1) % 12) + 12) % 12) + 1;
}

export function parseMonthInput(raw: string | number | null | undefined): number | undefined {
  if (raw == null) return undefined;
  const value = String(raw).trim();
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 12) return Math.trunc(numeric);
  const compact = value.toLowerCase().replace(/[^a-z]/g, "");
  if (!compact) return undefined;
  if (MONTH_NAME_ALIASES.has(compact)) return MONTH_NAME_ALIASES.get(compact);
  return MONTH_NAME_ALIASES.get(compact.slice(0, 3));
}

export function monthName(month: number | string | null | undefined): string {
  return MONTH_LABELS[normaliseMonth(month) - 1];
}

export function vatCohortFromPeriodStart(
  periodStartMonth: number | string | null | undefined,
  filingFrequency: string | null | undefined = "quarterly"
): VatCohort {
  const frequency = (filingFrequency || "quarterly").toLowerCase();
  const startMonth = normaliseMonth(periodStartMonth);

  if (frequency === "monthly") {
    const closeMonths = Array.from({ length: 12 }, (_, index) => index + 1);
    return {
      key: "monthly",
      label: "Monthly",
      closeMonths,
      closeMonthLabels: closeMonths.map(monthName),
    };
  }

  if (frequency === "annually") {
    const closeMonths = [normaliseMonth(startMonth + 11)];
    return {
      key: "annual",
      label: `${monthName(closeMonths[0])} annual`,
      closeMonths,
      closeMonthLabels: closeMonths.map(monthName),
    };
  }

  const closeMonths = [3, 6, 9, 12].map((offset) => normaliseMonth(startMonth + offset));
  const cohort =
    VAT_COHORTS.find((candidate) => sameMonthSet(candidate.closeMonths, closeMonths)) ??
    VAT_COHORTS[2];

  return {
    ...cohort,
    closeMonthLabels: cohort.closeMonths.map(monthName),
  };
}

export function currentVatPeriodForCompany(
  now: Date,
  periodStartMonth: number | string | null | undefined,
  filingFrequency: string | null | undefined = "quarterly"
): TaxPeriodWindow {
  const frequency = (filingFrequency || "quarterly").toLowerCase();
  const currentYear = toUtcYear(now);
  const currentMonth = toUtcMonth(now);

  if (frequency === "monthly") {
    const periodStart = utcMonthStart(currentYear, currentMonth);
    const periodEnd = addUtcDays(addUtcMonths(periodStart, 1), -1);
    if (periodEnd >= now) {
      const previousPeriodStart = addUtcMonths(periodStart, -1);
      const previousPeriodEnd = addUtcDays(periodStart, -1);
      return {
        periodStart: previousPeriodStart,
        periodEnd: previousPeriodEnd,
        dueDate: addUtcDays(previousPeriodEnd, 28),
      };
    }
    return { periodStart, periodEnd, dueDate: addUtcDays(periodEnd, 28) };
  }

  const periodLength = frequency === "annually" ? 12 : 3;
  const startMonth = normaliseMonth(periodStartMonth);
  const distance = (currentMonth - startMonth + 12) % 12;
  const cycleOffset = Math.floor(distance / periodLength) * periodLength;
  const candidateStartMonth = normaliseMonth(startMonth + cycleOffset);
  const candidateYear = candidateStartMonth > currentMonth ? currentYear - 1 : currentYear;
  const periodStart = utcMonthStart(candidateYear, candidateStartMonth);
  const periodEnd = addUtcDays(addUtcMonths(periodStart, periodLength), -1);
  if (periodEnd >= now) {
    const previousPeriodStart = addUtcMonths(periodStart, -periodLength);
    const previousPeriodEnd = addUtcDays(periodStart, -1);
    return {
      periodStart: previousPeriodStart,
      periodEnd: previousPeriodEnd,
      dueDate: addUtcDays(previousPeriodEnd, 28),
    };
  }

  return { periodStart, periodEnd, dueDate: addUtcDays(periodEnd, 28) };
}

export function corporateTaxWindow(
  now: Date,
  fiscalYearStartMonth: number | string | null | undefined
): TaxPeriodWindow {
  const startMonth = normaliseMonth(fiscalYearStartMonth);
  const currentYear = toUtcYear(now);
  const currentMonth = toUtcMonth(now);
  const periodStartYear = currentMonth >= startMonth ? currentYear : currentYear - 1;
  const periodStart = utcMonthStart(periodStartYear, startMonth);
  const periodEnd = addUtcDays(addUtcMonths(periodStart, 12), -1);
  const dueDate = addUtcMonths(periodEnd, 9);

  return { periodStart, periodEnd, dueDate };
}

export function nextCorporateTaxFilingWindow(
  now: Date,
  fiscalYearStartMonth: number | string | null | undefined
): TaxPeriodWindow {
  const activeWindow = corporateTaxWindow(now, fiscalYearStartMonth);
  const previousPeriodEnd = addUtcDays(activeWindow.periodStart, -1);
  const previousPeriodStart = addUtcMonths(activeWindow.periodStart, -12);
  const previousWindow = {
    periodStart: previousPeriodStart,
    periodEnd: previousPeriodEnd,
    dueDate: addUtcMonths(previousPeriodEnd, 9),
  };

  return previousWindow.dueDate >= now ? previousWindow : activeWindow;
}

/**
 * Look up the first non-empty value across a list of column-name candidates,
 * trimming whitespace. Returns '' when nothing matches.
 */
function pick(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

/**
 * Normalise an emirate value to our canonical `lower_snake_case` form.
 * Unknown values fall back to empty so callers can default to 'dubai'.
 */
export function normaliseEmirate(raw: string): string {
  const slug = raw.toLowerCase().trim().replace(/\s+/g, "_");
  return VALID_EMIRATES.has(slug) ? slug : "";
}

/**
 * Normalise a VAT-filing-frequency value. Anything unrecognised is dropped so
 * the caller can fall back to the default.
 */
export function normaliseVatFiling(raw: string): string {
  const slug = raw.toLowerCase().trim();
  return VALID_VAT_FILING.has(slug) ? slug : "";
}

export function normaliseFiscalYearStartMonth(raw: string): number | undefined {
  return parseMonthInput(raw);
}

export function normaliseVatCloseGroup(raw: string): number | undefined {
  const value = raw.trim();
  if (!value) return undefined;

  const directPeriodStart = parseMonthInput(value);
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (
    compact.includes("jan") &&
    compact.includes("apr") &&
    compact.includes("jul") &&
    compact.includes("oct")
  ) {
    return 1;
  }
  if (
    compact.includes("feb") &&
    compact.includes("may") &&
    compact.includes("aug") &&
    compact.includes("nov")
  ) {
    return 2;
  }
  if (
    compact.includes("mar") &&
    compact.includes("jun") &&
    compact.includes("sep") &&
    compact.includes("dec")
  ) {
    return 3;
  }

  if (!directPeriodStart) return undefined;
  if ([1, 4, 7, 10].includes(directPeriodStart)) return 1;
  if ([2, 5, 8, 11].includes(directPeriodStart)) return 2;
  return 3;
}

export function normaliseServiceScope(raw: string): ClientServiceCode[] | undefined {
  if (!raw.trim()) return undefined;
  const compact = raw.toLowerCase();
  const services: ClientServiceCode[] = [];
  if (/\bvat\b|tax return|vat return/.test(compact)) services.push("vat");
  if (/bookkeep|monthly close|source document|receipt|bank recon/.test(compact))
    services.push("bookkeeping");
  if (/corporate tax|\bct\b|tax registration/.test(compact)) services.push("corporate_tax");
  if (/accounting|trial balance|journal|ledger|management account/.test(compact))
    services.push("accounting");
  if (services.length === 0)
    return normalizeClientServices(raw, []).length > 0
      ? normalizeClientServices(raw, [])
      : undefined;
  return normalizeClientServices(services);
}

/**
 * Map a free-form CSV/Excel row into our import shape. Returns an `error`
 * object instead of throwing when essential fields (the company name) are
 * missing — the caller aggregates these into per-row error reports.
 */
export function mapImportRow(row: Record<string, unknown>): ImportedClient | { error: string } {
  const name = pick(
    row,
    "name",
    "Name",
    "Company Name",
    "company_name",
    "Client Name",
    "client",
    "Business Name"
  );
  if (!name) return { error: "Company name is required" };

  return {
    name,
    trnVatNumber: pick(row, "trnVatNumber", "trn", "TRN", "VAT Number", "Tax Registration Number"),
    industry: pick(row, "industry", "Industry", "Sector", "Business Type"),
    legalStructure: pick(
      row,
      "legalStructure",
      "Legal Structure",
      "legal_structure",
      "Business Structure"
    ),
    contactEmail: pick(
      row,
      "contactEmail",
      "email",
      "Email",
      "Contact Email",
      "contact_email",
      "E-mail"
    ),
    contactPhone: pick(
      row,
      "contactPhone",
      "phone",
      "Phone",
      "Contact Phone",
      "contact_phone",
      "Tel",
      "Telephone"
    ),
    businessAddress: pick(
      row,
      "businessAddress",
      "address",
      "Address",
      "Business Address",
      "business_address"
    ),
    emirate: normaliseEmirate(pick(row, "emirate", "Emirate")),
    vatFilingFrequency: normaliseVatFiling(
      pick(row, "vatFilingFrequency", "VAT Filing", "VAT Frequency")
    ),
    vatPeriodStartMonth:
      normaliseFiscalYearStartMonth(
        pick(
          row,
          "vatPeriodStartMonth",
          "VAT Period Start Month",
          "VAT Start Month",
          "VAT Cycle Start"
        )
      ) ??
      normaliseVatCloseGroup(
        pick(
          row,
          "vatCloseGroup",
          "VAT Close Group",
          "VAT Closing Group",
          "VAT Closing Months",
          "VAT Cohort",
          "VAT Group"
        )
      ) ??
      vatPeriodStartMonthForNrClientName(name),
    fiscalYearStartMonth: normaliseFiscalYearStartMonth(
      pick(
        row,
        "fiscalYearStartMonth",
        "Financial Year Start",
        "Fiscal Year Start",
        "FY Start",
        "FY Start Month"
      )
    ),
    corporateTaxId: pick(
      row,
      "corporateTaxId",
      "Corporate Tax ID",
      "Corporate Tax Registration",
      "CT ID",
      "CT Registration"
    ),
    serviceScope: normaliseServiceScope(
      pick(
        row,
        "serviceScope",
        "Service Scope",
        "Services",
        "Services Included",
        "Engagement Services"
      )
    ),
    registrationNumber: pick(
      row,
      "registrationNumber",
      "Registration Number",
      "registration_number"
    ),
    websiteUrl: pick(row, "websiteUrl", "website", "Website", "URL", "Web"),
  };
}

/**
 * Validate a mapped row. Returns the parsed value on success or a string
 * error message on failure (e.g. "invalid email").
 */
export function validateImportedClient(
  mapped: ImportedClient
): { ok: true; value: ImportedClient } | { ok: false; error: string } {
  const result = importedClientSchema.safeParse(mapped);
  if (!result.success) {
    return { ok: false, error: result.error.errors[0]?.message ?? "Invalid row" };
  }
  return { ok: true, value: result.data };
}
