/**
 * Control-account ties for the month-end close (A4: M12).
 *
 * A control account must equal the sub-ledger it summarises. Each tie reads the sub-ledger from
 * its own source (never from the GL) and the control account from the reporting kernel, at the
 * period end:
 *
 *   receivables   1040 vs open invoices less unapplied credits (agedReceivables, settlement.ts)
 *   payables      2010 vs open bills less unapplied vendor credits (agedPayables)
 *   inventory     1070 and every product inventory account vs the stock valuation at the period
 *                 end (B1: NM5): the products' stock value less the value of movements dated
 *                 after the period end
 *   vat           the period's VAT 201 vs the VAT control accounts (computeVat201 reconciliation:
 *                 unexplained output / input difference)
 *   pension       2032 vs contributions of approved payroll runs less pension payments
 *   gratuity      2036 vs opening provisions + run accruals - provisions cleared by settlements
 *                 (B1: NM3: the provision used for the gratuity and any excess released)
 *   salaries      2030 vs postings from payroll documents (a manual journal to 2030 breaks it)
 *
 * A tie with no activity on either side is reported as `applicable: false`.
 */
import { pool } from "../db";
import { accountTotals, agedPayables, agedReceivables, loadAccounts } from "../reporting";
import { computeVat201 } from "../tax/vat-engine";

export type ControlTieKey =
  | "receivables"
  | "payables"
  | "inventory"
  | "vat"
  | "pension"
  | "gratuity"
  | "salaries";

export interface ControlTie {
  key: ControlTieKey;
  label: string;
  accountCode: string | null;
  glBalance: number;
  subledgerBalance: number;
  difference: number;
  applicable: boolean;
  reconciled: boolean;
}

const aed = (f: number) => (Object.is(f / 100, -0) ? 0 : f / 100);
const fils = (v: unknown) => Math.round((Number(v) || 0) * 100);
const LOCAL = (col: string) => `((${col} + interval '4 hours')::date)`;

async function glCredit(companyId: string, code: string, asOf: string): Promise<number | null> {
  const acct = (await loadAccounts(companyId)).find((a) => a.code === code);
  if (!acct) return null;
  const t = (await accountTotals(companyId, { to: asOf })).get(acct.id);
  return t ? t.credit - t.debit : 0;
}

function tie(
  key: ControlTieKey,
  label: string,
  accountCode: string | null,
  glFils: number,
  subFils: number
): ControlTie {
  return {
    key,
    label,
    accountCode,
    glBalance: aed(glFils),
    subledgerBalance: aed(subFils),
    difference: aed(glFils - subFils),
    applicable: glFils !== 0 || subFils !== 0,
    reconciled: glFils === subFils,
  };
}

/**
 * B1 (NM5): inventory control accounts (1070 and each stocked product's inventory account) vs the
 * stock valuation at `asOf`. The valuation is the products' current stock value less the value
 * movements dated after `asOf` added (each movement records its stock-value delta), so it is
 * read from the stock records, never from the GL. An opening balance on 1070 with no stock behind
 * it (S8) is a difference here.
 */
