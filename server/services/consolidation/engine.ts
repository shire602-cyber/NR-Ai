/**
 * Management consolidation engine (W5-C: R14-18, R12-12).
 *
 * Builds a group P&L and balance sheet from each member's posted ledger as read by the reporting
 * kernel (server/reporting: posted entries only, closing / year-end entries excluded), then:
 *
 *  1. Translation (IAS 21 style) of every member whose functional currency differs from the
 *     group's reporting currency: assets and liabilities at the CLOSING rate on `to`; income and
 *     expenses at the AVERAGE rate; share capital and other non-retained equity at the HISTORICAL
 *     rate of each posting (spot rate on the entry date); retained earnings brought forward at
 *     the closing rate of the prior fiscal year end (documented approximation of the historical
 *     rate). The cumulative translation adjustment (CTA) is the balancing figure in equity.
 *     Rates come from fx.getRate scoped to the group's parent company.
 *  2. Non-controlling interest: (1 − ownership) × the member's translated net assets and profit.
 *  3. Eliminations: rule-generated from the group's intercompany account maps (matched balances
 *     at `to`, matched revenue/expense in [from, to]; the unmatched difference is REPORTED, never
 *     hidden) plus manual group-level elimination journals. Eliminations never touch an
 *     entity's ledger.
 *
 * Everything is summed in integer minor units; numbers leave this module once, via `major()`.
 * This is a MANAGEMENT consolidation: no statutory claims, corporate tax stays per entity.
 */
import Decimal from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  companies,
  companyGroupMembers,
  companyGroups,
  eliminationJournals,
  eliminationLines,
  intercompanyAccountMaps,
  type CompanyGroup,
  type CompanyGroupMember,
  type IntercompanyAccountMap,
} from "../../../shared/schema";
import {
  accountTotals,
  addDays,
  balanceSheet,
  fiscalYearStart,
  isNonCurrent,
  isRetainedEarningsAccount,
  ledgerLines,
  loadAccounts,
  loadCompany,
  plSection,
  profitAndLoss,
  type AccountTotals,
  type IsoDate,
  type PlSection,
  type ReportAccount,
} from "../../reporting";
import { baseCurrencyOf } from "../../ledger";
import { RATE_DECIMALS } from "../../../shared/money";
import { DomainError } from "../../errors";
import { resolve } from "../../platform/service-registry";
import type { FxGetRate, RateResult } from "../fx";

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const MANAGEMENT_CONSOLIDATION_LABEL = {
  en: "Management consolidation — not a statutory consolidation",
  ar: "توحيد إداري — ليس توحيدًا نظاميًا",
};
export const CORPORATE_TAX_NOTE = {
  en: "Corporate tax remains per entity: each member files its own return. Tax group relief is not modelled.",
  ar: "تبقى ضريبة الشركات لكل منشأة على حدة: تقدم كل شركة إقرارها. لا يتم احتساب إعفاء المجموعة الضريبية.",
};

/** Integer minor units → major-unit number (single division). */
export function major(minor: number): number {
  const v = minor / 100;
  return Object.is(v, -0) ? 0 : v;
}

// ─── Rates ─────────────────────────────────────────────────────────────────

export interface RateUsed {
  rate: string;
  rateType: string;
  date: string;
  source: string;
  scope: string;
  stale: boolean;
  warning?: string;
}

function rateUsed(r: RateResult): RateUsed {
  return {
    rate: r.rateText,
    rateType: r.rateType,
    date: r.date,
    source: r.source,
    scope: r.scope,
    stale: r.stale,
    ...(r.warning ? { warning: r.warning } : {}),
  };
}

/** Translate integer minor units with a looked-up rate (exact for inverse pairs). */
export function translateMinor(
  minor: number,
  r: { rateText: string; inverse: boolean; storedRate: string }
): number {
  if (minor === 0) return 0;
  const v = r.inverse
    ? new D(minor).dividedBy(new D(r.storedRate))
    : new D(minor).times(new D(r.rateText));
  const n = v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return Object.is(n, -0) ? 0 : n;
}

const IDENTITY = (date: string): RateResult => ({
  rate: 1,
  rateText: (1).toFixed(RATE_DECIMALS),
  source: "identity",
  date,
  stale: false,
  ageDays: 0,
  scope: "identity",
  inverse: false,
  rateType: "spot",
  rateId: null,
  storedRate: (1).toFixed(RATE_DECIMALS),
});

