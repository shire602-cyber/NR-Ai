/**
 * E2 (J3-r2): booking the opening gratuity provision.
 *
 * Employees who joined before their first payroll run in Muhasib carry an opening provision
 * (employees.opening_gratuity_provision, as of opening_gratuity_as_of). The payroll sub-ledger
 * counts it from that date (control-account-ties: opening + accrued - used), so the GL gratuity
 * provision needs the same opening balance, otherwise month-end reports the control account as
 * unreconciled. This seam posts it from the employee records, one entry per as-of date:
 *
 *   Dr Opening Balance Equity (3040)   Cr End-of-service gratuity provision (2036)
 *
 * Only the difference between the employees' opening provisions and what this seam already
 * booked for that date is posted, so it is idempotent and follows later corrections (a reduced
 * provision posts the reverse).
 */
import { DomainError } from "../../errors";
import { fromFils, toFils } from "../../../shared/money";
import { postJournal, withLedgerTx } from "../../ledger";
import { q } from "./sql";
import { ensureAccountByCode } from "../inventory/store";
import { PAYROLL_ACCOUNTS } from "./context";

/**
 * An opening balance (go-live), like the imported opening trial balance: the kernel's
 * `opening_balance` sub-ledger source, keyed by the company id (the import keys its entry by the
 * import job), and entry kind "opening".
 */
export const OPENING_GRATUITY_SOURCE = "opening_balance";
const OPENING_EQUITY_CODE = "3040";

export interface OpeningGratuityDate {
  asOf: string;
  employees: number;
  provision: number;
  booked: number;
  outstanding: number;
}

export interface OpeningGratuityStatus {
  dates: OpeningGratuityDate[];
  provision: number;
  booked: number;
  outstanding: number;
}

const filsOf = (v: unknown) => toFils(String(v ?? 0), { rounding: "halfUp" });

export async function openingGratuityStatus(companyId: string): Promise<OpeningGratuityStatus> {
  const provisions = await q<{ as_of: string; n: string; total: string }>(
    `SELECT opening_gratuity_as_of::text AS as_of, COUNT(*)::text AS n,
            COALESCE(SUM(opening_gratuity_provision), 0)::text AS total
       FROM employees
      WHERE company_id = $1 AND opening_gratuity_provision IS NOT NULL
        AND opening_gratuity_as_of IS NOT NULL
      GROUP BY opening_gratuity_as_of`,
    [companyId]
  );
  const booked = await q<{ d: string; fils: string }>(
    `SELECT to_char(je.date, 'YYYY-MM-DD') AS d,
            COALESCE(SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100)), 0)::bigint::text AS fils
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.source = $2 AND je.source_id = $1
        AND je.status = 'posted' AND a.code = $3
      GROUP BY 1`,
    [companyId, OPENING_GRATUITY_SOURCE, PAYROLL_ACCOUNTS.gratuityProvision]
  );
  const bookedBy = new Map(booked.map((r) => [r.d, Number(r.fils)]));
  const dates = new Set([...provisions.map((p) => p.as_of), ...bookedBy.keys()]);
  const out: OpeningGratuityDate[] = [];
  let p = 0;
  let b = 0;
  for (const asOf of [...dates].sort()) {
    const row = provisions.find((x) => x.as_of === asOf);
    const provisionFils = row ? filsOf(row.total) : 0;
    const bookedFils = bookedBy.get(asOf) ?? 0;
    p += provisionFils;
    b += bookedFils;
    out.push({
      asOf,
      employees: row ? Number(row.n) : 0,
      provision: Number(fromFils(provisionFils)),
      booked: Number(fromFils(bookedFils)),
      outstanding: Number(fromFils(provisionFils - bookedFils)),
    });
  }
  return {
    dates: out,
    provision: Number(fromFils(p)),
    booked: Number(fromFils(b)),
    outstanding: Number(fromFils(p - b)),
  };
}

async function accountIdByCode(companyId: string, code: string): Promise<string> {
  const rows = await q<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 AND is_active = true LIMIT 1`,
    [companyId, code]
  );
  if (!rows[0]) throw new DomainError("PAYROLL_ACCOUNTS_MISSING", 422, { code });
  return rows[0].id;
}

/** Post the outstanding opening provision for every as-of date. Returns the entries posted. */
export async function bookOpeningGratuity(companyId: string, actorId: string) {
  const status = await openingGratuityStatus(companyId);
  const todo = status.dates.filter((d) => d.outstanding !== 0);
  if (!todo.length) {
    throw new DomainError(
      "OPENING_GRATUITY_NOTHING_TO_BOOK",
      409,
      { booked: status.booked },
      "The opening gratuity provision is already booked"
    );
  }
  const provisionAccount = await accountIdByCode(companyId, PAYROLL_ACCOUNTS.gratuityProvision);
  const posted: Array<{ asOf: string; amount: number; journalEntryId: string }> = [];
  await withLedgerTx(async (tx) => {
    // 3040 Opening Balance Equity is created from the default chart when a company lacks it.
    const equityAccount = await ensureAccountByCode(tx, companyId, OPENING_EQUITY_CODE);
    for (const d of todo) {
      const fils = toFils(String(d.outstanding), { rounding: "halfUp" });
      const up = fils > 0;
      const amount = Math.abs(fils);
      const { entry } = await postJournal(
        {
          companyId,
          date: d.asOf,
          memo: `Opening gratuity provision at ${d.asOf} (${d.employees} employee(s))`,
          status: "posted",
          kind: "opening",
          source: OPENING_GRATUITY_SOURCE,
          sourceId: companyId,
          idempotencyKey: `opening-gratuity:${companyId}:${d.asOf}:${toFils(String(d.booked), { rounding: "halfUp" })}:${fils}`,
          lines: [
            {
              accountId: equityAccount,
              ...(up ? { debitFils: amount } : { creditFils: amount }),
              description: "Opening balance: gratuity provision brought forward",
            },
            {
              accountId: provisionAccount,
              ...(up ? { creditFils: amount } : { debitFils: amount }),
              description: "Opening gratuity provision (employees' service before go-live)",
            },
          ],
        },
        { actorId, tx }
      );
      posted.push({ asOf: d.asOf, amount: Number(fromFils(fils)), journalEntryId: entry.id });
    }
  });
  return { posted, status: await openingGratuityStatus(companyId) };
}
