/**
 * E2 (J3-r2), D1 (N1): booking the opening gratuity provision.
 *
 * Employees who joined before their first payroll run in Muhasib carry an opening provision
 * (employees.opening_gratuity_provision, as of opening_gratuity_as_of). The payroll sub-ledger
 * counts it from that date (control-account-ties: opening + accrued - used), so the GL gratuity
 * provision needs the same opening balance, otherwise month-end reports the control account as
 * unreconciled. This seam posts it from the employee records:
 *
 *   Dr Opening Balance Equity (3040)   Cr End-of-service gratuity provision (2036)
 *
 * D1 (N1): the employee records are the one source of the opening 2036. "Booked" is every
 * opening-balance entry (entry_kind 'opening', whatever posted it: this seam, or an opening
 * trial balance committed before D1 that posted 2036 itself) on 2036, so only the difference to
 * the employees' opening provisions is ever posted, and an earlier double booking is reversed.
 * The opening trial balance no longer posts 2036: it checks it against the employees and leaves
 * it to this seam (migration-import), and saving an opening provision on the employee form
 * books it at once (`syncOpeningGratuity`), so no path can book it twice or leave it unbooked.
 */
import { DomainError } from "../../errors";
import { fromFils, toFils } from "../../../shared/money";
import { postJournal, withLedgerTx, type LedgerTx } from "../../ledger";
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

export async function openingGratuityStatus(
  companyId: string,
  tx?: LedgerTx
): Promise<OpeningGratuityStatus> {
  const provisions = await q<{ as_of: string; n: string; total: string }>(
    `SELECT opening_gratuity_as_of::text AS as_of, COUNT(*)::text AS n,
            COALESCE(SUM(opening_gratuity_provision), 0)::text AS total
       FROM employees
      WHERE company_id = $1 AND opening_gratuity_provision IS NOT NULL
        AND opening_gratuity_as_of IS NOT NULL
      GROUP BY opening_gratuity_as_of`,
    [companyId],
    tx
  );
  const booked = await q<{ d: string; fils: string }>(
    `SELECT to_char(je.date, 'YYYY-MM-DD') AS d,
            COALESCE(SUM(ROUND(jl.credit * 100) - ROUND(jl.debit * 100)), 0)::bigint::text AS fils
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.id
       JOIN accounts a ON a.id = jl.account_id
      WHERE je.company_id = $1 AND je.entry_kind = 'opening'
        AND je.status = 'posted' AND a.code = $2
      GROUP BY 1`,
    [companyId, PAYROLL_ACCOUNTS.gratuityProvision],
    tx
  );
  const bookedBy = new Map(booked.map((r) => [r.d, Number(r.fils)]));
  const dates = [...new Set([...provisions.map((p) => p.as_of), ...bookedBy.keys()])].sort();
  const provisionBy = new Map(provisions.map((p) => [p.as_of, p]));
  const gap = new Map<string, number>();
  let p = 0;
  let b = 0;
  for (const asOf of dates) {
    const row = provisionBy.get(asOf);
    const provisionFils = row ? filsOf(row.total) : 0;
    const bookedFils = bookedBy.get(asOf) ?? 0;
    p += provisionFils;
    b += bookedFils;
    gap.set(asOf, provisionFils - bookedFils);
  }
  // D1 (N1): what is outstanding is the total difference. It is placed on the dates whose own
  // gap has the same sign, latest first, so an opening balance booked on another date (an
  // opening trial balance dated at the cut-over, the provisions measured a day earlier) counts.
  const outstandingBy = new Map<string, number>();
  let rest = p - b;
  for (const asOf of [...dates].reverse()) {
    if (rest === 0) break;
    const g = gap.get(asOf) ?? 0;
    if (Math.sign(g) !== Math.sign(rest)) continue;
    const take = Math.sign(rest) * Math.min(Math.abs(g), Math.abs(rest));
    outstandingBy.set(asOf, take);
    rest -= take;
  }
  const out: OpeningGratuityDate[] = dates.map((asOf) => {
    const row = provisionBy.get(asOf);
    return {
      asOf,
      employees: row ? Number(row.n) : 0,
      provision: Number(fromFils(row ? filsOf(row.total) : 0)),
      booked: Number(fromFils(bookedBy.get(asOf) ?? 0)),
      outstanding: Number(fromFils(outstandingBy.get(asOf) ?? 0)),
    };
  });
  return {
    dates: out,
    provision: Number(fromFils(p)),
    booked: Number(fromFils(b)),
    outstanding: Number(fromFils(p - b)),
  };
}

async function accountIdByCode(companyId: string, code: string, tx?: LedgerTx): Promise<string> {
  const rows = await q<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 AND is_active = true LIMIT 1`,
    [companyId, code],
    tx
  );
  if (!rows[0]) throw new DomainError("PAYROLL_ACCOUNTS_MISSING", 422, { code });
  return rows[0].id;
}

/**
 * D1 (N1): post whatever the employees' opening provisions and the opening 2036 in the GL differ
 * by (nothing when they agree). Runs in the caller's transaction when given one: the employee
 * form and the opening trial balance call it so the GL follows the employee records.
 */
export async function syncOpeningGratuity(
  companyId: string,
  actorId: string,
  outer?: LedgerTx
): Promise<Array<{ asOf: string; amount: number; journalEntryId: string }>> {
  const posted: Array<{ asOf: string; amount: number; journalEntryId: string }> = [];
  await withLedgerTx(async (tx) => {
    const status = await openingGratuityStatus(companyId, tx);
    const todo = status.dates.filter((d) => d.outstanding !== 0);
    if (!todo.length) return;
    const provisionAccount = await accountIdByCode(
      companyId,
      PAYROLL_ACCOUNTS.gratuityProvision,
      tx
    );
    // 3040 Opening Balance Equity is created from the default chart when a company lacks it.
    const equityAccount = await ensureAccountByCode(tx, companyId, OPENING_EQUITY_CODE);
    const state = `${toFils(String(status.booked), { rounding: "halfUp" })}:${toFils(String(status.provision), { rounding: "halfUp" })}`;
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
          idempotencyKey: `opening-gratuity:${companyId}:${d.asOf}:${state}:${fils}`,
          lines: [
            {
              accountId: equityAccount,
              ...(up ? { debitFils: amount } : { creditFils: amount }),
              description: "Opening balance: gratuity provision brought forward",
            },
            {
              // C1: the provision account is derived here from the payroll chart mapping, so it is
              // payroll's own control leg (the kernel refuses an unmarked line on 2036).
              accountId: provisionAccount,
              controlLeg: "payroll" as const,
              ...(up ? { creditFils: amount } : { debitFils: amount }),
              description: "Opening gratuity provision (employees' service before go-live)",
            },
          ],
        },
        { actorId, tx }
      );
      posted.push({ asOf: d.asOf, amount: Number(fromFils(fils)), journalEntryId: entry.id });
    }
  }, outer);
  return posted;
}

/** Post the outstanding opening provision for every as-of date. Returns the entries posted. */
export async function bookOpeningGratuity(companyId: string, actorId: string) {
  const status = await openingGratuityStatus(companyId);
  if (!status.dates.some((d) => d.outstanding !== 0)) {
    throw new DomainError(
      "OPENING_GRATUITY_NOTHING_TO_BOOK",
      409,
      { booked: status.booked },
      "The opening gratuity provision is already booked"
    );
  }
  const posted = await syncOpeningGratuity(companyId, actorId);
  return { posted, status: await openingGratuityStatus(companyId) };
}