// ─── Types ─────────────────────────────────────────────────────────────────

export type BsSection =
  | "current_assets"
  | "non_current_assets"
  | "current_liabilities"
  | "non_current_liabilities"
  | "equity";

export interface ConsolidatedLine {
  key: string;
  accountCode: string;
  accountName: string;
  accountNameAr: string | null;
  section: PlSection | BsSection;
  /** Translated amount per member (reporting currency, natural sign). */
  byEntity: Record<string, number>;
  eliminations: number;
  total: number;
}

export interface StatementBlock {
  total: number;
  lines: ConsolidatedLine[];
}

export interface EliminationLineOut {
  companyId: string;
  companyName: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string | null;
}

export interface EliminationOut {
  id: string | null;
  kind: "rule" | "manual";
  mapId: string | null;
  mapKind: string | null;
  label: string;
  date: string;
  lines: EliminationLineOut[];
  /** Rule eliminations: translated natural balances of side A / side B and what was matched. */
  amountA?: number;
  amountB?: number;
  matched?: number;
  /** amountA − amountB: left in the consolidated figures and reported, never hidden. */
  unmatchedDifference?: number;
}

export interface EntityOut {
  companyId: string;
  name: string;
  functionalCurrency: string;
  ownershipPercent: number;
  method: string;
  included: boolean;
  excludedReason?: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** Entity statements in its functional currency (reporting-kernel output). */
  snapshot?: {
    currency: string;
    profitAndLoss: {
      revenue: number;
      totalIncome: number;
      totalExpenses: number;
      netProfit: number;
    };
    balanceSheet: {
      totalAssets: number;
      totalLiabilities: number;
      totalEquity: number;
      isBalanced: boolean;
    };
  };
  translated?: {
    totalIncome: number;
    totalExpenses: number;
    netProfit: number;
    totalAssets: number;
    totalLiabilities: number;
    capital: number;
    retainedEarningsBroughtForward: number;
    currentYearEarnings: number;
    cta: number;
    netAssets: number;
  };
  warnings: string[];
}

export interface ConsolidatedStatements {
  basis: "management_consolidation";
  label: { en: string; ar: string };
  corporateTaxNote: { en: string; ar: string };
  group: { id: string; name: string; parentCompanyId: string; reportingCurrency: string };
  period: { from: IsoDate; to: IsoDate; fiscalYearStart: IsoDate };
  entities: EntityOut[];
  eliminations: EliminationOut[];
  translation: {
    reportingCurrency: string;
    method: string;
    rates: Array<{
      companyId: string;
      currency: string;
      closing: RateUsed;
      average: RateUsed;
      retainedEarnings: RateUsed;
      historical: Array<{ date: string } & RateUsed>;
    }>;
    cta: { total: number; byEntity: Array<{ companyId: string; amount: number }> };
  };
  consolidated: {
    profitAndLoss: {
      reportingCurrency: string;
      from: IsoDate;
      to: IsoDate;
      sections: Record<
        "revenue" | "costOfSales" | "operatingExpenses" | "otherIncome" | "otherExpenses",
        StatementBlock
      >;
      revenue: number;
      costOfSales: number;
      grossProfit: number;
      operatingExpenses: number;
      operatingProfit: number;
      otherIncome: number;
      otherExpenses: number;
      totalIncome: number;
      totalExpenses: number;
      netProfit: number;
      attributableToOwners: number;
      attributableToNci: number;
    };
    balanceSheet: {
      reportingCurrency: string;
      asOf: IsoDate;
      assets: { current: StatementBlock; nonCurrent: StatementBlock; total: number };
      liabilities: { current: StatementBlock; nonCurrent: StatementBlock; total: number };
      equity: {
        capital: StatementBlock;
        retainedEarningsBroughtForward: number;
        currentYearEarnings: number;
        cumulativeTranslationAdjustment: number;
        total: number;
        attributableToOwners: number;
        nonControllingInterest: number;
      };
      totalAssets: number;
      totalLiabilities: number;
      totalEquity: number;
      totalLiabilitiesAndEquity: number;
      isBalanced: boolean;
      difference: number;
    };
  };
  nci: {
    equity: number;
    profit: number;
    byEntity: Array<{
      companyId: string;
      ownershipPercent: number;
      nciPercent: number;
      netAssets: number;
      nciEquity: number;
      netProfit: number;
      nciProfit: number;
    }>;
  };
  warnings: string[];
  generatedAt: string;
}

