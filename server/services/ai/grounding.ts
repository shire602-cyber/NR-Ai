// Server-computed grounding for AI answers (R05-09, R05-25, R05-26, S3).
//
// CFO advice and the NL gateway never use client-supplied figures. Ledger figures come from the
// reporting kernel (server/reporting): the same profit-and-loss, balance sheet and aged
// receivables every statement uses (posted entries only, closing entries excluded, fiscal year
// from the company settings, integer-fils sums). Only document counts (receipts) are read
// directly. Each figure gets a stable id (F1, F2, ...) so answers can cite it and the response can
// carry a citations block.

import { round2 } from "../financial-statements";
import type { AgingReport, BalanceSheet, IsoDate, ProfitAndLoss } from "../../reporting";
import type { QueryResultRow } from "pg";

export interface GroundedFigure {
  id: string;
  label: string;
  value: number;
  unit: "AED" | "count";
  /** Where the figure comes from (shown to the user as the citation). */
  source: string;
}

export interface GroundingResult {
  companyName: string | null;
  period: { start: string; end: string };
  figures: GroundedFigure[];
  /** Human-readable list of things we could not compute (drives "insufficient data"). */
  missing: string[];
  /** True when there is not enough posted data to answer financial questions. */
  insufficientData: boolean;
}

export interface GroundingDeps {
  /** Document reads that are not ledger figures (company name, receipt counts). */
  query(sql: string, params: unknown[]): Promise<{ rows: QueryResultRow[] }>;
  profitAndLoss(args: { companyId: string; from: IsoDate; to: IsoDate }): Promise<ProfitAndLoss>;
  balanceSheet(args: { companyId: string; asOf: IsoDate }): Promise<BalanceSheet>;
  agedReceivables(args: { companyId: string; asOf: IsoDate }): Promise<AgingReport>;
}

async function defaultDeps(): Promise<GroundingDeps> {
  const { pool } = await import("../../db");
  const reporting = await import("../../reporting");
  return {
    query: (sql, params) => pool.query(sql, params),
    profitAndLoss: (args) => reporting.profitAndLoss(args),
    balanceSheet: (args) => reporting.balanceSheet(args),
    agedReceivables: (args) => reporting.agedReceivables(args),
  };
}

/** UAE calendar date of an instant. */
function uaeDate(d: Date): IsoDate {
  return new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}

const SQL_RECEIPTS = `
  SELECT COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE posted)::int AS posted,
         COALESCE(SUM(base_currency_amount) FILTER (WHERE NOT posted),0)::float8 AS unposted_value
    FROM receipts
   WHERE company_id = $1 AND date >= $2::date AND date < ($3::date + 1)`;

