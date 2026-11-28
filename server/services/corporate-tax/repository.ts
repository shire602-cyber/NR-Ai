/**
 * Corporate-tax data access (W4-A). Raw SQL on the shared pool; every query
 * is company-scoped. Ledger figures are read through server/reporting only.
 */
import { pool } from "../../db";
import { DomainError } from "../../errors";
import {
  CT_ACCOUNT_TAX_TAGS,
  CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP,
  type CtAccountTaxTag,
} from "../../../shared/ct-workpaper";
import {
  accountTotals,
  aed,
  ctLineTreatmentTotals,
  loadAccounts,
  type CtLineTreatmentTotal,
} from "../../reporting";

/** Statuses that represent the live return for a period (not superseded or voided). */
export const LIVE_CT_STATUSES = ["draft", "computed", "reviewed", "filed", "paid"] as const;

// ─── Company CT profile ─────────────────────────────────────────────────────

export interface CtProfile {
  companyId: string;
  isQfzp: boolean;
  freeZone: string | null;
  mneGroupRevenue: number | null;
  incorporationDate: string | null;
  tradeLicenceExpiry: string | null;
  exciseRegistered: boolean;
  uboLastConfirmed: string | null;
  einvoicingRevenueBand: "ge_50m" | "lt_50m" | null;
  adviserConfirmedAt: string | null;
  adviserConfirmedBy: string | null;
  adviserName: string | null;
  adviserNote: string | null;
  /** UI flag: "adviser review pending" until a confirmation is recorded. */
  adviserReviewPending: boolean;
}