// ─── Loading ───────────────────────────────────────────────────────────────

export interface GroupBundle {
  group: CompanyGroup;
  members: Array<CompanyGroupMember & { name: string; baseCurrency: string }>;
  maps: IntercompanyAccountMap[];
}

export async function loadGroupBundle(groupId: string): Promise<GroupBundle> {
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) throw new DomainError("GROUP_NOT_FOUND", 404);
  const [group] = await db.select().from(companyGroups).where(eq(companyGroups.id, groupId));
  if (!group) throw new DomainError("GROUP_NOT_FOUND", 404);
  const rows = await db
    .select({ m: companyGroupMembers, name: companies.name, baseCurrency: companies.baseCurrency })
    .from(companyGroupMembers)
    .innerJoin(companies, eq(companies.id, companyGroupMembers.companyId))
    .where(eq(companyGroupMembers.groupId, groupId));
  const maps = await db
    .select()
    .from(intercompanyAccountMaps)
    .where(eq(intercompanyAccountMaps.groupId, groupId));
  return {
    group,
    members: rows.map((r: (typeof rows)[number]) => ({
      ...r.m,
      name: r.name,
      baseCurrency: baseCurrencyOf({ baseCurrency: r.baseCurrency }),
    })),
    maps,
  };
}

interface ManualJournal {
  id: string;
  date: string;
  memo: string | null;
  lines: Array<{
    companyId: string;
    accountId: string;
    debitMinor: number;
    creditMinor: number;
    description: string | null;
  }>;
}

