// Server-computed grounding for AI answers (R05-09, R05-25, R05-26).
//
// CFO advice and the NL gateway never use client-supplied figures. Figures here come from
// set-based aggregate queries over POSTED journal lines (plus a few document counts),
// rounded with the same helpers as financial-statements.ts. Each figure gets a stable id
// (F1, F2, ...) so answers can cite it and the response can carry a citations block.

import { round2, sumMoney } from "../financial-statements";

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
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, any>> }>;
}

async function defaultDeps(): Promise<GroundingDeps> {
  const { pool } = await import("../../db");
  return { query: (sql, params) => (pool as any).query(sql, params) };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const SQL_PNL = `
  SELECT a.type AS type,
         COALESCE(SUM(l.debit),0)::float8 AS debit,
         COALESCE(SUM(l.credit),0)::float8 AS credit,
         COUNT(DISTINCT e.id)::int AS entries
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN accounts a ON a.id = l.account_id
   WHERE e.company_id = $1 AND e.status = 'posted'
     AND e.date >= $2 AND e.date < $3
     AND a.type IN ('income','expense')
   GROUP BY a.type`;

const SQL_BALANCES = `
  SELECT a.type AS type,
         COALESCE(SUM(l.debit),0)::float8 AS debit,
         COALESCE(SUM(l.credit),0)::float8 AS credit
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN accounts a ON a.id = l.account_id
   WHERE e.company_id = $1 AND e.status = 'posted' AND e.date < $2
     AND a.type IN ('asset','liability','equity')
   GROUP BY a.type`;

// Receivables: non-draft, non-void invoices still open (sent or partially paid).
// Gross invoice totals; part-payments are not netted, and the label says so.
const SQL_OPEN_INVOICES = `
  SELECT COUNT(*)::int AS n, COALESCE(SUM(base_currency_amount),0)::float8 AS total
    FROM invoices
   WHERE company_id = $1 AND status IN ('sent','partial')`;

const SQL_RECEIPTS = `
  SELECT COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE posted)::int AS posted,
         COALESCE(SUM(base_currency_amount) FILTER (WHERE NOT posted),0)::float8 AS unposted_value
    FROM receipts
   WHERE company_id = $1 AND date >= $2 AND date < $3`;

export async function buildGroundedContext(
  companyId: string,
  opts: { asOf?: Date; deps?: GroundingDeps } = {}
): Promise<GroundingResult> {
  const deps = opts.deps ?? (await defaultDeps());
  const asOf = opts.asOf ?? new Date();
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
  const endExclusive = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate() + 1)
  );
  const period = { start: isoDate(start), end: isoDate(asOf) };

  const [company, pnl, balances, invoices, receipts] = await Promise.all([
    deps.query(`SELECT name FROM companies WHERE id = $1`, [companyId]),
    deps.query(SQL_PNL, [companyId, start, endExclusive]),
    deps.query(SQL_BALANCES, [companyId, endExclusive]),
    deps.query(SQL_OPEN_INVOICES, [companyId]),
    deps.query(SQL_RECEIPTS, [companyId, start, endExclusive]),
  ]);

  const figures: GroundedFigure[] = [];
  const missing: string[] = [];
  const add = (label: string, value: number, unit: GroundedFigure["unit"], source: string) => {
    figures.push({ id: `F${figures.length + 1}`, label, value: round2(value), unit, source });
  };

  const byType = (rows: Array<Record<string, any>>, type: string) =>
    rows.find((r) => r.type === type);
  const income = byType(pnl.rows, "income");
  const expense = byType(pnl.rows, "expense");
  const postedSource = `Posted journal entries ${period.start} to ${period.end}`;

  if (!income && !expense) {
    missing.push(`No posted journal entries in ${period.start} to ${period.end}`);
  } else {
    const revenue = sumMoney([Number(income?.credit ?? 0), -Number(income?.debit ?? 0)]);
    const expenses = sumMoney([Number(expense?.debit ?? 0), -Number(expense?.credit ?? 0)]);
    add("Revenue (year to date)", revenue, "AED", postedSource);
    add("Expenses (year to date)", expenses, "AED", postedSource);
    add("Net profit (year to date)", revenue - expenses, "AED", postedSource);
  }

  const bsSource = `Posted journal entries up to ${period.end}`;
  const assets = byType(balances.rows, "asset");
  const liabilities = byType(balances.rows, "liability");
  if (assets || liabilities) {
    if (assets) {
      add("Total assets", Number(assets.debit) - Number(assets.credit), "AED", bsSource);
    }
    if (liabilities) {
      add(
        "Total liabilities",
        Number(liabilities.credit) - Number(liabilities.debit),
        "AED",
        bsSource
      );
    }
  } else {
    missing.push("No posted balance-sheet activity");
  }

  const inv = invoices.rows[0];
  if (inv && Number(inv.n) > 0) {
    add(
      "Open invoices (sent or part-paid, gross AED)",
      Number(inv.total),
      "AED",
      "Invoices with status sent/partial"
    );
    add("Open invoices count", Number(inv.n), "count", "Invoices with status sent/partial");
  }

  const rc = receipts.rows[0];
  if (rc && Number(rc.n) > 0) {
    add(
      "Receipts captured (year to date)",
      Number(rc.n),
      "count",
      `Receipts ${period.start} to ${period.end}`
    );
    add(
      "Receipts posted (year to date)",
      Number(rc.posted),
      "count",
      `Receipts ${period.start} to ${period.end}`
    );
    add(
      "Unposted receipt value (AED)",
      Number(rc.unposted_value),
      "AED",
      `Receipts ${period.start} to ${period.end}`
    );
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