function isoDay(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function rowToProfile(companyId: string, row: Record<string, unknown> | undefined): CtProfile {
  const confirmedAt = row?.adviser_confirmed_at
    ? new Date(row.adviser_confirmed_at as string).toISOString()
    : null;
  return {
    companyId,
    isQfzp: row?.is_qfzp === true,
    freeZone: (row?.free_zone as string) ?? null,
    mneGroupRevenue: row?.mne_group_revenue == null ? null : Number(row.mne_group_revenue),
    incorporationDate: isoDay(row?.incorporation_date),
    tradeLicenceExpiry: isoDay(row?.trade_licence_expiry),
    exciseRegistered: row?.excise_registered === true,
    uboLastConfirmed: isoDay(row?.ubo_last_confirmed),
    einvoicingRevenueBand:
      (row?.einvoicing_revenue_band as CtProfile["einvoicingRevenueBand"]) ?? null,
    adviserConfirmedAt: confirmedAt,
    adviserConfirmedBy: (row?.adviser_confirmed_by as string) ?? null,
    adviserName: (row?.adviser_name as string) ?? null,
    adviserNote: (row?.adviser_note as string) ?? null,
    adviserReviewPending: !confirmedAt,
  };
}

export async function getCtProfile(companyId: string): Promise<CtProfile> {
  const r = await pool.query(`SELECT * FROM ct_company_profiles WHERE company_id = $1`, [
    companyId,
  ]);
  return rowToProfile(companyId, r.rows[0]);
}

const PROFILE_COLUMNS: Record<string, string> = {
  isQfzp: "is_qfzp",
  freeZone: "free_zone",
  mneGroupRevenue: "mne_group_revenue",
  incorporationDate: "incorporation_date",
  tradeLicenceExpiry: "trade_licence_expiry",
  exciseRegistered: "excise_registered",
  uboLastConfirmed: "ubo_last_confirmed",
  einvoicingRevenueBand: "einvoicing_revenue_band",
};

export async function upsertCtProfile(
  companyId: string,
  patch: Record<string, unknown>,
  userId: string
): Promise<CtProfile> {
  await pool.query(
    `INSERT INTO ct_company_profiles (company_id, updated_by) VALUES ($1, $2)
     ON CONFLICT (company_id) DO NOTHING`,
    [companyId, userId]
  );
  const sets: string[] = [];
  const values: unknown[] = [companyId];
  for (const [key, column] of Object.entries(PROFILE_COLUMNS)) {
    if (patch[key] === undefined) continue;
    values.push(patch[key]);
    sets.push(`${column} = $${values.length}`);
  }
  // A material profile change (e.g. QFZP status) invalidates the adviser confirmation.
  const material = patch.isQfzp !== undefined || patch.mneGroupRevenue !== undefined;
  values.push(userId);
  sets.push(`updated_by = $${values.length}`, `updated_at = now()`);
  if (material) sets.push(`adviser_confirmed_at = NULL`, `adviser_confirmed_by = NULL`);
  await pool.query(
    `UPDATE ct_company_profiles SET ${sets.join(", ")} WHERE company_id = $1`,
    values
  );
  return getCtProfile(companyId);
}

export async function confirmCtAdviserReview(
  companyId: string,
  userId: string,
  adviserName: string,
  note: string | null
): Promise<CtProfile> {
  await pool.query(
    `INSERT INTO ct_company_profiles (company_id, adviser_confirmed_at, adviser_confirmed_by,
       adviser_name, adviser_note, updated_by)
     VALUES ($1, now(), $2, $3, $4, $2)
     ON CONFLICT (company_id) DO UPDATE SET
       adviser_confirmed_at = now(), adviser_confirmed_by = EXCLUDED.adviser_confirmed_by,
       adviser_name = EXCLUDED.adviser_name, adviser_note = EXCLUDED.adviser_note,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [companyId, userId, adviserName, note]
  );
  return getCtProfile(companyId);
}

// ─── Related-party register ─────────────────────────────────────────────────

export interface CtRelatedPartyRow {
  id: string;
  companyId: string;
  name: string;
  relationship: "related_party" | "connected_person";
  jurisdiction: string | null;
  nature: string | null;
  periodYear: number | null;
  transactionValue: number;
  notes: string | null;
  createdAt: string;
}

function rowToRelatedParty(r: Record<string, unknown>): CtRelatedPartyRow {
  return {
    id: r.id as string,
    companyId: r.company_id as string,
    name: r.name as string,
    relationship: r.relationship as CtRelatedPartyRow["relationship"],
    jurisdiction: (r.jurisdiction as string) ?? null,
    nature: (r.nature as string) ?? null,
    periodYear: r.period_year == null ? null : Number(r.period_year),
    transactionValue: Number(r.transaction_value) || 0,
    notes: (r.notes as string) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

export async function listRelatedParties(companyId: string): Promise<CtRelatedPartyRow[]> {
  const r = await pool.query(
    `SELECT * FROM ct_related_parties WHERE company_id = $1 ORDER BY created_at`,
    [companyId]
  );
  return r.rows.map(rowToRelatedParty);
}

export async function createRelatedParty(
  companyId: string,
  input: {
    name: string;
    relationship: string;
    jurisdiction?: string | null;
    nature?: string | null;
    periodYear?: number | null;
    transactionValue?: number;
    notes?: string | null;
  },
  userId: string
): Promise<CtRelatedPartyRow> {
  const r = await pool.query(
    `INSERT INTO ct_related_parties
       (company_id, name, relationship, jurisdiction, nature, period_year, transaction_value, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      companyId,
      input.name,
      input.relationship,
      input.jurisdiction ?? null,
      input.nature ?? null,
      input.periodYear ?? null,
      input.transactionValue ?? 0,
      input.notes ?? null,
      userId,
    ]
  );
  return rowToRelatedParty(r.rows[0]);
}

export async function deleteRelatedParty(companyId: string, id: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM ct_related_parties WHERE company_id = $1 AND id = $2`, [
    companyId,
    id,
  ]);
  return (r.rowCount ?? 0) > 0;
}

/** Register total for a tax period: rows for the period-end year or undated rows. */
export async function relatedPartyRegisterTotal(
  companyId: string,
  periodEndYear: number
): Promise<number> {
  const r = await pool.query(
    `SELECT COALESCE(SUM(ROUND(transaction_value * 100)), 0)::bigint AS f
       FROM ct_related_parties
      WHERE company_id = $1 AND relationship = 'related_party'
        AND (period_year IS NULL OR period_year = $2)`,
    [companyId, periodEndYear]
  );
  return aed(Number(r.rows[0]?.f ?? 0));
}

// ─── Prior-period facts (exclude superseded / voided returns) ───────────────

export interface PriorCtFacts {
  lossBroughtForward: number;
  interestCarriedForward: number;
  priorPeriodsExceededRevenueCap: boolean;
}

export async function getPriorCtFacts(
  companyId: string,
  periodStart: string,
  excludeReturnId?: string
): Promise<PriorCtFacts> {
  const r = await pool.query(
    `SELECT id, total_revenue, loss_carried_forward, interest_carried_forward,
            ((tax_period_end + interval '4 hours')::date)::text AS period_end_local
       FROM corporate_tax_returns
      WHERE company_id = $1
        AND status = ANY($2::text[])
        AND ((tax_period_end + interval '4 hours')::date) < $3::date
        AND ($4::uuid IS NULL OR id <> $4::uuid)
      ORDER BY tax_period_end DESC, created_at DESC`,
    [companyId, LIVE_CT_STATUSES as unknown as string[], periodStart, excludeReturnId ?? null]
  );
  // A4 (M13, FDL 47/2022 Art. 37): returns filed outside Muhasib (before go-live) carry their
  // losses and disallowed interest forward too; the latest prior period wins, whichever source.
  const ext = await pool.query(
    `SELECT tax_period_end::text AS period_end, total_revenue, loss_carried_forward,
            interest_carried_forward
       FROM ct_external_returns
      WHERE company_id = $1 AND tax_period_end < $2::date
      ORDER BY tax_period_end DESC`,
    [companyId, periodStart]
  );
  const latestLive = r.rows[0];
  const latestExt = ext.rows[0];
  const liveEnd: string | null = latestLive?.period_end_local ?? null;
  const latest =
    latestExt && (!liveEnd || String(latestExt.period_end) > liveEnd) ? latestExt : latestLive;
  return {
    lossBroughtForward: Number(latest?.loss_carried_forward ?? 0) || 0,
    interestCarriedForward: Number(latest?.interest_carried_forward ?? 0) || 0,
    priorPeriodsExceededRevenueCap: [...r.rows, ...ext.rows].some(
      (row: { total_revenue: string | null }) =>
        (Number(row.total_revenue) || 0) > CT_SMALL_BUSINESS_RELIEF_REVENUE_CAP
    ),
  };
}

/** Live returns whose period overlaps [start, end] (overlap guard on create). */
export async function findOverlappingReturn(
  companyId: string,
  start: string,
  end: string,
  excludeReturnId?: string
): Promise<string | null> {
  const r = await pool.query(
    `SELECT id FROM corporate_tax_returns
      WHERE company_id = $1 AND status = ANY($2::text[])
        AND ((tax_period_start + interval '4 hours')::date) <= $4::date
        AND ((tax_period_end + interval '4 hours')::date) >= $3::date
        AND ($5::uuid IS NULL OR id <> $5::uuid)
      LIMIT 1`,
    [companyId, LIVE_CT_STATUSES as unknown as string[], start, end, excludeReturnId ?? null]
  );
  return r.rows[0]?.id ?? null;
}

// ─── Account tax tags (R08-18) ──────────────────────────────────────────────

interface TagAccountSpec {
  tag: CtAccountTaxTag;
  code: string;
  nameEn: string;
  nameAr: string;
  type: "income" | "expense" | "liability";
  subType?: string;
  /** Existing default-chart account to tag instead of creating one. */
  adoptCode?: string;
}

/** Accounts created (or adopted) on demand; defaultChartOfAccounts.ts is untouched. */
export const CT_TAG_ACCOUNT_SPECS: readonly TagAccountSpec[] = [
  {
    tag: "entertainment",
    code: "5091",
    nameEn: "Client Entertainment",
    nameAr: "ضيافة العملاء",
    type: "expense",
  },
  {
    tag: "fines_penalties",
    code: "5151",
    nameEn: "Fines & Penalties",
    nameAr: "الغرامات والجزاءات",
    type: "expense",
  },
  {
    tag: "donations_non_qualifying",
    code: "5152",
    nameEn: "Donations (non-qualifying)",
    nameAr: "تبرعات لجهات غير مؤهلة",
    type: "expense",
  },
  {
    tag: "interest",
    code: "5153",
    nameEn: "Interest Expense",
    nameAr: "مصروف الفوائد",
    type: "expense",
  },
  {
    tag: "related_party",
    code: "5154",
    nameEn: "Related-Party Charges",
    nameAr: "رسوم الأطراف ذات العلاقة",
    type: "expense",
  },
  {
    tag: "exempt_income",
    code: "4095",
    nameEn: "Exempt Income (dividends / participation)",
    nameAr: "دخل معفى (توزيعات / مشاركات)",
    type: "income",
  },
  {
    tag: "corporate_tax_expense",
    code: "5200",
    nameEn: "Corporate Tax Expense",
    nameAr: "مصروف ضريبة الشركات",
    type: "expense",
    // A3 (H3): income tax is presented after profit before tax (IAS 1.82(d)).
    subType: "income_tax",
  },
  {
    tag: "corporate_tax_payable",
    code: "2060",
    nameEn: "Corporate Tax Payable",
    nameAr: "ضريبة الشركات المستحقة الدفع",
    type: "liability",
    subType: "current_liability",
  },
];

export interface TaggedAccount {
  id: string;
  code: string;
  nameEn: string;
  type: string;
  taxTag: CtAccountTaxTag;
}

interface TaggedAccountRow {
  id: string;
  code: string;
  name_en: string;
  type: string;
  tax_tag: CtAccountTaxTag;
}

export async function listTaggedAccounts(companyId: string): Promise<TaggedAccount[]> {
  const r = await pool.query(
    `SELECT id, code, name_en, type, tax_tag FROM accounts
      WHERE company_id = $1 AND tax_tag IS NOT NULL ORDER BY code`,
    [companyId]
  );
  return r.rows.map((row: TaggedAccountRow) => ({
    id: row.id,
    code: row.code,
    nameEn: row.name_en,
    type: row.type,
    taxTag: row.tax_tag,
  }));
}

async function freeCode(companyId: string, preferred: string): Promise<string> {
  const r = await pool.query(`SELECT code FROM accounts WHERE company_id = $1`, [companyId]);
  const taken = new Set(r.rows.map((row: { code: string }) => String(row.code)));
  let n = Number(preferred);
  while (taken.has(String(n))) n += 1;
  return String(n);
}

/**
 * Make sure the company has one active account per CT tag (creating tagged
 * accounts on demand). Idempotent; returns the tag → account map.
 */
export async function ensureCtTagAccounts(
  companyId: string,
  tags: readonly CtAccountTaxTag[] = CT_TAG_ACCOUNT_SPECS.map((s) => s.tag)
): Promise<Map<CtAccountTaxTag, TaggedAccount>> {
  const wanted = new Set(tags);
  const existing = await listTaggedAccounts(companyId);
  const byTag = new Map<CtAccountTaxTag, TaggedAccount>();
  for (const a of existing) if (!byTag.has(a.taxTag)) byTag.set(a.taxTag, a);
  for (const spec of CT_TAG_ACCOUNT_SPECS) {
    if (!wanted.has(spec.tag) || byTag.has(spec.tag)) continue;
    // Adopt an untagged account that already carries the spec code and name.
    const same = await pool.query(
      `UPDATE accounts SET tax_tag = $3, updated_at = now()
        WHERE company_id = $1 AND code = $2 AND tax_tag IS NULL AND type = $4
          AND lower(name_en) = lower($5)
        RETURNING id, code, name_en, type, tax_tag`,
      [companyId, spec.code, spec.tag, spec.type, spec.nameEn]
    );
    let row = same.rows[0];
    if (!row) {
      const code = await freeCode(companyId, spec.code);
      const ins = await pool.query(
        `INSERT INTO accounts (company_id, code, name_en, name_ar, type, sub_type, tax_tag,
                               is_system_account, is_active, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false,true,$8)
         ON CONFLICT (company_id, code) DO NOTHING
         RETURNING id, code, name_en, type, tax_tag`,
        [
          companyId,
          code,
          spec.nameEn,
          spec.nameAr,
          spec.type,
          spec.subType ?? null,
          spec.tag,
          "Created by the corporate tax module for account-driven CT adjustments",
        ]
      );
      row = ins.rows[0];
    }
    if (row) {
      byTag.set(spec.tag, {
        id: row.id,
        code: row.code,
        nameEn: row.name_en,
        type: row.type,
        taxTag: row.tax_tag,
      });
    }
  }
  return byTag;
}

export async function setAccountTaxTag(
  companyId: string,
  accountId: string,
  taxTag: CtAccountTaxTag | null
): Promise<TaggedAccount | null> {
  if (taxTag !== null && !(CT_ACCOUNT_TAX_TAGS as readonly string[]).includes(taxTag)) {
    throw new DomainError("CT_TAX_TAG_INVALID", 400);
  }
  const r = await pool.query(
    `UPDATE accounts SET tax_tag = $3, updated_at = now()
      WHERE company_id = $1 AND id = $2
      RETURNING id, code, name_en, type, tax_tag`,
    [companyId, accountId, taxTag]
  );
  const row = r.rows[0];
  if (!row) throw new DomainError("ACCOUNT_NOT_FOUND", 404);
  return { id: row.id, code: row.code, nameEn: row.name_en, type: row.type, taxTag: row.tax_tag };
}

// ─── Books (reporting kernel) ───────────────────────────────────────────────

export interface CtBooksRow {
  id: string;
  type: "revenue" | "expense";
  label: string;
  nameAr: string | null;
  amount: number;
  notes: string;
  accountId: string;
  taxTag: CtAccountTaxTag | null;
  /**
   * WQ3: the part of `amount` the account's tax tag applies to (AED): the account's net less the
   * lines that carry their own CT treatment, which take precedence over the tag. Absent = amount.
   */
  taggedAmount?: number;
}

export interface CtBooksSnapshot {
  rows: CtBooksRow[];
  /** WQ3 (9.16): per-line CT treatments of the period (server/reporting ct-line-treatments). */
  lineTreatments?: CtLineTreatmentTotal[];
  /** Tag aggregates in AED (natural sign: expense debit-positive, income credit-positive). */
  tags: {
    interestExpense: number;
    interestIncome: number;
    relatedPartyActivity: number;
    qfzpQualifyingIncome: number;
    qfzpNonQualifyingIncome: number;
    hasQfzpTags: boolean;
    corporateTaxExpenseExcluded: number;
  };
}

/**
 * Posted, non-closing P&L activity per account for the period (reporting
 * kernel), with CT-tag aggregates. Corporate tax expense itself is excluded
 * from the CT base (non-deductible, FDL 47/2022 Art. 33(9)).
 */
export async function readCtBooks(
  companyId: string,
  from: string,
  to: string
): Promise<CtBooksSnapshot> {
  const [accounts, totals, taggedRows, lineTreatments] = await Promise.all([
    loadAccounts(companyId),
    accountTotals(companyId, { from, to }),
    pool.query(`SELECT id, tax_tag FROM accounts WHERE company_id = $1 AND tax_tag IS NOT NULL`, [
      companyId,
    ]),
    ctLineTreatmentTotals(companyId, { from, to }),
  ]);
  // A line's own CT treatment overrides its account's tax tag for that line.
  const treatedFils = new Map<string, number>();
  for (const t of lineTreatments)
    treatedFils.set(t.accountId, (treatedFils.get(t.accountId) ?? 0) + t.amountFils);
  const tagOf = new Map<string, CtAccountTaxTag>(
    taggedRows.rows.map((r: { id: string; tax_tag: CtAccountTaxTag }) => [r.id, r.tax_tag])
  );
  const tags: CtBooksSnapshot["tags"] = {
    interestExpense: 0,
    interestIncome: 0,
    relatedPartyActivity: 0,
    qfzpQualifyingIncome: 0,
    qfzpNonQualifyingIncome: 0,
    hasQfzpTags: false,
    corporateTaxExpenseExcluded: 0,
  };
  const rows: CtBooksRow[] = [];
  for (const account of accounts) {
    const t = totals.get(account.id);
    const tag = tagOf.get(account.id) ?? null;
    if (tag === "qfzp_qualifying_income" || tag === "qfzp_non_qualifying_income") {
      tags.hasQfzpTags = true;
    }
    if (!t) continue;
    if (tag === "related_party") tags.relatedPartyActivity += aed(t.debit + t.credit);
    if (account.type !== "income" && account.type !== "expense") continue;
    const fils = account.type === "income" ? t.credit - t.debit : t.debit - t.credit;
    const amount = aed(fils);
    if (amount === 0) continue;
    if (tag === "corporate_tax_expense") {
      tags.corporateTaxExpenseExcluded += amount;
      continue;
    }
    if (tag === "interest") {
      if (account.type === "expense") tags.interestExpense += amount;
      else tags.interestIncome += amount;
    }
    if (tag === "qfzp_qualifying_income" && account.type === "income") {
      tags.qfzpQualifyingIncome += amount;
    }
    if (tag === "qfzp_non_qualifying_income" && account.type === "income") {
      tags.qfzpNonQualifyingIncome += amount;
    }
    rows.push({
      id: `books-${account.id}`,
      type: account.type === "income" ? "revenue" : "expense",
      label: account.nameEn,
      nameAr: account.nameAr?.trim() || null,
      amount,
      notes: `Posted net for ${account.code ?? ""}`.trim(),
      accountId: account.id,
      taxTag: tag,
      ...(tag && treatedFils.has(account.id)
        ? { taggedAmount: aed(fils - (treatedFils.get(account.id) ?? 0)) }
        : {}),
    });
  }
  rows.sort((a, b) => (a.type === b.type ? b.amount - a.amount : a.type === "revenue" ? -1 : 1));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  tags.interestExpense = r2(tags.interestExpense);
  tags.interestIncome = r2(tags.interestIncome);
  tags.relatedPartyActivity = r2(tags.relatedPartyActivity);
  tags.qfzpQualifyingIncome = r2(tags.qfzpQualifyingIncome);
  tags.qfzpNonQualifyingIncome = r2(tags.qfzpNonQualifyingIncome);
  tags.corporateTaxExpenseExcluded = r2(tags.corporateTaxExpenseExcluded);
  return { rows, tags, lineTreatments };
}