export async function buildGroundedContext(
  companyId: string,
  opts: { asOf?: Date; deps?: GroundingDeps } = {}
): Promise<GroundingResult> {
  const deps = opts.deps ?? (await defaultDeps());
  const asOf = uaeDate(opts.asOf ?? new Date());

  // The balance sheet carries the company's fiscal-year start for this as-of date.
  const [company, bs, ar] = await Promise.all([
    deps.query(`SELECT name FROM companies WHERE id = $1`, [companyId]),
    deps.balanceSheet({ companyId, asOf }),
    deps.agedReceivables({ companyId, asOf }),
  ]);
  const start = bs.fiscalYearStart;
  const period = { start, end: asOf };
  const [pl, receipts] = await Promise.all([
    deps.profitAndLoss({ companyId, from: start, to: asOf }),
    deps.query(SQL_RECEIPTS, [companyId, start, asOf]),
  ]);

  const figures: GroundedFigure[] = [];
  const missing: string[] = [];
  const add = (label: string, value: number, unit: GroundedFigure["unit"], from: string) => {
    figures.push({ id: `F${figures.length + 1}`, label, value: round2(value), unit, source: from });
  };

  const plLines = Object.values(pl.sections).reduce((n, sec) => n + sec.lines.length, 0);
  const plFrom = `Profit and loss (posted ledger) ${period.start} to ${period.end}`;
  if (plLines === 0) {
    missing.push(`No posted journal entries in ${period.start} to ${period.end}`);
  } else {
    add("Revenue (fiscal year to date)", pl.totalIncome, "AED", plFrom);
    add("Expenses (fiscal year to date)", pl.totalExpenses, "AED", plFrom);
    add("Net profit (fiscal year to date)", pl.netProfit, "AED", plFrom);
  }

  const bsFrom = `Balance sheet (posted ledger) as of ${period.end}`;
  const bsLines =
    bs.assets.current.lines.length +
    bs.assets.nonCurrent.lines.length +
    bs.liabilities.current.lines.length +
    bs.liabilities.nonCurrent.lines.length;
  if (bsLines > 0) {
    add("Total assets", bs.totalAssets, "AED", bsFrom);
    add("Total liabilities", bs.totalLiabilities, "AED", bsFrom);
  } else {
    missing.push("No posted balance-sheet activity");
  }

  if (ar.documents.length > 0) {
    const arFrom = `Aged receivables as of ${period.end} (net of payments and credit notes)`;
    add("Open receivables (AED)", ar.totals.total, "AED", arFrom);
    add("Open invoices count", ar.documents.length, "count", arFrom);
  }

  const rc = receipts.rows[0];
  if (rc && Number(rc.n) > 0) {
    const rcFrom = `Receipts ${period.start} to ${period.end}`;
    add("Receipts captured (fiscal year to date)", Number(rc.n), "count", rcFrom);
    add("Receipts posted (fiscal year to date)", Number(rc.posted), "count", rcFrom);
    add("Unposted receipt value (AED)", Number(rc.unposted_value), "AED", rcFrom);
  }

  const hasLedgerFigures = figures.some((f) => /^(Revenue|Expenses|Net profit)/.test(f.label));
  return {
    companyName: (company.rows[0]?.name as string | undefined) ?? null,
    period,
    figures,
    missing,
    insufficientData: !hasLedgerFigures,
  };
}

/** Render figures as a prompt block the model must cite from. */
export function renderFiguresBlock(g: GroundingResult): string {
  const lines = g.figures.map(
    (f) =>
      `[${f.id}] ${f.label}: ${f.unit === "AED" ? "AED " : ""}${f.value.toLocaleString("en-US")} (source: ${f.source})`
  );
  const missing = g.missing.map((m) => `- MISSING: ${m}`);
  return [...lines, ...missing].join("\n") || "(no figures available)";
}

export const GROUNDING_RULES = `GROUNDING RULES:
- Use ONLY the numbered figures provided. Cite each number you use with its id in square brackets, e.g. [F1].
- Never invent, estimate or extrapolate a number that is not in the figures list.
- If the figures do not contain what is needed to answer, reply that there is insufficient data and say which figure is missing.
- Do not present advice as certain; this is not a substitute for a qualified accountant.`;

export const INSUFFICIENT_DATA_ANSWER =
  "Insufficient data: there are not enough posted ledger entries for this period to answer reliably. Post your receipts and invoices, then ask again.";

export interface CitationCheck {
  cited: GroundedFigure[];
  /** Citation ids in the answer that do not exist in the grounding set. */
  unknown: string[];
  grounded: boolean;
}

/** Extract [F#] citations from an answer and verify them against the grounding set. */
export function verifyCitations(answer: string, g: GroundingResult): CitationCheck {
  const ids = Array.from(new Set(Array.from(answer.matchAll(/\[(F\d+)\]/g)).map((m) => m[1])));
  const byId = new Map(g.figures.map((f) => [f.id, f]));
  const cited = ids.map((id) => byId.get(id)).filter((f): f is GroundedFigure => Boolean(f));
  const unknown = ids.filter((id) => !byId.has(id));
  const saysInsufficient = /insufficient data/i.test(answer);
  return {
    cited,
    unknown,
    grounded: unknown.length === 0 && (cited.length > 0 || saysInsufficient),
  };
}