async function inventoryTie(companyId: string, asOf: string): Promise<ControlTie> {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COALESCE(SUM(ROUND(COALESCE(p.stock_value, 0) * 100)), 0)
          FROM products p
         WHERE p.company_id = $1 AND p.product_type = 'inventory'
           AND p.track_inventory IS NOT FALSE)::bigint AS current_fils,
       (SELECT COALESCE(SUM(ROUND(COALESCE(m.total_cost, 0) * 100)), 0)
          FROM inventory_movements m
          JOIN products p ON p.id = m.product_id
         WHERE m.company_id = $1 AND p.product_type = 'inventory'
           AND p.track_inventory IS NOT FALSE
           AND COALESCE(m.movement_date, ${LOCAL("m.created_at")}) > $2::date)::bigint AS later_fils,
       ARRAY(SELECT DISTINCT p.inventory_account_id::text FROM products p
              WHERE p.company_id = $1 AND p.inventory_account_id IS NOT NULL) AS account_ids`,
    [companyId, asOf]
  );
  const r = rows[0] as { current_fils: string; later_fils: string; account_ids: string[] | null };
  const accounts = await loadAccounts(companyId);
  const ids = new Set<string>(r.account_ids ?? []);
  for (const a of accounts) if (a.code === "1070") ids.add(a.id);
  const totals = await accountTotals(companyId, { to: asOf });
  let glFils = 0;
  for (const id of ids) {
    const t = totals.get(id);
    if (t) glFils += t.debit - t.credit;
  }
  return tie(
    "inventory",
    "Inventory vs stock valuation",
    "1070",
    glFils,
    Number(r.current_fils) - Number(r.later_fils)
  );
}

async function payrollTablesExist(): Promise<boolean> {
  const r = await pool.query(`SELECT to_regclass('public.payroll_runs') IS NOT NULL AS ok`);
  return r.rows[0]?.ok === true;
}

export async function controlAccountTies(
  companyId: string,
  periodStart: string,
  periodEnd: string
): Promise<ControlTie[]> {
  const out: ControlTie[] = [];
  const [ar, ap] = await Promise.all([
    agedReceivables({ companyId, asOf: periodEnd }),
    agedPayables({ companyId, asOf: periodEnd }),
  ]);
  out.push(
    tie(
      "receivables",
      "Accounts receivable vs open invoices",
      ar.reconciliation.controlAccountCode,
      fils(ar.reconciliation.glBalance),
      fils(ar.reconciliation.agingTotal)
    ),
    tie(
      "payables",
      "Accounts payable vs open bills",
      ap.reconciliation.controlAccountCode,
      fils(ap.reconciliation.glBalance),
      fils(ap.reconciliation.agingTotal)
    )
  );

  out.push(await inventoryTie(companyId, periodEnd));

  try {
    const vat = await computeVat201({
      companyId,
      from: periodStart,
      to: periodEnd,
      allowIncomplete: true,
    });
    const r = vat.reconciliation;
    // Both sides as net VAT payable for the period; the difference is the unexplained part.
    const ledgerNet = r.ledgerOutputVatFils - r.ledgerInputVatFils;
    const unexplained = r.unexplainedOutputFils - r.unexplainedInputFils;
    out.push(
      tie("vat", "VAT control accounts vs VAT 201", null, ledgerNet, ledgerNet - unexplained)
    );
    if (r.unexplainedOutputFils !== 0 && r.unexplainedInputFils !== 0 && unexplained === 0) {
      // Offsetting output and input differences still mean the return does not tie.
      const t = out[out.length - 1];
      t.reconciled = false;
      t.difference = aed(r.unexplainedOutputFils);
    }
  } catch {
    // No VAT configuration (unregistered company): nothing to tie.
  }

  if (!(await payrollTablesExist())) return out;

  const pensionGl = await glCredit(companyId, "2032", periodEnd);
  const pension = await pool.query(
    `SELECT
       (SELECT COALESCE(SUM(pi.pension_employee + pi.pension_employer), 0)
          FROM payroll_items pi
          JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
          JOIN journal_entries je ON je.id = pr.journal_entry_id
         WHERE pr.company_id = $1 AND pr.status IN ('approved', 'paid')
           AND je.status = 'posted' AND ${LOCAL("je.date")} <= $2::date)::text AS accrued,
       (SELECT COALESCE(SUM(amount), 0) FROM payroll_pension_payments
         WHERE company_id = $1 AND status = 'posted' AND payment_date <= $2::date)::text AS paid`,
    [companyId, periodEnd]
  );
  if (pensionGl !== null) {
    out.push(
      tie(
        "pension",
        "Pension payable (GPSSA / ADPF) vs contributions not yet paid",
        "2032",
        pensionGl,
        fils(pension.rows[0].accrued) - fils(pension.rows[0].paid)
      )
    );
  }

  const gratuityGl = await glCredit(companyId, "2036", periodEnd);
  const gratuity = await pool.query(
    `SELECT
       (SELECT COALESCE(SUM(opening_gratuity_provision), 0) FROM employees
         WHERE company_id = $1 AND opening_gratuity_provision IS NOT NULL
           AND (opening_gratuity_as_of IS NULL OR opening_gratuity_as_of <= $2::date))::text AS opening,
       (SELECT COALESCE(SUM(pi.gratuity_accrual), 0)
          FROM payroll_items pi
          JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
          JOIN journal_entries je ON je.id = pr.journal_entry_id
         WHERE pr.company_id = $1 AND pr.status IN ('approved', 'paid')
           AND je.status = 'posted' AND ${LOCAL("je.date")} <= $2::date)::text AS accrued,
       (SELECT COALESCE(SUM(GREATEST(0, COALESCE(
                 NULLIF(s.breakdown->>'provisionAccrued', '')::numeric,
                 s.gratuity_provision_used))), 0)
          FROM payroll_settlements s
          JOIN journal_entries je ON je.id = s.journal_entry_id
         WHERE s.company_id = $1 AND s.status <> 'reversed'
           AND je.status = 'posted' AND ${LOCAL("je.date")} <= $2::date)::text AS used`,
    [companyId, periodEnd]
  );
  if (gratuityGl !== null) {
    const g = gratuity.rows[0];
    out.push(
      tie(
        "gratuity",
        "Gratuity provision vs employee entitlements accrued",
        "2036",
        gratuityGl,
        fils(g.opening) + fils(g.accrued) - fils(g.used)
      )
    );
  }

  const salariesGl = await glCredit(companyId, "2030", periodEnd);
  if (salariesGl !== null) {
    const fromPayroll = await pool.query(
      `SELECT COALESCE(SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100)), 0)::bigint AS f
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN accounts a ON a.id = jl.account_id
         LEFT JOIN journal_entries orig ON je.source = 'reversal' AND orig.id::text = je.source_id::text
        WHERE je.company_id = $1 AND je.status = 'posted' AND a.code = '2030'
          AND ${LOCAL("je.date")} <= $2::date
          AND COALESCE(orig.source, je.source) LIKE 'payroll%'`,
      [companyId, periodEnd]
    );
    out.push(
      tie(
        "salaries",
        "Salaries payable vs payroll runs and settlements",
        "2030",
        salariesGl,
        Number(fromPayroll.rows[0]?.f ?? 0)
      )
    );
  }
  return out;
}