async function loadManualJournals(groupId: string, to: IsoDate): Promise<ManualJournal[]> {
  const journals = await db
    .select()
    .from(eliminationJournals)
    .where(
      and(
        eq(eliminationJournals.groupId, groupId),
        eq(eliminationJournals.kind, "manual"),
        eq(eliminationJournals.status, "posted")
      )
    );
  const inScope = journals.filter((j: (typeof journals)[number]) => String(j.date) <= to);
  if (!inScope.length) return [];
  const lines = await db
    .select()
    .from(eliminationLines)
    .where(
      inArray(
        eliminationLines.journalId,
        inScope.map((j: (typeof journals)[number]) => j.id)
      )
    );
  return inScope
    .sort((a: (typeof journals)[number], b: (typeof journals)[number]) =>
      String(a.date).localeCompare(String(b.date))
    )
    .map((j: (typeof journals)[number]) => ({
      id: j.id,
      date: String(j.date),
      memo: j.memo ?? null,
      lines: lines
        .filter((l: (typeof lines)[number]) => l.journalId === j.id)
        .map((l: (typeof lines)[number]) => ({
          companyId: l.companyId,
          accountId: l.accountId,
          debitMinor: Number(l.debitMinor),
          creditMinor: Number(l.creditMinor),
          description: l.description ?? null,
        })),
    }));
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const natural = (a: ReportAccount, t: AccountTotals | undefined): number => {
  if (!t) return 0;
  return a.type === "asset" || a.type === "expense" ? t.debit - t.credit : t.credit - t.debit;
};

/** Natural-sign effect of a debit/credit on an account (asset/expense: dr +; others: cr +). */
const naturalEffect = (type: string, debit: number, credit: number): number =>
  type === "asset" || type === "expense" ? debit - credit : credit - debit;

function bsSection(a: ReportAccount): BsSection | null {
  if (a.type === "asset") return isNonCurrent(a) ? "non_current_assets" : "current_assets";
  if (a.type === "liability")
    return isNonCurrent(a) ? "non_current_liabilities" : "current_liabilities";
  if (a.type === "equity") return "equity";
  return null;
}

const lineKey = (a: ReportAccount) =>
  a.code ? `code:${a.code}` : `name:${a.nameEn.toLowerCase()}`;

class LineBook {
  private lines = new Map<
    string,
    ConsolidatedLine & { minor: Map<string, number>; elimMinor: number }
  >();
  add(
    a: ReportAccount,
    section: PlSection | BsSection,
    companyId: string,
    minor: number,
    elim = false
  ) {
    const key = `${section}|${lineKey(a)}`;
    let l = this.lines.get(key);
    if (!l) {
      l = {
        key,
        accountCode: a.code,
        accountName: a.nameEn,
        accountNameAr: a.nameAr,
        section,
        byEntity: {},
        eliminations: 0,
        total: 0,
        minor: new Map(),
        elimMinor: 0,
      };
      this.lines.set(key, l);
    }
    if (elim) l.elimMinor += minor;
    else l.minor.set(companyId, (l.minor.get(companyId) ?? 0) + minor);
  }
  block(sections: Array<PlSection | BsSection>): { totalMinor: number; block: StatementBlock } {
    const out: ConsolidatedLine[] = [];
    let total = 0;
    for (const l of this.lines.values()) {
      if (!sections.includes(l.section)) continue;
      const entitySum = [...l.minor.values()].reduce((s, v) => s + v, 0);
      const t = entitySum + l.elimMinor;
      if (t === 0 && entitySum === 0 && l.elimMinor === 0) continue;
      total += t;
      out.push({
        key: l.key,
        accountCode: l.accountCode,
        accountName: l.accountName,
        accountNameAr: l.accountNameAr,
        section: l.section,
        byEntity: Object.fromEntries([...l.minor.entries()].map(([k, v]) => [k, major(v)])),
        eliminations: major(l.elimMinor),
        total: major(t),
      });
    }
    out.sort(
      (a, b) =>
        a.accountCode.localeCompare(b.accountCode) || a.accountName.localeCompare(b.accountName)
    );
    return { totalMinor: total, block: { total: major(total), lines: out } };
  }
}

function overlaps(
  m: { effectiveFrom: string | null; effectiveTo: string | null },
  from: IsoDate,
  to: IsoDate
) {
  const ef = m.effectiveFrom ? String(m.effectiveFrom).slice(0, 10) : null;
  const et = m.effectiveTo ? String(m.effectiveTo).slice(0, 10) : null;
  if (ef && ef > to) return false;
  if (et && et < from) return false;
  return true;
}

// ─── Engine ────────────────────────────────────────────────────────────────

interface EntityWork {
  member: GroupBundle["members"][number];
  accounts: Map<string, ReportAccount>;
  pl: Map<string, AccountTotals>;
  cum: Map<string, AccountTotals>;
  closing: RateResult;
  average: RateResult;
}

export async function buildConsolidatedStatements(
  bundle: GroupBundle,
  range: { from: IsoDate; to: IsoDate }
): Promise<ConsolidatedStatements> {
  const { group, members, maps } = bundle;
  const { from, to } = range;
  if (from > to) {
    throw new DomainError(
      "INVALID_REPORT_RANGE",
      400,
      { from, to },
      "from must be on or before to"
    );
  }
  const R = group.reportingCurrency.toUpperCase();
  const getRate = resolve<FxGetRate>("fx.getRate");
  const parent = await loadCompany(group.parentCompanyId);
  const fyStart = fiscalYearStart(to, parent.fiscalYearStartMonth);
  const priorYearEnd = addDays(fyStart, -1);
  const warnings: string[] = [];

  const rateCache = new Map<string, RateResult>();
  const rateFor = async (
    cur: string,
    date: string,
    rateType: "spot" | "closing" | "average"
  ): Promise<RateResult> => {
    if (cur === R) return IDENTITY(date);
    const k = `${cur}|${date}|${rateType}`;
    const hit = rateCache.get(k);
    if (hit) return hit;
    const r = await getRate(group.parentCompanyId, cur, R, date, {
      rateType,
      maxAgeDays: rateType === "spot" ? 3650 : 31,
    });
    rateCache.set(k, r);
    return r;
  };

  const entities: EntityOut[] = [];
  const work: EntityWork[] = [];
  const pl = new LineBook();
  const bs = new LineBook();
  const ratesOut: ConsolidatedStatements["translation"]["rates"] = [];
  const ctaByEntity: Array<{ companyId: string; amount: number }> = [];
  const nciByEntity: ConsolidatedStatements["nci"]["byEntity"] = [];
  let reBfMinor = 0;
  let cyeMinor = 0;
  let ctaMinor = 0;
  let nciEquityMinor = 0;
  let nciProfitMinor = 0;

  const ordered = [...members].sort((a, b) =>
    a.companyId === group.parentCompanyId
      ? -1
      : b.companyId === group.parentCompanyId
        ? 1
        : a.name.localeCompare(b.name)
  );

  for (const m of ordered) {
    const ownership = Number(m.ownershipPercent);
    const base: EntityOut = {
      companyId: m.companyId,
      name: m.name,
      functionalCurrency: m.baseCurrency,
      ownershipPercent: Math.round(ownership * 10000) / 100,
      method: m.method,
      included: false,
      effectiveFrom: m.effectiveFrom ? String(m.effectiveFrom) : null,
      effectiveTo: m.effectiveTo ? String(m.effectiveTo) : null,
      warnings: [],
    };
    if (m.method !== "full") {
      entities.push({ ...base, excludedReason: "method_none" });
      continue;
    }
    if (!overlaps(m, from, to)) {
      entities.push({ ...base, excludedReason: "outside_effective_dates" });
      continue;
    }
    const cur = m.baseCurrency;
    let closing: RateResult;
    let average: RateResult;
    let reRate: RateResult;
    try {
      closing = await rateFor(cur, to, "closing");
      average = await rateFor(cur, to, "average");
      // No prior-year-end rate yet (first year of trading): fall back to the closing rate.
      reRate = await rateFor(cur, priorYearEnd, "closing").catch(() => closing);
    } catch (err) {
      if (err instanceof DomainError && err.code === "NO_EXCHANGE_RATE") {
        throw new DomainError(
          "CONSOLIDATION_RATE_MISSING",
          422,
          { companyId: m.companyId, currency: cur, reportingCurrency: R, date: to },
          `No ${cur}→${R} rate on or before ${to} for ${m.name}; add closing and average rates on the parent company's Exchange Rates page.`
        );
      }
      throw err;
    }
    const entityWarnings = [closing.warning, average.warning].filter(Boolean) as string[];

    const [accountsList, plTotals, cum, preFy, cy, plSnap, bsSnap] = await Promise.all([
      loadAccounts(m.companyId),
      accountTotals(m.companyId, { from, to }),
      accountTotals(m.companyId, { to }),
      accountTotals(m.companyId, { to: priorYearEnd }),
      accountTotals(m.companyId, { from: fyStart, to }),
      profitAndLoss({ companyId: m.companyId, from, to }),
      balanceSheet({ companyId: m.companyId, asOf: to }),
    ]);
    const accounts = new Map(accountsList.map((a) => [a.id, a]));

    let incomeT = 0;
    let expenseT = 0;
    let assetsT = 0;
    let liabT = 0;
    let capitalT = 0;
    let reAccountsLocal = 0;
    for (const a of accountsList) {
      const sec = plSection(a);
      if (sec) {
        const amt = translateMinor(natural(a, plTotals.get(a.id)), average);
        if (amt !== 0) pl.add(a, sec, m.companyId, amt);
        if (a.type === "income") incomeT += amt;
        else expenseT += amt;
        continue;
      }
      const bsec = bsSection(a);
      if (!bsec) continue;
      const nat = natural(a, cum.get(a.id));
      if (a.type === "equity") {
        if (isRetainedEarningsAccount(a)) {
          reAccountsLocal += nat;
          continue;
        }
        continue; // capital handled below at historical rates
      }
      const amt = translateMinor(nat, closing);
      if (amt !== 0) bs.add(a, bsec, m.companyId, amt);
      if (a.type === "asset") assetsT += amt;
      else liabT += amt;
    }

    // Capital at historical rates: each posted equity line at the spot rate on its date.
    const capitalAccounts = accountsList.filter(
      (a) => a.type === "equity" && !isRetainedEarningsAccount(a)
    );
    const historical = new Map<string, RateResult>();
    if (capitalAccounts.length) {
      const lines = await ledgerLines(m.companyId, {
        to,
        accountIds: capitalAccounts.map((a) => a.id),
      });
      const perAccount = new Map<string, number>();
      for (const l of lines) {
        let r: RateResult;
        if (cur === R) r = IDENTITY(l.date);
        else {
          try {
            r = historical.get(l.date) ?? (await rateFor(cur, l.date, "spot"));
          } catch (err) {
            if (!(err instanceof DomainError) || err.code !== "NO_EXCHANGE_RATE") throw err;
            r = closing;
            entityWarnings.push(
              `No ${cur}→${R} spot rate on or before ${l.date} for equity; the closing rate was used.`
            );
          }
          historical.set(l.date, r);
        }
        const amt = translateMinor(l.credit - l.debit, r);
        perAccount.set(l.accountId, (perAccount.get(l.accountId) ?? 0) + amt);
      }
      for (const [accountId, amt] of perAccount) {
        const a = accounts.get(accountId)!;
        if (amt !== 0) bs.add(a, "equity", m.companyId, amt);
        capitalT += amt;
      }
    }

    // Retained earnings b/f (prior fiscal years' P&L + RE account balances) and CYE.
    let preFyNi = 0;
    let cyNi = 0;
    for (const a of accountsList) {
      if (a.type === "income") {
        preFyNi += natural(a, preFy.get(a.id));
        cyNi += natural(a, cy.get(a.id));
      } else if (a.type === "expense") {
        preFyNi -= natural(a, preFy.get(a.id));
        cyNi -= natural(a, cy.get(a.id));
      }
    }
    const reBfT = translateMinor(preFyNi + reAccountsLocal, reRate);
    const cyeT = translateMinor(cyNi, average);
    const netAssetsT = assetsT - liabT;
    const ctaT = netAssetsT - capitalT - reBfT - cyeT;
    const netProfitT = incomeT - expenseT;

    reBfMinor += reBfT;
    cyeMinor += cyeT;
    ctaMinor += ctaT;
    ctaByEntity.push({ companyId: m.companyId, amount: major(ctaT) });

    if (ownership < 1) {
      const nciPct = new D(1).minus(new D(String(m.ownershipPercent)));
      const nciEq = new D(netAssetsT).times(nciPct).toDecimalPlaces(0).toNumber();
      const nciPr = new D(netProfitT).times(nciPct).toDecimalPlaces(0).toNumber();
      nciEquityMinor += nciEq;
      nciProfitMinor += nciPr;
      nciByEntity.push({
        companyId: m.companyId,
        ownershipPercent: base.ownershipPercent,
        nciPercent: nciPct.times(100).toDecimalPlaces(2).toNumber(),
        netAssets: major(netAssetsT),
        nciEquity: major(nciEq),
        netProfit: major(netProfitT),
        nciProfit: major(nciPr),
      });
    }

    ratesOut.push({
      companyId: m.companyId,
      currency: cur,
      closing: rateUsed(closing),
      average: rateUsed(average),
      retainedEarnings: rateUsed(reRate),
      historical: [...historical.entries()].map(([date, r]) => ({ ...rateUsed(r), date })),
    });

    entities.push({
      ...base,
      included: true,
      snapshot: {
        currency: cur,
        profitAndLoss: {
          revenue: plSnap.revenue,
          totalIncome: plSnap.totalIncome,
          totalExpenses: plSnap.totalExpenses,
          netProfit: plSnap.netProfit,
        },
        balanceSheet: {
          totalAssets: bsSnap.totalAssets,
          totalLiabilities: bsSnap.totalLiabilities,
          totalEquity: bsSnap.totalEquity,
          isBalanced: bsSnap.isBalanced,
        },
      },
      translated: {
        totalIncome: major(incomeT),
        totalExpenses: major(expenseT),
        netProfit: major(netProfitT),
        totalAssets: major(assetsT),
        totalLiabilities: major(liabT),
        capital: major(capitalT),
        retainedEarningsBroughtForward: major(reBfT),
        currentYearEarnings: major(cyeT),
        cta: major(ctaT),
        netAssets: major(netAssetsT),
      },
      warnings: entityWarnings,
    });
    if (!bsSnap.isBalanced) {
      warnings.push(
        `${m.name}: the entity balance sheet does not balance (difference ${bsSnap.difference}).`
      );
    }
    work.push({ member: m, accounts, pl: plTotals, cum, closing, average });
  }

  const workBy = new Map(work.map((w) => [w.member.companyId, w]));

  // ─── Eliminations ───────────────────────────────────────────────────────
  const eliminations: EliminationOut[] = [];
  let elimReBf = 0;
  let elimCye = 0;
  const elimLineOut = (
    w: EntityWork,
    a: ReportAccount,
    debit: number,
    credit: number,
    description: string | null
  ): EliminationLineOut => ({
    companyId: w.member.companyId,
    companyName: w.member.name,
    accountId: a.id,
    accountCode: a.code,
    accountName: a.nameEn,
    debit: major(debit),
    credit: major(credit),
    description,
  });

  for (const map of maps) {
    const wa = workBy.get(map.companyAId);
    const wb = workBy.get(map.companyBId);
    const label =
      map.label ||
      (map.kind === "receivable_payable" ? "Intercompany balances" : "Intercompany transactions");
    if (!wa || !wb) {
      warnings.push(
        `${label}: a mapped member is not consolidated in this period; the rule was skipped.`
      );
      continue;
    }
    const aa = wa.accounts.get(map.accountAId);
    const ab = wb.accounts.get(map.accountBId);
    if (!aa || !ab) {
      warnings.push(`${label}: a mapped account no longer exists; the rule was skipped.`);
      continue;
    }
    const isBalance = map.kind === "receivable_payable";
    const amtA = isBalance
      ? translateMinor(natural(aa, wa.cum.get(aa.id)), wa.closing)
      : translateMinor(natural(aa, wa.pl.get(aa.id)), wa.average);
    const amtB = isBalance
      ? translateMinor(natural(ab, wb.cum.get(ab.id)), wb.closing)
      : translateMinor(natural(ab, wb.pl.get(ab.id)), wb.average);
    const matched = Math.min(Math.max(amtA, 0), Math.max(amtB, 0));
    const lines: EliminationLineOut[] = [];
    if (matched > 0) {
      // Reduce each side's natural balance by `matched`.
      const sideA = aa.type === "asset" || aa.type === "expense" ? [0, matched] : [matched, 0];
      const sideB = ab.type === "asset" || ab.type === "expense" ? [0, matched] : [matched, 0];
      lines.push(elimLineOut(wa, aa, sideA[0], sideA[1], label));
      lines.push(elimLineOut(wb, ab, sideB[0], sideB[1], label));
      const secA = (isBalance ? bsSection(aa) : plSection(aa))!;
      const secB = (isBalance ? bsSection(ab) : plSection(ab))!;
      (isBalance ? bs : pl).add(aa, secA, wa.member.companyId, -matched, true);
      (isBalance ? bs : pl).add(ab, secB, wb.member.companyId, -matched, true);
      // A P&L pair nets to zero profit when one side is income and the other expense;
      // anything else changes current-year earnings.
      if (!isBalance) {
        const profitEffect = (a: ReportAccount) => (a.type === "income" ? -matched : matched);
        elimCye += profitEffect(aa) + profitEffect(ab);
      }
    }
    eliminations.push({
      id: null,
      kind: "rule",
      mapId: map.id,
      mapKind: map.kind,
      label,
      date: to,
      lines,
      amountA: major(amtA),
      amountB: major(amtB),
      matched: major(matched),
      unmatchedDifference: major(amtA - amtB),
    });
    if (amtA !== amtB) {
      warnings.push(
        `${label}: ${wa.member.name} shows ${major(amtA)} and ${wb.member.name} shows ${major(amtB)} ${R}; ` +
          `the unmatched difference of ${major(amtA - amtB)} remains in the consolidated figures.`
      );
    }
  }

  for (const j of await loadManualJournals(group.id, to)) {
    const lines: EliminationLineOut[] = [];
    for (const l of j.lines) {
      const w = workBy.get(l.companyId);
      if (!w) {
        warnings.push(
          `Elimination ${j.memo ?? j.id}: line for a member not consolidated was skipped.`
        );
        continue;
      }
      const a = w.accounts.get(l.accountId);
      if (!a) continue;
      const eff = naturalEffect(a.type, l.debitMinor, l.creditMinor);
      const psec = plSection(a);
      if (psec) {
        const profit = a.type === "income" ? eff : -eff;
        if (j.date < fyStart) {
          elimReBf += profit;
        } else {
          elimCye += profit;
          if (j.date >= from) pl.add(a, psec, l.companyId, eff, true);
        }
      } else if (a.type === "equity" && isRetainedEarningsAccount(a)) {
        elimReBf += eff;
      } else {
        const bsec = bsSection(a);
        if (bsec) bs.add(a, bsec, l.companyId, eff, true);
      }
      lines.push(elimLineOut(w, a, l.debitMinor, l.creditMinor, l.description));
    }
    eliminations.push({
      id: j.id,
      kind: "manual",
      mapId: null,
      mapKind: null,
      label: j.memo ?? "Manual elimination",
      date: j.date,
      lines,
    });
  }

  // ─── Statements ─────────────────────────────────────────────────────────
  const rev = pl.block(["revenue"]);
  const cos = pl.block(["cost_of_sales"]);
  const opex = pl.block(["operating_expenses"]);
  const oi = pl.block(["other_income"]);
  const oe = pl.block(["other_expenses"]);
  const netProfit =
    rev.totalMinor + oi.totalMinor - cos.totalMinor - opex.totalMinor - oe.totalMinor;

  const ca = bs.block(["current_assets"]);
  const nca = bs.block(["non_current_assets"]);
  const cl = bs.block(["current_liabilities"]);
  const ncl = bs.block(["non_current_liabilities"]);
  const cap = bs.block(["equity"]);
  const capitalMinor = cap.totalMinor;
  const totalAssets = ca.totalMinor + nca.totalMinor;
  const totalLiabilities = cl.totalMinor + ncl.totalMinor;
  const reBf = reBfMinor + elimReBf;
  const cye = cyeMinor + elimCye;
  const totalEquity = capitalMinor + reBf + cye + ctaMinor;
  const diff = totalAssets - totalLiabilities - totalEquity;
  if (diff !== 0) {
    warnings.push(`The consolidated balance sheet is out by ${major(diff)} ${R}.`);
  }
  if (!work.length) warnings.push("No member is consolidated for this period.");

  return {
    basis: "management_consolidation",
    label: MANAGEMENT_CONSOLIDATION_LABEL,
    corporateTaxNote: CORPORATE_TAX_NOTE,
    group: {
      id: group.id,
      name: group.name,
      parentCompanyId: group.parentCompanyId,
      reportingCurrency: R,
    },
    period: { from, to, fiscalYearStart: fyStart },
    entities,
    eliminations,
    translation: {
      reportingCurrency: R,
      method:
        "Assets and liabilities at the closing rate; income and expenses at the average rate; " +
        "share capital at historical (posting-date spot) rates; retained earnings brought forward " +
        "at the prior fiscal year-end closing rate; the difference is the cumulative translation adjustment.",
      rates: ratesOut,
      cta: { total: major(ctaMinor), byEntity: ctaByEntity },
    },
    consolidated: {
      profitAndLoss: {
        reportingCurrency: R,
        from,
        to,
        sections: {
          revenue: rev.block,
          costOfSales: cos.block,
          operatingExpenses: opex.block,
          otherIncome: oi.block,
          otherExpenses: oe.block,
        },
        revenue: major(rev.totalMinor),
        costOfSales: major(cos.totalMinor),
        grossProfit: major(rev.totalMinor - cos.totalMinor),
        operatingExpenses: major(opex.totalMinor),
        operatingProfit: major(rev.totalMinor - cos.totalMinor - opex.totalMinor),
        otherIncome: major(oi.totalMinor),
        otherExpenses: major(oe.totalMinor),
        totalIncome: major(rev.totalMinor + oi.totalMinor),
        totalExpenses: major(cos.totalMinor + opex.totalMinor + oe.totalMinor),
        netProfit: major(netProfit),
        attributableToOwners: major(netProfit - nciProfitMinor),
        attributableToNci: major(nciProfitMinor),
      },
      balanceSheet: {
        reportingCurrency: R,
        asOf: to,
        assets: { current: ca.block, nonCurrent: nca.block, total: major(totalAssets) },
        liabilities: { current: cl.block, nonCurrent: ncl.block, total: major(totalLiabilities) },
        equity: {
          capital: cap.block,
          retainedEarningsBroughtForward: major(reBf),
          currentYearEarnings: major(cye),
          cumulativeTranslationAdjustment: major(ctaMinor),
          total: major(totalEquity),
          attributableToOwners: major(totalEquity - nciEquityMinor),
          nonControllingInterest: major(nciEquityMinor),
        },
        totalAssets: major(totalAssets),
        totalLiabilities: major(totalLiabilities),
        totalEquity: major(totalEquity),
        totalLiabilitiesAndEquity: major(totalLiabilities + totalEquity),
        isBalanced: diff === 0,
        difference: major(diff),
      },
    },
    nci: { equity: major(nciEquityMinor), profit: major(nciProfitMinor), byEntity: nciByEntity },
    warnings: [...warnings, ...entities.flatMap((e) => e.warnings.map((w) => `${e.name}: ${w}`))],
    generatedAt: new Date().toISOString(),
  };
}
